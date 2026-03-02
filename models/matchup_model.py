#!/usr/bin/env python3
"""
matchup_model.py — BaselineMLB Matchup Probability Model

Multi-class LightGBM model that predicts the probability distribution
over 11 plate appearance outcomes for any batter/pitcher matchup:
    P(K), P(BB), P(HBP), P(1B), P(2B), P(3B), P(HR),
    P(flyout), P(groundout), P(lineout), P(popup)

This is the "brain" of the Monte Carlo game simulator — it produces
the probability vectors that the sim engine samples from.

Design principles:
    1. Glass-box transparency: every prediction includes SHAP explanations
    2. Temporal integrity: train/test splits are always date-based
    3. Calibrated probabilities: post-hoc calibration via Platt scaling
    4. Graceful degradation: handles missing features via LightGBM's
       native NaN support + league-average fallbacks

Usage:
    model = MatchupModel()
    model.fit(train_df, val_df)
    probs = model.predict_proba(features_df)
    explanations = model.explain(features_df)
"""

import json
import logging
import warnings
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import joblib
import numpy as np
import pandas as pd

try:
    import lightgbm as lgb
except ImportError:
    raise ImportError(
        "LightGBM required: pip install lightgbm\n"
        "See: https://lightgbm.readthedocs.io/en/latest/Installation-Guide.html"
    )

from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    log_loss,
    classification_report,
    confusion_matrix,
)
from sklearn.preprocessing import LabelEncoder

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False
    warnings.warn(
        "SHAP not installed — explanations disabled. "
        "Install with: pip install shap"
    )

from models.feature_config import (
    PA_OUTCOMES,
    OUTCOME_TO_IDX,
    IDX_TO_OUTCOME,
    OUTCOME_SHORT,
    NUM_CLASSES,
    FEATURE_NAMES,
    FEATURE_DEFAULTS,
    TARGET_COL,
    DATE_COL,
    LEAGUE_AVG_PROBS,
    map_event,
    RAW_EVENT_COL,
)

log = logging.getLogger("baselinemlb.matchup_model")


# ═══════════════════════════════════════════════════════════════════════════
# LightGBM Hyperparameters
# ═══════════════════════════════════════════════════════════════════════════

DEFAULT_PARAMS = {
    "objective": "multiclass",
    "num_class": NUM_CLASSES,
    "metric": "multi_logloss",
    "boosting_type": "gbdt",
    "learning_rate": 0.05,
    "num_leaves": 63,
    "max_depth": 8,
    "min_child_samples": 200,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "n_estimators": 2000,
    "verbose": -1,
    "n_jobs": -1,
    "random_state": 42,
    "importance_type": "gain",
    # Handle class imbalance (triples, HBP are rare)
    "is_unbalance": False,
}


# ═══════════════════════════════════════════════════════════════════════════
# Main Model Class
# ═══════════════════════════════════════════════════════════════════════════

class MatchupModel:
    """
    Multi-class gradient boosting model for PA outcome prediction.

    Wraps LightGBM with:
        - Date-based temporal splits (no future leakage)
        - SHAP-based explanations
        - Calibrated probability outputs
        - Feature importance tracking
        - Comparison against naive baselines
    """

    def __init__(self, params: dict = None):
        self.params = {**DEFAULT_PARAMS, **(params or {})}
        self.model: Optional[lgb.LGBMClassifier] = None
        self.calibrated_model = None
        self.label_encoder = LabelEncoder()
        self.feature_names: List[str] = FEATURE_NAMES.copy()
        self.explainer = None
        self.training_metrics: Dict = {}
        self.feature_importances: Optional[pd.DataFrame] = None
        self.class_weights: Optional[np.ndarray] = None
        self._is_fitted = False

    # ─── Data Preparation ────────────────────────────────────────────

    def prepare_data(self, df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.Series]:
        """
        Prepare a raw dataframe for training or prediction.

        Steps:
            1. Map raw Statcast events → 11-class labels
            2. Encode labels as integers
            3. Select and align feature columns
            4. Handle missing values (LightGBM uses NaN natively)

        Args:
            df: DataFrame with feature columns and optionally TARGET_COL
                or RAW_EVENT_COL.

        Returns:
            (X, y) where X is the feature matrix and y is encoded labels.
            If no target column exists, y is None.
        """
        df = df.copy()

        # ── Map events to outcome labels if raw events present ──
        if RAW_EVENT_COL in df.columns and TARGET_COL not in df.columns:
            bb_type_col = "bb_type" if "bb_type" in df.columns else None
            df[TARGET_COL] = df.apply(
                lambda row: map_event(
                    row[RAW_EVENT_COL],
                    row[bb_type_col] if bb_type_col else None,
                ),
                axis=1,
            )
            # Drop rows with unmappable events
            before = len(df)
            df = df.dropna(subset=[TARGET_COL])
            dropped = before - len(df)
            if dropped > 0:
                log.info(f"Dropped {dropped:,} rows with unmappable events")

        # ── Align feature columns ──
        for col in self.feature_names:
            if col not in df.columns:
                df[col] = FEATURE_DEFAULTS.get(col, np.nan)

        X = df[self.feature_names].copy()

        # ── Encode target ──
        y = None
        if TARGET_COL in df.columns:
            # Ensure consistent label encoding
            self.label_encoder.classes_ = np.array(PA_OUTCOMES)
            valid_mask = df[TARGET_COL].isin(PA_OUTCOMES)
            if not valid_mask.all():
                invalid = df.loc[~valid_mask, TARGET_COL].unique()
                log.warning(f"Dropping {(~valid_mask).sum():,} rows with unknown outcomes: {invalid}")
                X = X[valid_mask]
                df = df[valid_mask]
            y = self.label_encoder.transform(df[TARGET_COL])

        return X, y

    # ─── Training ────────────────────────────────────────────────────

    def fit(
        self,
        train_df: pd.DataFrame,
        val_df: pd.DataFrame,
        early_stopping_rounds: int = 100,
        compute_class_weights: bool = True,
    ) -> Dict:
        """
        Train the LightGBM model with early stopping on validation set.

        Args:
            train_df:               Training data (2020-2024).
            val_df:                 Validation data (early 2025).
            early_stopping_rounds:  Patience for early stopping.
            compute_class_weights:  Whether to compute sample weights
                                    for class imbalance.

        Returns:
            Dict of training metrics.
        """
        log.info("Preparing training data...")
        X_train, y_train = self.prepare_data(train_df)
        log.info(f"Training set: {X_train.shape[0]:,} samples, {X_train.shape[1]} features")

        log.info("Preparing validation data...")
        X_val, y_val = self.prepare_data(val_df)
        log.info(f"Validation set: {X_val.shape[0]:,} samples")

        # ── Class distribution ──
        train_dist = pd.Series(y_train).value_counts().sort_index()
        log.info("Training class distribution:")
        for idx, count in train_dist.items():
            label = IDX_TO_OUTCOME[idx]
            pct = count / len(y_train) * 100
            log.info(f"  {label:15s}: {count:>8,} ({pct:5.1f}%)")

        # ── Sample weights for class imbalance ──
        sample_weight = None
        if compute_class_weights:
            class_counts = np.bincount(y_train, minlength=NUM_CLASSES).astype(float)
            # Avoid division by zero
            class_counts = np.maximum(class_counts, 1.0)
            total = class_counts.sum()
            self.class_weights = total / (NUM_CLASSES * class_counts)
            # Cap extreme weights (triples are very rare)
            self.class_weights = np.clip(self.class_weights, 0.5, 5.0)
            sample_weight = self.class_weights[y_train]
            log.info("Class weights computed:")
            for i, w in enumerate(self.class_weights):
                log.info(f"  {IDX_TO_OUTCOME[i]:15s}: {w:.3f}")

        # ── Train LightGBM ──
        log.info(f"Training LightGBM (max {self.params['n_estimators']} rounds)...")

        callbacks = [
            lgb.early_stopping(stopping_rounds=early_stopping_rounds, verbose=True),
            lgb.log_evaluation(period=100),
        ]

        self.model = lgb.LGBMClassifier(**self.params)
        self.model.fit(
            X_train,
            y_train,
            sample_weight=sample_weight,
            eval_set=[(X_val, y_val)],
            eval_metric="multi_logloss",
            callbacks=callbacks,
        )

        best_iter = self.model.best_iteration_
        log.info(f"Best iteration: {best_iter}")

        # ── Feature importances ──
        self._compute_feature_importances()

        # ── Evaluate ──
        metrics = self._evaluate(X_train, y_train, X_val, y_val)
        self.training_metrics = metrics
        self._is_fitted = True

        return metrics

    def calibrate(self, val_df: pd.DataFrame, method: str = "isotonic") -> None:
        """
        Apply post-hoc probability calibration using validation data.

        This improves the reliability of predicted probabilities —
        when the model says 30% K chance, it should actually be ~30%.

        Args:
            val_df:  Validation DataFrame used for calibration fitting.
            method:  "sigmoid" (Platt scaling) or "isotonic".
        """
        if not self._is_fitted:
            raise RuntimeError("Model must be trained before calibration.")

        log.info(f"Calibrating probabilities with {method} regression...")

        X_val, y_val = self.prepare_data(val_df)

        self.calibrated_model = CalibratedClassifierCV(
            estimator=self.model,
            method=method,
            cv="prefit",
        )
        self.calibrated_model.fit(X_val, y_val)
        log.info("Calibration complete.")

    # ─── Prediction ──────────────────────────────────────────────────

    def predict_proba(
        self,
        X: pd.DataFrame,
        calibrated: bool = True,
    ) -> np.ndarray:
        """
        Predict PA outcome probability distribution.

        Args:
            X:           DataFrame with feature columns. Missing columns
                         are filled with defaults.
            calibrated:  Use calibrated model if available.

        Returns:
            np.ndarray of shape (n_samples, 11) — probabilities for each
            PA outcome in PA_OUTCOMES order.
        """
        if not self._is_fitted:
            raise RuntimeError("Model is not fitted. Call fit() first.")

        # Align columns
        X_aligned = self._align_features(X)

        if calibrated and self.calibrated_model is not None:
            probs = self.calibrated_model.predict_proba(X_aligned)
        else:
            probs = self.model.predict_proba(X_aligned)

        return probs

    def predict_matchup(
        self,
        features: dict,
        calibrated: bool = True,
    ) -> Dict[str, float]:
        """
        Predict PA outcome probabilities for a single matchup.

        Convenience method that takes a feature dict and returns
        a labeled probability dict.

        Args:
            features:    Dict of feature_name → value.
            calibrated:  Use calibrated model if available.

        Returns:
            Dict mapping outcome labels to probabilities.
            Example: {"strikeout": 0.23, "walk": 0.08, ...}
        """
        row = pd.DataFrame([features])
        probs = self.predict_proba(row, calibrated=calibrated)
        return {
            outcome: round(float(probs[0, i]), 5)
            for i, outcome in enumerate(PA_OUTCOMES)
        }

    # ─── SHAP Explanations ───────────────────────────────────────────

    def explain(
        self,
        X: pd.DataFrame,
        max_samples: int = 100,
    ) -> Dict:
        """
        Generate SHAP explanations for predictions.

        Args:
            X:            Feature DataFrame.
            max_samples:  Max rows to explain (SHAP is compute-heavy).

        Returns:
            Dict with keys:
                "shap_values":  np.ndarray (n_samples, n_features, n_classes)
                "base_values":  np.ndarray (n_classes,) — expected prediction
                "feature_names": list of feature names
                "top_features": list of dicts with top-5 features per sample
        """
        if not HAS_SHAP:
            return {"error": "SHAP not installed. pip install shap"}

        if not self._is_fitted:
            raise RuntimeError("Model is not fitted. Call fit() first.")

        X_aligned = self._align_features(X)
        if len(X_aligned) > max_samples:
            X_aligned = X_aligned.iloc[:max_samples]

        log.info(f"Computing SHAP values for {len(X_aligned)} samples...")

        if self.explainer is None:
            self.explainer = shap.TreeExplainer(self.model)

        shap_values = self.explainer.shap_values(X_aligned)

        # shap_values is a list of arrays (one per class)
        # Convert to (n_samples, n_features, n_classes) for easier use
        if isinstance(shap_values, list):
            shap_array = np.stack(shap_values, axis=-1)
        else:
            shap_array = shap_values

        # Build top-feature explanations per sample
        top_features = []
        for i in range(len(X_aligned)):
            sample_top = {}
            for class_idx, outcome in enumerate(PA_OUTCOMES):
                if isinstance(shap_values, list):
                    sv = shap_values[class_idx][i]
                else:
                    sv = shap_array[i, :, class_idx]
                # Top 5 features by absolute SHAP value
                top_idx = np.argsort(np.abs(sv))[-5:][::-1]
                sample_top[outcome] = [
                    {
                        "feature": self.feature_names[j],
                        "value": float(X_aligned.iloc[i, j]) if not pd.isna(X_aligned.iloc[i, j]) else None,
                        "shap": round(float(sv[j]), 5),
                        "direction": "+" if sv[j] > 0 else "-",
                    }
                    for j in top_idx
                ]
            top_features.append(sample_top)

        return {
            "shap_values": shap_array,
            "base_values": self.explainer.expected_value,
            "feature_names": self.feature_names,
            "top_features": top_features,
        }

    def explain_matchup(self, features: dict) -> Dict:
        """
        Single-matchup SHAP explanation — returns why the model
        predicted each outcome with the probability it did.

        Returns dict with:
            "probabilities": {outcome: prob}
            "explanations":  {outcome: [top-5 features with SHAP values]}
        """
        row = pd.DataFrame([features])
        probs = self.predict_matchup(features)
        explanation = self.explain(row, max_samples=1)

        return {
            "probabilities": probs,
            "explanations": (
                explanation["top_features"][0]
                if explanation.get("top_features")
                else {}
            ),
        }

    # ─── Baseline Comparisons ────────────────────────────────────────

    def evaluate_vs_baselines(
        self,
        test_df: pd.DataFrame,
    ) -> Dict:
        """
        Compare model accuracy against naive baselines.

        Baselines:
            1. League average: always predict MLB average distribution
            2. Career average: use batter/pitcher career rates
               (approximated by per-row features)

        Returns:
            Dict with log_loss and accuracy for model vs. each baseline.
        """
        X_test, y_test = self.prepare_data(test_df)

        n = len(y_test)
        results = {}

        # ── Model predictions ──
        model_probs = self.predict_proba(X_test, calibrated=True)
        model_logloss = log_loss(y_test, model_probs, labels=list(range(NUM_CLASSES)))
        model_acc = (model_probs.argmax(axis=1) == y_test).mean()

        results["model"] = {
            "log_loss": round(model_logloss, 5),
            "accuracy": round(model_acc, 4),
            "n_samples": n,
        }

        # ── Baseline 1: League average ──
        league_probs = np.array([LEAGUE_AVG_PROBS[o] for o in PA_OUTCOMES])
        league_probs_tiled = np.tile(league_probs, (n, 1))
        league_logloss = log_loss(y_test, league_probs_tiled, labels=list(range(NUM_CLASSES)))
        league_acc = (league_probs_tiled.argmax(axis=1) == y_test).mean()

        results["league_average_baseline"] = {
            "log_loss": round(league_logloss, 5),
            "accuracy": round(league_acc, 4),
        }

        # ── Baseline 2: Career-average proxy ──
        # Use pitcher K% + batter K% to build a simple career-based distribution
        career_probs = self._build_career_baseline(X_test)
        career_logloss = log_loss(y_test, career_probs, labels=list(range(NUM_CLASSES)))
        career_acc = (career_probs.argmax(axis=1) == y_test).mean()

        results["career_average_baseline"] = {
            "log_loss": round(career_logloss, 5),
            "accuracy": round(career_acc, 4),
        }

        # ── Improvement summary ──
        ll_improvement_league = (
            (league_logloss - model_logloss) / league_logloss * 100
        )
        ll_improvement_career = (
            (career_logloss - model_logloss) / career_logloss * 100
        )

        results["improvement"] = {
            "vs_league_avg_pct": round(ll_improvement_league, 2),
            "vs_career_avg_pct": round(ll_improvement_career, 2),
        }

        log.info("=== Model vs. Baselines ===")
        log.info(f"  Model log-loss:          {model_logloss:.5f}  (acc: {model_acc:.4f})")
        log.info(f"  League avg log-loss:     {league_logloss:.5f}  (acc: {league_acc:.4f})")
        log.info(f"  Career avg log-loss:     {career_logloss:.5f}  (acc: {career_acc:.4f})")
        log.info(f"  Improvement vs league:   {ll_improvement_league:+.2f}%")
        log.info(f"  Improvement vs career:   {ll_improvement_career:+.2f}%")

        return results

    # ─── Persistence ─────────────────────────────────────────────────

    def save(self, path: str) -> None:
        """
        Save trained model and metadata to a joblib artifact.

        Saves:
            - LightGBM model
            - Calibrated model (if available)
            - Feature names and config
            - Training metrics
            - Feature importances
            - Class weights
        """
        if not self._is_fitted:
            raise RuntimeError("Cannot save an untrained model.")

        artifact = {
            "model": self.model,
            "calibrated_model": self.calibrated_model,
            "feature_names": self.feature_names,
            "label_encoder": self.label_encoder,
            "training_metrics": self.training_metrics,
            "feature_importances": self.feature_importances,
            "class_weights": self.class_weights,
            "params": self.params,
            "version": "1.0.0",
        }

        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(artifact, path, compress=3)
        log.info(f"Model saved to {path} ({path.stat().st_size / 1e6:.1f} MB)")

    @classmethod
    def load(cls, path: str) -> "MatchupModel":
        """
        Load a trained model from a joblib artifact.

        Returns:
            MatchupModel instance ready for prediction.
        """
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Model artifact not found: {path}")

        artifact = joblib.load(path)

        instance = cls(params=artifact.get("params", {}))
        instance.model = artifact["model"]
        instance.calibrated_model = artifact.get("calibrated_model")
        instance.feature_names = artifact["feature_names"]
        instance.label_encoder = artifact["label_encoder"]
        instance.training_metrics = artifact.get("training_metrics", {})
        instance.feature_importances = artifact.get("feature_importances")
        instance.class_weights = artifact.get("class_weights")
        instance._is_fitted = True

        log.info(f"Model loaded from {path}")
        return instance

    # ─── Internal Helpers ────────────────────────────────────────────

    def _align_features(self, X: pd.DataFrame) -> pd.DataFrame:
        """Ensure X has exactly the right columns in the right order."""
        X = X.copy()
        for col in self.feature_names:
            if col not in X.columns:
                X[col] = FEATURE_DEFAULTS.get(col, np.nan)
        return X[self.feature_names]

    def _compute_feature_importances(self) -> None:
        """Extract and rank feature importances from trained model."""
        importances = self.model.feature_importances_
        self.feature_importances = (
            pd.DataFrame({
                "feature": self.feature_names,
                "importance": importances,
            })
            .sort_values("importance", ascending=False)
            .reset_index(drop=True)
        )

    def _evaluate(
        self,
        X_train: pd.DataFrame,
        y_train: np.ndarray,
        X_val: pd.DataFrame,
        y_val: np.ndarray,
    ) -> Dict:
        """Compute and log model metrics on train and val sets."""
        train_probs = self.model.predict_proba(X_train)
        val_probs = self.model.predict_proba(X_val)

        train_ll = log_loss(y_train, train_probs, labels=list(range(NUM_CLASSES)))
        val_ll = log_loss(y_val, val_probs, labels=list(range(NUM_CLASSES)))

        val_preds = val_probs.argmax(axis=1)
        val_acc = (val_preds == y_val).mean()

        log.info(f"Train log-loss: {train_ll:.5f}")
        log.info(f"Val log-loss:   {val_ll:.5f}")
        log.info(f"Val accuracy:   {val_acc:.4f}")

        # Per-class metrics
        target_names = [f"{IDX_TO_OUTCOME[i]} ({OUTCOME_SHORT[IDX_TO_OUTCOME[i]]})" for i in range(NUM_CLASSES)]
        report = classification_report(
            y_val, val_preds,
            target_names=target_names,
            output_dict=True,
            zero_division=0,
        )

        # Top features
        log.info("\nTop 15 Features by Importance (gain):")
        for _, row in self.feature_importances.head(15).iterrows():
            log.info(f"  {row['feature']:25s}  {row['importance']:>10.0f}")

        metrics = {
            "train_log_loss": round(train_ll, 5),
            "val_log_loss": round(val_ll, 5),
            "val_accuracy": round(val_acc, 4),
            "best_iteration": self.model.best_iteration_,
            "n_train": len(y_train),
            "n_val": len(y_val),
            "classification_report": report,
            "feature_importances": self.feature_importances.to_dict(orient="records"),
        }

        return metrics

    def _build_career_baseline(self, X: pd.DataFrame) -> np.ndarray:
        """
        Build a career-average baseline from available pitcher/batter stats.

        Adjusts league-average probabilities using:
            - Pitcher K%  → adjusts P(K) and redistributes
            - Batter K%   → adjusts P(K) and redistributes
            - Batter xBA  → adjusts hit probabilities

        This is a smart baseline — not a trivial one.
        """
        n = len(X)
        base = np.array([LEAGUE_AVG_PROBS[o] for o in PA_OUTCOMES])

        probs = np.tile(base, (n, 1)).astype(float)

        # Pitcher K% adjustment
        if "p_k_pct" in X.columns:
            p_k = X["p_k_pct"].fillna(FEATURE_DEFAULTS["p_k_pct"]).values
            k_multiplier = p_k / FEATURE_DEFAULTS["p_k_pct"]
            probs[:, OUTCOME_TO_IDX["strikeout"]] *= k_multiplier

        # Batter K% adjustment
        if "b_k_pct" in X.columns:
            b_k = X["b_k_pct"].fillna(FEATURE_DEFAULTS["b_k_pct"]).values
            k_multiplier_b = b_k / FEATURE_DEFAULTS["b_k_pct"]
            probs[:, OUTCOME_TO_IDX["strikeout"]] *= k_multiplier_b

        # Batter xBA adjustment for hit probs
        if "b_xba" in X.columns:
            xba = X["b_xba"].fillna(FEATURE_DEFAULTS["b_xba"]).values
            hit_multiplier = xba / FEATURE_DEFAULTS["b_xba"]
            for outcome in ["single", "double", "triple", "home_run"]:
                probs[:, OUTCOME_TO_IDX[outcome]] *= hit_multiplier

        # Batter BB% adjustment
        if "b_bb_pct" in X.columns:
            bb = X["b_bb_pct"].fillna(FEATURE_DEFAULTS["b_bb_pct"]).values
            bb_mult = bb / FEATURE_DEFAULTS["b_bb_pct"]
            probs[:, OUTCOME_TO_IDX["walk"]] *= bb_mult

        # Re-normalize to sum to 1
        row_sums = probs.sum(axis=1, keepdims=True)
        probs = probs / row_sums

        # Clip for numerical stability
        probs = np.clip(probs, 1e-7, 1 - 1e-7)
        probs = probs / probs.sum(axis=1, keepdims=True)

        return probs

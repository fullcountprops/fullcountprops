#!/usr/bin/env python3
"""
models/train_model.py
=====================
Production-ready training script for the BaselineMLB LightGBM matchup model.

Reads X_train / y_train (and optionally X_test / y_test) parquet files
produced by pipeline/build_training_dataset.py, trains a LightGBM multiclass
classifier over 8 PA outcome classes, runs 5-fold cross-validation, and
writes all artifacts to models/artifacts/.

Outcome classes (8):
    0 = K     1 = BB    2 = HBP   3 = 1B
    4 = 2B    5 = 3B    6 = HR    7 = out

Expected data layout
--------------------
    data/training/X_train.parquet    -- feature matrix (produced by build_training_dataset.py)
    data/training/y_train.parquet    -- label column "label" (int 0-7)
    data/training/X_test.parquet     -- (optional) held-out test features
    data/training/y_test.parquet     -- (optional) held-out test labels

Artifacts written
-----------------
    models/artifacts/matchup_model.lgb          -- trained LightGBM model
    models/artifacts/feature_importance.json    -- feature importance dict
    models/artifacts/training_metadata.json     -- date, metrics, hyperparams

Usage
-----
    # Standard multiclass training
    python -m models.train_model

    # Custom data directory
    python -m models.train_model --data-dir data/training

    # Binary target (strikeouts vs everything else)
    python -m models.train_model --binary-target K

    # Tune learning rate
    python -m models.train_model --learning-rate 0.03 --n-estimators 1000

    # Skip CV (faster, useful for iteration)
    python -m models.train_model --no-cv
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    log_loss,
    precision_score,
    recall_score,
    classification_report,
)
from sklearn.model_selection import StratifiedKFold

warnings.filterwarnings("ignore", category=UserWarning)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("train_model")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

OUTCOME_CLASSES: List[str] = ["K", "BB", "HBP", "1B", "2B", "3B", "HR", "out"]
NUM_CLASSES: int = len(OUTCOME_CLASSES)

# MLB 2020-2024 approximate outcome frequencies (for class weighting)
OUTCOME_FREQ: Dict[str, float] = {
    "K":   0.224,
    "BB":  0.082,
    "HBP": 0.012,
    "1B":  0.152,
    "2B":  0.044,
    "3B":  0.004,
    "HR":  0.031,
    "out": 0.451,
}

# Default directories (relative to project root)
DEFAULT_DATA_DIR: str = "data/training"
DEFAULT_ARTIFACT_DIR: str = "models/artifacts"

# Sensible LightGBM hyperparameters tuned for this use case:
#   - Multiclass PA outcome prediction with ~32 mixed features
#   - Training set size: typically 500k-2M rows (5 MLB seasons)
#   - Rare classes (3B, HBP) require generous min_child_samples / class weights
DEFAULT_LGBM_PARAMS: Dict[str, Any] = {
    "objective": "multiclass",
    "num_class": NUM_CLASSES,
    "metric": ["multi_logloss", "multi_error"],
    "n_estimators": 800,
    "learning_rate": 0.05,
    "max_depth": 7,
    "num_leaves": 63,          # 2^(max_depth-1) - 1 is a good starting point
    "min_child_samples": 50,   # Prevents overfitting on rare outcomes (3B, HBP)
    "min_child_weight": 1e-3,
    "feature_fraction": 0.8,   # Sample 80% of features per tree
    "bagging_fraction": 0.85,  # Row subsampling
    "bagging_freq": 5,         # Apply bagging every 5 iterations
    "reg_alpha": 0.1,          # L1 regularization
    "reg_lambda": 1.0,         # L2 regularization
    "class_weight": "balanced",
    "verbose": -1,
    "n_jobs": -1,
    "random_state": 42,
    "importance_type": "gain", # Feature importance by gain (more reliable than split)
}

# For binary classification
DEFAULT_LGBM_PARAMS_BINARY: Dict[str, Any] = {
    "objective": "binary",
    "metric": ["binary_logloss", "binary_error"],
    "n_estimators": 600,
    "learning_rate": 0.05,
    "max_depth": 6,
    "num_leaves": 31,
    "min_child_samples": 50,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.85,
    "bagging_freq": 5,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "class_weight": "balanced",
    "verbose": -1,
    "n_jobs": -1,
    "random_state": 42,
    "importance_type": "gain",
}

N_CV_FOLDS: int = 5


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_parquet_pair(
    data_dir: Path,
    split: str = "train",
) -> Tuple[pd.DataFrame, np.ndarray]:
    """Load X_{split}.parquet and y_{split}.parquet from *data_dir*.

    Args:
        data_dir: Directory containing the parquet files.
        split: One of "train" or "test".

    Returns:
        Tuple of (X, y_array) where y_array is a 1-D int numpy array.

    Raises:
        FileNotFoundError: If the parquet files are absent.
    """
    x_path = data_dir / f"X_{split}.parquet"
    y_path = data_dir / f"y_{split}.parquet"

    if not x_path.exists():
        raise FileNotFoundError(
            f"Feature file not found: {x_path}\n"
            "Run pipeline/build_training_dataset.py first."
        )
    if not y_path.exists():
        raise FileNotFoundError(
            f"Label file not found: {y_path}\n"
            "Run pipeline/build_training_dataset.py first."
        )

    X = pd.read_parquet(x_path)
    y_df = pd.read_parquet(y_path)

    # build_training_dataset.py writes a single "label" column
    label_col = "label" if "label" in y_df.columns else y_df.columns[0]
    y = y_df[label_col].values.astype(int)

    logger.info(
        "Loaded %s split: X=%s  y=%s  (classes: %s)",
        split, X.shape, y.shape, np.unique(y).tolist(),
    )
    return X, y


# ---------------------------------------------------------------------------
# Cross-validation
# ---------------------------------------------------------------------------

def run_cross_validation(
    X: pd.DataFrame,
    y: np.ndarray,
    params: Dict[str, Any],
    n_folds: int = N_CV_FOLDS,
    binary: bool = False,
) -> Dict[str, Any]:
    """Perform stratified K-fold cross-validation and return aggregated metrics.

    Args:
        X: Feature DataFrame.
        y: Integer label array.
        params: LightGBM hyperparameters (without n_estimators for CV).
        n_folds: Number of folds (default: 5).
        binary: If True, compute binary classification metrics.

    Returns:
        Dict with per-fold and aggregate metrics: accuracy, log_loss, and
        per-class precision/recall for multiclass.
    """
    logger.info("Starting %d-fold stratified cross-validation ...", n_folds)

    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=42)

    fold_accuracies: List[float] = []
    fold_log_losses: List[float] = []
    fold_results: List[Dict[str, Any]] = []

    X_arr = X.values  # LightGBM accepts numpy arrays
    feature_names = list(X.columns)

    for fold_idx, (train_idx, val_idx) in enumerate(skf.split(X_arr, y), start=1):
        X_tr, X_va = X_arr[train_idx], X_arr[val_idx]
        y_tr, y_va = y[train_idx], y[val_idx]

        dtrain = lgb.Dataset(X_tr, label=y_tr, feature_name=feature_names, free_raw_data=False)
        dval = lgb.Dataset(X_va, label=y_va, feature_name=feature_names, reference=dtrain, free_raw_data=False)

        # Extract params without sklearn-style keys
        lgb_params = {k: v for k, v in params.items()
                      if k not in ("n_estimators", "class_weight", "random_state", "n_jobs")}
        lgb_params["seed"] = params.get("random_state", 42)
        lgb_params["num_threads"] = params.get("n_jobs", -1)

        # Handle class_weight
        if params.get("class_weight") == "balanced":
            classes, counts = np.unique(y_tr, return_counts=True)
            total = len(y_tr)
            weight_map = {int(c): total / (len(classes) * cnt) for c, cnt in zip(classes, counts)}
            sample_weights = np.array([weight_map.get(int(lbl), 1.0) for lbl in y_tr])
            dtrain = lgb.Dataset(X_tr, label=y_tr, weight=sample_weights,
                                 feature_name=feature_names, free_raw_data=False)

        callbacks = [lgb.early_stopping(stopping_rounds=50, verbose=False),
                     lgb.log_evaluation(period=-1)]

        booster = lgb.train(
            lgb_params,
            dtrain,
            num_boost_round=params.get("n_estimators", 800),
            valid_sets=[dval],
            callbacks=callbacks,
        )

        # Predict
        if binary:
            proba = booster.predict(X_va)  # shape (n,)
            preds = (proba >= 0.5).astype(int)
            acc = float(accuracy_score(y_va, preds))
            ll = float(log_loss(y_va, np.column_stack([1 - proba, proba])))
        else:
            proba = booster.predict(X_va)  # shape (n, num_class)
            preds = np.argmax(proba, axis=1)
            acc = float(accuracy_score(y_va, preds))
            ll = float(log_loss(y_va, proba, labels=list(range(NUM_CLASSES))))

        fold_accuracies.append(acc)
        fold_log_losses.append(ll)

        logger.info(
            "Fold %d/%d: accuracy=%.4f  log_loss=%.4f  best_iter=%d",
            fold_idx, n_folds, acc, ll, booster.best_iteration,
        )
        fold_results.append({
            "fold": fold_idx,
            "accuracy": acc,
            "log_loss": ll,
            "best_iteration": int(booster.best_iteration),
            "val_samples": int(len(y_va)),
        })

    cv_results = {
        "n_folds": n_folds,
        "fold_results": fold_results,
        "mean_accuracy": float(np.mean(fold_accuracies)),
        "std_accuracy": float(np.std(fold_accuracies)),
        "mean_log_loss": float(np.mean(fold_log_losses)),
        "std_log_loss": float(np.std(fold_log_losses)),
    }

    logger.info(
        "CV complete -- accuracy=%.4f+/-%.4f  log_loss=%.4f+/-%.4f",
        cv_results["mean_accuracy"], cv_results["std_accuracy"],
        cv_results["mean_log_loss"], cv_results["std_log_loss"],
    )
    return cv_results


# ---------------------------------------------------------------------------
# Full-data training
# ---------------------------------------------------------------------------

def train_final_model(
    X: pd.DataFrame,
    y: np.ndarray,
    params: Dict[str, Any],
    binary: bool = False,
) -> lgb.Booster:
    """Train a LightGBM model on the full training set with early stopping
    against a 10% validation hold-out.

    Args:
        X: Training feature DataFrame.
        y: Integer label array.
        params: LightGBM hyperparameters.
        binary: Whether this is a binary classification task.

    Returns:
        Trained lgb.Booster.
    """
    logger.info("Training final model on %d rows, %d features ...", len(X), X.shape[1])

    # 10% hold-out for early stopping on the final model
    rng = np.random.default_rng(42)
    n = len(X)
    val_n = max(1, int(n * 0.10))
    indices = rng.permutation(n)
    val_idx = indices[:val_n]
    train_idx = indices[val_n:]

    X_arr = X.values
    feature_names = list(X.columns)

    X_tr, X_va = X_arr[train_idx], X_arr[val_idx]
    y_tr, y_va = y[train_idx], y[val_idx]

    # Build sample weights for class balance
    lgb_params = {k: v for k, v in params.items()
                  if k not in ("n_estimators", "class_weight", "random_state", "n_jobs")}
    lgb_params["seed"] = params.get("random_state", 42)
    lgb_params["num_threads"] = params.get("n_jobs", -1)

    sample_weights = None
    if params.get("class_weight") == "balanced":
        classes, counts = np.unique(y_tr, return_counts=True)
        total = len(y_tr)
        weight_map = {int(c): total / (len(classes) * cnt) for c, cnt in zip(classes, counts)}
        sample_weights = np.array([weight_map.get(int(lbl), 1.0) for lbl in y_tr])

    dtrain = lgb.Dataset(X_tr, label=y_tr, weight=sample_weights,
                         feature_name=feature_names, free_raw_data=False)
    dval = lgb.Dataset(X_va, label=y_va, feature_name=feature_names,
                       reference=dtrain, free_raw_data=False)

    callbacks = [
        lgb.early_stopping(stopping_rounds=50, verbose=False),
        lgb.log_evaluation(period=100),
    ]

    booster = lgb.train(
        lgb_params,
        dtrain,
        num_boost_round=params.get("n_estimators", 800),
        valid_sets=[dval],
        callbacks=callbacks,
    )

    logger.info(
        "Final model trained. Best iteration: %d",
        booster.best_iteration,
    )
    return booster


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

def evaluate(
    booster: lgb.Booster,
    X: pd.DataFrame,
    y: np.ndarray,
    split_name: str = "test",
    binary: bool = False,
    outcome_classes: List[str] = OUTCOME_CLASSES,
) -> Dict[str, Any]:
    """Evaluate a trained booster on a labeled dataset.

    Args:
        booster: Trained lgb.Booster.
        X: Feature DataFrame.
        y: True integer labels.
        split_name: Label for log messages.
        binary: Whether this is binary classification.
        outcome_classes: Ordered class name list.

    Returns:
        Dict with accuracy, log_loss, and per-class precision/recall.
    """
    raw = booster.predict(X.values)

    if binary:
        proba = np.column_stack([1 - raw, raw])
        preds = (raw >= 0.5).astype(int)
        classes_used = ["not_target", "target"]
    else:
        proba = raw  # shape (n, num_class)
        preds = np.argmax(proba, axis=1)
        classes_used = outcome_classes

    acc = float(accuracy_score(y, preds))

    # log_loss requires labels argument when some classes may be absent in y
    n_cls = proba.shape[1] if proba.ndim == 2 else 2
    ll = float(log_loss(y, proba, labels=list(range(n_cls))))

    # Per-class precision / recall
    precision_per_class = precision_score(
        y, preds, average=None, zero_division=0, labels=list(range(n_cls))
    ).tolist()
    recall_per_class = recall_score(
        y, preds, average=None, zero_division=0, labels=list(range(n_cls))
    ).tolist()

    per_class: Dict[str, Dict[str, float]] = {}
    for i, cls_name in enumerate(classes_used):
        if i < len(precision_per_class):
            per_class[cls_name] = {
                "precision": round(precision_per_class[i], 4),
                "recall": round(recall_per_class[i], 4),
                "support": int((y == i).sum()),
            }

    # Full sklearn classification report for convenience
    target_names = classes_used[:n_cls]
    report = classification_report(
        y, preds,
        labels=list(range(n_cls)),
        target_names=target_names,
        output_dict=True,
        zero_division=0,
    )

    logger.info(
        "[%s]  accuracy=%.4f  log_loss=%.4f  n=%d",
        split_name, acc, ll, len(y),
    )

    return {
        "split": split_name,
        "n_samples": int(len(y)),
        "accuracy": round(acc, 6),
        "log_loss": round(ll, 6),
        "per_class_metrics": per_class,
        "classification_report": {
            k: v for k, v in report.items()
            if k not in ("accuracy",)  # already stored separately
        },
    }


# ---------------------------------------------------------------------------
# Feature importance
# ---------------------------------------------------------------------------

def build_feature_importance(
    booster: lgb.Booster,
    feature_names: List[str],
) -> Dict[str, Any]:
    """Build a feature importance dict from the trained booster.

    Returns both raw gain values and a ranked list for easy inspection.

    Args:
        booster: Trained lgb.Booster.
        feature_names: Ordered list of feature column names.

    Returns:
        Dict with raw importance values and top-ranked feature list.
    """
    gain = booster.feature_importance(importance_type="gain").tolist()
    split = booster.feature_importance(importance_type="split").tolist()

    # Normalise gain to [0, 1]
    total_gain = sum(gain) or 1.0
    gain_norm = [round(g / total_gain, 6) for g in gain]

    ranked = sorted(
        [{"feature": fn, "gain": g, "gain_normalized": gn, "split_count": s}
         for fn, g, gn, s in zip(feature_names, gain, gain_norm, split)],
        key=lambda x: x["gain"],
        reverse=True,
    )

    return {
        "importance_type": "gain",
        "feature_names": feature_names,
        "gain": gain,
        "gain_normalized": gain_norm,
        "split_count": split,
        "ranked": ranked,
    }


# ---------------------------------------------------------------------------
# Artifact persistence
# ---------------------------------------------------------------------------

def save_artifacts(
    booster: lgb.Booster,
    feature_importance: Dict[str, Any],
    training_metadata: Dict[str, Any],
    artifact_dir: Path,
) -> None:
    """Write model, feature importance, and metadata to *artifact_dir*.

    Args:
        booster: Trained lgb.Booster.
        feature_importance: Output of build_feature_importance().
        training_metadata: Metadata dict to persist.
        artifact_dir: Destination directory (created if missing).
    """
    artifact_dir.mkdir(parents=True, exist_ok=True)

    # -- Model binary
    model_path = artifact_dir / "matchup_model.lgb"
    booster.save_model(str(model_path))
    logger.info("Model saved to %s", model_path)

    # -- Feature importance
    fi_path = artifact_dir / "feature_importance.json"
    with open(fi_path, "w") as fh:
        json.dump(feature_importance, fh, indent=2)
    logger.info("Feature importance saved to %s", fi_path)

    # -- Training metadata
    meta_path = artifact_dir / "training_metadata.json"
    with open(meta_path, "w") as fh:
        json.dump(training_metadata, fh, indent=2)
    logger.info("Training metadata saved to %s", meta_path)


# ---------------------------------------------------------------------------
# Summary printing
# ---------------------------------------------------------------------------

def print_summary(
    training_metadata: Dict[str, Any],
    feature_importance: Dict[str, Any],
) -> None:
    """Print a formatted training summary to stdout."""
    sep = "=" * 64
    m = training_metadata
    cv = m.get("cv_results", {}) or {}
    eval_test = m.get("test_eval") or {}

    lines = [
        sep,
        "  BaselineMLB LightGBM Training Summary",
        sep,
        f"  Model type  : {m.get('model_type', 'N/A')}",
        f"  Trained at  : {m.get('trained_at', 'N/A')}",
        f"  Features    : {m.get('n_features', 'N/A')}",
        f"  Best iter   : {m.get('best_iteration', 'N/A')}",
        sep,
        f"  {'Metric':<20s}  {'CV Mean':>10s}  {'CV Std':>10s}  {'Test':>10s}",
        f"  {'-'*20}  {'-'*10}  {'-'*10}  {'-'*10}",
        (
            f"  {'Accuracy':<20s}  "
            f"{cv.get('mean_accuracy', 0.0):>10.4f}  "
            f"{cv.get('std_accuracy', 0.0):>10.4f}  "
            f"{str(eval_test.get('accuracy', 'N/A')):>10s}"
        ),
        (
            f"  {'Log Loss':<20s}  "
            f"{cv.get('mean_log_loss', 0.0):>10.4f}  "
            f"{cv.get('std_log_loss', 0.0):>10.4f}  "
            f"{str(eval_test.get('log_loss', 'N/A')):>10s}"
        ),
        sep,
        "  Top-10 Features by Gain",
        f"  {'-'*48}",
    ]

    for rank, entry in enumerate(feature_importance.get("ranked", [])[:10], start=1):
        lines.append(
            f"  {rank:>2d}. {entry['feature']:<35s}  {entry['gain_normalized']:.5f}"
        )

    if eval_test and "per_class_metrics" in eval_test:
        lines += [sep, "  Per-Class Test Metrics", f"  {'-'*48}"]
        for cls_name, metrics in eval_test["per_class_metrics"].items():
            lines.append(
                f"  {cls_name:<6s}  "
                f"precision={metrics['precision']:.3f}  "
                f"recall={metrics['recall']:.3f}  "
                f"support={metrics['support']:,}"
            )

    lines.append(sep)
    print("\n".join(lines))


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_training(
    data_dir: str,
    artifact_dir: str,
    run_cv: bool,
    binary_target: Optional[str],
    lgbm_params: Dict[str, Any],
) -> None:
    """End-to-end training pipeline.

    Args:
        data_dir: Directory with X_train.parquet / y_train.parquet.
        artifact_dir: Destination for model artifacts.
        run_cv: Whether to run 5-fold CV before fitting the final model.
        binary_target: If set (e.g. "K"), run binary classification.
        lgbm_params: LightGBM hyperparameter dict.
    """
    start_ts = time.time()
    data_path = Path(data_dir)
    artifact_path = Path(artifact_dir)
    binary = binary_target is not None

    # -- Load training data
    X_train, y_train = load_parquet_pair(data_path, split="train")
    n_features = X_train.shape[1]
    feature_names = list(X_train.columns)

    # -- Load test data if available
    X_test, y_test = None, None
    try:
        X_test, y_test = load_parquet_pair(data_path, split="test")
    except FileNotFoundError:
        logger.warning("No test split found -- skipping test evaluation.")

    # -- Determine outcome classes for this run
    if binary:
        target_name = binary_target
        classes_used = [f"not_{target_name}", target_name]
        model_type = f"lightgbm_binary_{target_name}_vs_rest"
        params = DEFAULT_LGBM_PARAMS_BINARY.copy()
        params.update({k: v for k, v in lgbm_params.items()
                       if k in DEFAULT_LGBM_PARAMS_BINARY})
    else:
        classes_used = OUTCOME_CLASSES
        model_type = "lightgbm_multiclass"
        params = lgbm_params.copy()

    logger.info(
        "Training %s | %d features | %d train samples | binary=%s",
        model_type, n_features, len(X_train), binary,
    )

    # -- Cross-validation
    cv_results: Optional[Dict[str, Any]] = None
    if run_cv:
        cv_results = run_cross_validation(
            X_train, y_train, params, n_folds=N_CV_FOLDS, binary=binary
        )
    else:
        logger.info("CV skipped (--no-cv flag set).")

    # -- Train final model
    booster = train_final_model(X_train, y_train, params, binary=binary)

    # -- Evaluate
    train_eval = evaluate(booster, X_train, y_train, "train", binary, classes_used)
    test_eval = None
    if X_test is not None and y_test is not None:
        test_eval = evaluate(booster, X_test, y_test, "test", binary, classes_used)

    # -- Feature importance
    feature_importance = build_feature_importance(booster, feature_names)

    # -- Build metadata
    elapsed = round(time.time() - start_ts, 2)
    training_metadata: Dict[str, Any] = {
        "model_type": model_type,
        "status": "trained",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "elapsed_seconds": elapsed,
        "outcome_classes": classes_used,
        "n_features": n_features,
        "feature_names": feature_names,
        "n_train_samples": int(len(X_train)),
        "n_test_samples": int(len(X_test)) if X_test is not None else None,
        "best_iteration": int(booster.best_iteration),
        "hyperparameters": params,
        "cv_results": cv_results,
        "train_eval": train_eval,
        "test_eval": test_eval,
        "data_dir": str(data_path.resolve()),
        "artifact_dir": str(artifact_path.resolve()),
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    }

    # -- Save artifacts
    save_artifacts(booster, feature_importance, training_metadata, artifact_path)

    # -- Print summary
    print_summary(training_metadata, feature_importance)
    print(f"\n  Elapsed: {elapsed:.1f}s")
    print(f"  Model  : {artifact_path / 'matchup_model.lgb'}")
    print(f"  Metadata: {artifact_path / 'training_metadata.json'}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the BaselineMLB LightGBM matchup model.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--data-dir",
        default=DEFAULT_DATA_DIR,
        help="Directory containing X_train.parquet and y_train.parquet",
    )
    parser.add_argument(
        "--artifact-dir",
        default=DEFAULT_ARTIFACT_DIR,
        help="Directory where model artifacts will be written",
    )
    parser.add_argument(
        "--binary-target",
        default=None,
        choices=OUTCOME_CLASSES,
        metavar="OUTCOME",
        help=(
            "Train a binary classifier (OUTCOME vs rest). "
            f"Choices: {', '.join(OUTCOME_CLASSES)}"
        ),
    )
    parser.add_argument(
        "--no-cv",
        action="store_true",
        help="Skip 5-fold cross-validation (faster for iteration)",
    )
    parser.add_argument(
        "--n-estimators",
        type=int,
        default=None,
        help="Override n_estimators hyperparameter",
    )
    parser.add_argument(
        "--learning-rate",
        type=float,
        default=None,
        help="Override learning_rate hyperparameter",
    )
    parser.add_argument(
        "--max-depth",
        type=int,
        default=None,
        help="Override max_depth hyperparameter",
    )
    parser.add_argument(
        "--num-leaves",
        type=int,
        default=None,
        help="Override num_leaves hyperparameter",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # Build hyperparameter dict from defaults + CLI overrides
    binary = args.binary_target is not None
    base_params = DEFAULT_LGBM_PARAMS_BINARY.copy() if binary else DEFAULT_LGBM_PARAMS.copy()

    overrides = {
        k: v for k, v in {
            "n_estimators": args.n_estimators,
            "learning_rate": args.learning_rate,
            "max_depth": args.max_depth,
            "num_leaves": args.num_leaves,
        }.items() if v is not None
    }
    base_params.update(overrides)
    if overrides:
        logger.info("Hyperparameter overrides: %s", overrides)

    try:
        run_training(
            data_dir=args.data_dir,
            artifact_dir=args.artifact_dir,
            run_cv=not args.no_cv,
            binary_target=args.binary_target,
            lgbm_params=base_params,
        )
    except FileNotFoundError as exc:
        logger.error("%s", exc)
        sys.exit(1)
    except KeyboardInterrupt:
        logger.warning("Training interrupted by user.")
        sys.exit(130)


if __name__ == "__main__":
    main()

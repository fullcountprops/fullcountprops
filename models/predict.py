#!/usr/bin/env python3
"""
predict.py — BaselineMLB Matchup Prediction API

Loads the trained model artifact and returns PA outcome probability
vectors for any batter/pitcher matchup.  This is the interface used
by the Monte Carlo game simulator.

Usage as a module (primary — called by the simulator engine):

    from models.predict import MatchupPredictor

    predictor = MatchupPredictor()  # auto-loads latest model artifact

    # Single matchup
    probs = predictor.predict(
        pitcher_features={"p_k_pct": 0.28, "p_swstr_pct": 0.13, ...},
        batter_features={"b_k_pct": 0.22, "b_xba": 0.260, ...},
        context={"platoon": 1, "park_factor_hr": 105, "temp_f": 78, ...},
    )
    # → {"strikeout": 0.247, "walk": 0.076, ..., "popup": 0.031}

    # With SHAP explanations
    result = predictor.predict_explained(pitcher_features, batter_features, context)
    # → {"probabilities": {...}, "explanations": {...}}

    # Batch prediction (for full lineups)
    probs_matrix = predictor.predict_batch(lineup_df)
    # → np.ndarray of shape (n_batters, 11)

Usage as CLI (for testing / debugging):

    python -m models.predict \\
        --pitcher-k-pct 0.28 \\
        --pitcher-swstr 0.13 \\
        --batter-k-pct 0.22 \\
        --batter-xba 0.260 \\
        --platoon 1 \\
        --park-hr 105

    python -m models.predict --demo
"""

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

# ── Ensure project root is on PYTHONPATH ──
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from models.matchup_model import MatchupModel
from models.feature_config import (
    PA_OUTCOMES,
    OUTCOME_SHORT,
    FEATURE_NAMES,
    FEATURE_DEFAULTS,
    LEAGUE_AVG_PROBS,
    NUM_CLASSES,
)

log = logging.getLogger("baselinemlb.predict")

# Default model artifact path
DEFAULT_MODEL_PATH = "models/artifacts/matchup_model.joblib"


class MatchupPredictor:
    """
    High-level prediction interface for the matchup probability model.

    Loads a trained model artifact and provides methods for:
        - Single matchup predictions
        - Batch predictions (full lineups)
        - SHAP-explained predictions
        - Fallback to league averages when model is unavailable
    """

    def __init__(self, model_path: str = None, use_calibrated: bool = True):
        """
        Initialize the predictor.

        Args:
            model_path:     Path to joblib model artifact. If None, uses
                            default path. Falls back to league averages
                            if model file doesn't exist.
            use_calibrated: Whether to use calibrated probabilities.
        """
        self.model_path = model_path or DEFAULT_MODEL_PATH
        self.use_calibrated = use_calibrated
        self.model: Optional[MatchupModel] = None
        self._using_fallback = False

        self._load_model()

    def _load_model(self) -> None:
        """Load model artifact, fall back to league averages if unavailable."""
        path = Path(self.model_path)
        if path.exists():
            try:
                self.model = MatchupModel.load(str(path))
                log.info(
                    f"Model loaded: {path.name} "
                    f"(val log-loss: {self.model.training_metrics.get('val_log_loss', '?')})"
                )
                self._using_fallback = False
            except Exception as e:
                log.warning(f"Failed to load model from {path}: {e}")
                self._using_fallback = True
        else:
            log.warning(
                f"Model artifact not found at {path}. "
                "Using league-average fallback. "
                "Train a model with: python -m models.train_model"
            )
            self._using_fallback = True

    @property
    def is_ready(self) -> bool:
        """True if a trained model is loaded (not using fallback)."""
        return not self._using_fallback and self.model is not None

    # ─── Core Prediction Methods ─────────────────────────────────────

    def predict(
        self,
        pitcher_features: Dict[str, float] = None,
        batter_features: Dict[str, float] = None,
        context: Dict[str, float] = None,
    ) -> Dict[str, float]:
        """
        Predict PA outcome probabilities for a single matchup.

        Args:
            pitcher_features:  Dict of pitcher stats
                               (keys: p_k_pct, p_swstr_pct, etc.)
            batter_features:   Dict of batter stats
                               (keys: b_k_pct, b_xba, etc.)
            context:           Dict of contextual features
                               (keys: platoon, park_factor_hr, temp_f, etc.)

        Returns:
            Dict mapping outcome labels to probabilities.
            Always sums to ~1.0.
        """
        features = self._merge_features(pitcher_features, batter_features, context)

        if self._using_fallback:
            return self._fallback_prediction(features)

        return self.model.predict_matchup(features, calibrated=self.use_calibrated)

    def predict_proba_array(
        self,
        pitcher_features: Dict[str, float] = None,
        batter_features: Dict[str, float] = None,
        context: Dict[str, float] = None,
    ) -> np.ndarray:
        """
        Like predict() but returns a raw numpy array of shape (11,)
        in PA_OUTCOMES order. Optimized for the Monte Carlo simulator
        which needs fast array access for random sampling.
        """
        features = self._merge_features(pitcher_features, batter_features, context)

        if self._using_fallback:
            return np.array([LEAGUE_AVG_PROBS[o] for o in PA_OUTCOMES])

        row = pd.DataFrame([features])
        probs = self.model.predict_proba(row, calibrated=self.use_calibrated)
        return probs[0]

    def predict_batch(
        self,
        features_df: pd.DataFrame,
    ) -> np.ndarray:
        """
        Batch prediction for multiple matchups (e.g., full lineup).

        Args:
            features_df:  DataFrame where each row is a matchup,
                          with feature columns from feature_config.

        Returns:
            np.ndarray of shape (n_matchups, 11) — probability vectors.
        """
        if self._using_fallback:
            n = len(features_df)
            base = np.array([LEAGUE_AVG_PROBS[o] for o in PA_OUTCOMES])
            return np.tile(base, (n, 1))

        return self.model.predict_proba(features_df, calibrated=self.use_calibrated)

    def predict_explained(
        self,
        pitcher_features: Dict[str, float] = None,
        batter_features: Dict[str, float] = None,
        context: Dict[str, float] = None,
    ) -> Dict:
        """
        Predict with SHAP explanations — shows WHY each probability
        is what it is.

        Returns:
            {
                "probabilities": {"strikeout": 0.247, ...},
                "explanations": {
                    "strikeout": [
                        {"feature": "p_swstr_pct", "value": 0.13,
                         "shap": 0.042, "direction": "+"},
                        ...
                    ],
                    ...
                },
                "model_version": "1.0.0",
                "using_fallback": false
            }
        """
        features = self._merge_features(pitcher_features, batter_features, context)

        result = {
            "model_version": "1.0.0",
            "using_fallback": self._using_fallback,
        }

        if self._using_fallback:
            result["probabilities"] = self._fallback_prediction(features)
            result["explanations"] = {
                o: [{"note": "Using league average — no trained model loaded"}]
                for o in PA_OUTCOMES
            }
            return result

        explained = self.model.explain_matchup(features)
        result["probabilities"] = explained["probabilities"]
        result["explanations"] = explained["explanations"]

        return result

    # ─── Helper Methods ──────────────────────────────────────────────

    def _merge_features(
        self,
        pitcher_features: Dict = None,
        batter_features: Dict = None,
        context: Dict = None,
    ) -> Dict[str, float]:
        """Merge all feature dicts into a single row dict."""
        features = {}
        if pitcher_features:
            features.update(pitcher_features)
        if batter_features:
            features.update(batter_features)
        if context:
            features.update(context)
        return features

    def _fallback_prediction(self, features: Dict) -> Dict[str, float]:
        """
        Generate predictions using league averages, adjusted by
        available pitcher/batter features.

        This is used when no trained model is available, but we still
        need probability vectors for the simulator.
        """
        probs = {o: p for o, p in LEAGUE_AVG_PROBS.items()}

        # Adjust K probability with available pitcher/batter K rates
        p_k = features.get("p_k_pct", FEATURE_DEFAULTS["p_k_pct"])
        b_k = features.get("b_k_pct", FEATURE_DEFAULTS["b_k_pct"])
        avg_k = FEATURE_DEFAULTS["p_k_pct"]

        if p_k and b_k and avg_k > 0:
            k_multiplier = ((p_k + b_k) / 2) / avg_k
            probs["strikeout"] *= k_multiplier

        # Adjust BB with pitcher/batter BB rates
        p_bb = features.get("p_bb_pct", FEATURE_DEFAULTS["p_bb_pct"])
        b_bb = features.get("b_bb_pct", FEATURE_DEFAULTS["b_bb_pct"])
        avg_bb = FEATURE_DEFAULTS["p_bb_pct"]

        if p_bb and b_bb and avg_bb > 0:
            bb_multiplier = ((p_bb + b_bb) / 2) / avg_bb
            probs["walk"] *= bb_multiplier

        # Adjust HR with park factor and barrel rate
        park_hr = features.get("park_factor_hr", 100.0) / 100.0
        barrel = features.get("b_barrel_pct", FEATURE_DEFAULTS["b_barrel_pct"])
        avg_barrel = FEATURE_DEFAULTS["b_barrel_pct"]

        if barrel and avg_barrel > 0:
            hr_multiplier = park_hr * (barrel / avg_barrel)
            probs["home_run"] *= hr_multiplier

        # Re-normalize
        total = sum(probs.values())
        probs = {k: round(v / total, 5) for k, v in probs.items()}

        return probs

    def get_model_info(self) -> Dict:
        """Return model metadata for API responses."""
        info = {
            "model_ready": self.is_ready,
            "using_fallback": self._using_fallback,
            "model_path": str(self.model_path),
            "outcome_classes": PA_OUTCOMES,
            "num_features": len(FEATURE_NAMES),
        }

        if self.model and self.model.training_metrics:
            metrics = self.model.training_metrics
            info["val_log_loss"] = metrics.get("val_log_loss")
            info["val_accuracy"] = metrics.get("val_accuracy")
            info["best_iteration"] = metrics.get("best_iteration")
            info["n_train"] = metrics.get("n_train")

            if "baseline_comparison" in metrics:
                bc = metrics["baseline_comparison"]
                info["test_log_loss"] = bc.get("model", {}).get("log_loss")
                info["improvement_vs_league"] = bc.get("improvement", {}).get(
                    "vs_league_avg_pct"
                )
                info["improvement_vs_career"] = bc.get("improvement", {}).get(
                    "vs_career_avg_pct"
                )

        return info


# ═══════════════════════════════════════════════════════════════════════════
# Convenience Functions (for the simulator to import directly)
# ═══════════════════════════════════════════════════════════════════════════

# Singleton predictor — lazily initialized
_predictor: Optional[MatchupPredictor] = None


def get_predictor(model_path: str = None) -> MatchupPredictor:
    """
    Get or create the global MatchupPredictor singleton.

    The simulator calls this once at startup to load the model,
    then reuses it for all predictions during the simulation.
    """
    global _predictor
    if _predictor is None or (model_path and model_path != _predictor.model_path):
        _predictor = MatchupPredictor(model_path=model_path)
    return _predictor


def predict_pa(
    pitcher_features: Dict[str, float] = None,
    batter_features: Dict[str, float] = None,
    context: Dict[str, float] = None,
    model_path: str = None,
) -> Dict[str, float]:
    """
    Top-level convenience function for single PA prediction.

    This is the simplest API for the simulator:

        from models.predict import predict_pa
        probs = predict_pa(
            pitcher_features={"p_k_pct": 0.28},
            batter_features={"b_k_pct": 0.22},
            context={"platoon": 1},
        )
    """
    predictor = get_predictor(model_path)
    return predictor.predict(pitcher_features, batter_features, context)


def predict_pa_array(
    pitcher_features: Dict[str, float] = None,
    batter_features: Dict[str, float] = None,
    context: Dict[str, float] = None,
    model_path: str = None,
) -> np.ndarray:
    """
    Like predict_pa() but returns numpy array for fast Monte Carlo sampling.

    The simulator uses this with np.random.choice(outcomes, p=probs)
    to resolve each plate appearance.
    """
    predictor = get_predictor(model_path)
    return predictor.predict_proba_array(pitcher_features, batter_features, context)


# ═══════════════════════════════════════════════════════════════════════════
# CLI Demo / Testing
# ═══════════════════════════════════════════════════════════════════════════

def demo_prediction() -> None:
    """Run a demo prediction with sample features."""

    print("=" * 60)
    print("BaselineMLB Matchup Prediction — Demo")
    print("=" * 60)

    predictor = MatchupPredictor()
    info = predictor.get_model_info()

    print(f"\nModel ready: {info['model_ready']}")
    print(f"Using fallback: {info['using_fallback']}")
    if info.get("val_log_loss"):
        print(f"Val log-loss: {info['val_log_loss']:.5f}")

    # Sample matchup: elite pitcher vs average batter
    pitcher = {
        "p_k_pct": 0.30,
        "p_bb_pct": 0.06,
        "p_swstr_pct": 0.14,
        "p_csw_pct": 0.32,
        "p_zone_pct": 0.47,
        "p_whiff_fastball": 0.25,
        "p_whiff_breaking": 0.38,
        "p_whiff_offspeed": 0.35,
        "p_ff_pct": 0.45,
        "p_sl_pct": 0.30,
        "p_ch_pct": 0.15,
        "p_ff_velo": 96.5,
    }

    batter = {
        "b_k_pct": 0.24,
        "b_bb_pct": 0.08,
        "b_xba": 0.250,
        "b_xslg": 0.400,
        "b_barrel_pct": 0.07,
        "b_chase_pct": 0.30,
        "b_avg_exit_velo": 88.5,
    }

    context = {
        "platoon": 0,           # different handedness
        "platoon_advantage": -1, # batter has platoon advantage
        "park_factor_hr": 105,
        "park_factor_k": 102,
        "park_factor_r": 103,
        "temp_f": 78,
        "wind_mph": 8,
        "game_total": 8.5,
        "ump_ez_rate": 0.02,
    }

    print("\n── Matchup: Elite Pitcher vs. Average Batter ──")
    print(f"  Pitcher: K%={pitcher['p_k_pct']:.0%}, SwStr%={pitcher['p_swstr_pct']:.0%}, "
          f"FB velo={pitcher['p_ff_velo']}mph")
    print(f"  Batter:  K%={batter['b_k_pct']:.0%}, xBA={batter['b_xba']:.3f}, "
          f"Barrel%={batter['b_barrel_pct']:.0%}")
    print(f"  Context: Platoon adv=batter, Park HR factor={context['park_factor_hr']}, "
          f"Temp={context['temp_f']}°F")

    probs = predictor.predict(pitcher, batter, context)

    print("\n── Predicted Outcome Probabilities ──")
    print(f"  {'Outcome':15s}  {'Prob':>7s}  {'Short':>5s}")
    print(f"  {'─' * 15}  {'─' * 7}  {'─' * 5}")
    for outcome in PA_OUTCOMES:
        p = probs[outcome]
        short = OUTCOME_SHORT[outcome]
        bar = "█" * int(p * 100)
        print(f"  {outcome:15s}  {p:7.1%}  {short:>5s}  {bar}")

    print(f"\n  Total: {sum(probs.values()):.4f}")

    # ── Compare: same pitcher vs. slugger ──
    slugger = {
        "b_k_pct": 0.30,
        "b_bb_pct": 0.12,
        "b_xba": 0.290,
        "b_xslg": 0.550,
        "b_barrel_pct": 0.15,
        "b_chase_pct": 0.25,
        "b_avg_exit_velo": 92.5,
    }

    print("\n── Same Pitcher vs. Power Slugger ──")
    print(f"  Batter: K%={slugger['b_k_pct']:.0%}, xBA={slugger['b_xba']:.3f}, "
          f"Barrel%={slugger['b_barrel_pct']:.0%}, EV={slugger['b_avg_exit_velo']}mph")

    probs2 = predictor.predict(pitcher, slugger, context)

    print(f"\n  {'Outcome':15s}  {'Avg Batter':>10s}  {'Slugger':>10s}  {'Δ':>8s}")
    print(f"  {'─' * 15}  {'─' * 10}  {'─' * 10}  {'─' * 8}")
    for outcome in PA_OUTCOMES:
        p1 = probs[outcome]
        p2 = probs2[outcome]
        delta = p2 - p1
        print(f"  {outcome:15s}  {p1:10.1%}  {p2:10.1%}  {delta:+8.1%}")


def cli_prediction(args: argparse.Namespace) -> None:
    """Handle CLI prediction with user-supplied features."""

    predictor = MatchupPredictor(model_path=args.model)

    features = {}
    if args.pitcher_k_pct:
        features["p_k_pct"] = args.pitcher_k_pct
    if args.pitcher_swstr:
        features["p_swstr_pct"] = args.pitcher_swstr
    if args.batter_k_pct:
        features["b_k_pct"] = args.batter_k_pct
    if args.batter_xba:
        features["b_xba"] = args.batter_xba
    if args.batter_barrel:
        features["b_barrel_pct"] = args.batter_barrel
    if args.platoon is not None:
        features["platoon"] = args.platoon
    if args.park_hr:
        features["park_factor_hr"] = args.park_hr
    if args.park_k:
        features["park_factor_k"] = args.park_k
    if args.temp:
        features["temp_f"] = args.temp
    if args.game_total:
        features["game_total"] = args.game_total

    if args.explain:
        result = predictor.predict_explained(features)
        print(json.dumps(result, indent=2))
    else:
        probs = predictor.predict(features)
        if args.json:
            print(json.dumps(probs, indent=2))
        else:
            print(f"\n{'Outcome':15s}  {'Probability':>11s}")
            print(f"{'─' * 15}  {'─' * 11}")
            for outcome in PA_OUTCOMES:
                print(f"{outcome:15s}  {probs[outcome]:11.4%}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Predict plate appearance outcome probabilities",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("--demo", action="store_true", help="Run demo prediction")
    parser.add_argument("--model", default=None, help="Path to model artifact")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--explain", action="store_true", help="Include SHAP explanations")

    # Feature inputs
    feat = parser.add_argument_group("features")
    feat.add_argument("--pitcher-k-pct", type=float, help="Pitcher K%%")
    feat.add_argument("--pitcher-swstr", type=float, help="Pitcher SwStr%%")
    feat.add_argument("--batter-k-pct", type=float, help="Batter K%%")
    feat.add_argument("--batter-xba", type=float, help="Batter xBA")
    feat.add_argument("--batter-barrel", type=float, help="Batter barrel%%")
    feat.add_argument("--platoon", type=int, help="1=same hand, 0=different")
    feat.add_argument("--park-hr", type=float, help="Park HR factor (100=neutral)")
    feat.add_argument("--park-k", type=float, help="Park K factor (100=neutral)")
    feat.add_argument("--temp", type=float, help="Temperature (°F)")
    feat.add_argument("--game-total", type=float, help="Vegas game total")

    return parser.parse_args()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    args = parse_args()
    if args.demo:
        demo_prediction()
    else:
        cli_prediction(args)

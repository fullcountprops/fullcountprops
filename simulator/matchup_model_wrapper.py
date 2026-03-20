"""
Wrapper that assembles the 41-feature vector for a pitcher-batter matchup
and returns 8-class outcome probabilities from the trained LightGBM model.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np

from simulator.player_features import load_player_features

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
_DEFAULT_MODEL_PATH = str(PROJECT_ROOT / "models" / "trained" / "matchup_model.joblib")
_FEATURE_METADATA_PATH = PROJECT_ROOT / "data" / "training" / "feature_metadata.json"
_OUTCOME_LABELS = ["K", "BB", "HBP", "1B", "2B", "3B", "HR", "out"]

# Module-level singleton — loaded once per process
_instance: MatchupModelWrapper | None = None  # type: ignore[name-defined]


class MatchupModelWrapper:
    """Bridge between the Monte Carlo simulator and the trained LightGBM model."""

    def __init__(self, model_path: str | None = None) -> None:
        import joblib  # type: ignore[import]

        path = model_path or _DEFAULT_MODEL_PATH
        self.model = joblib.load(path)
        logger.info("Loaded LightGBM model from %s", path)

        with open(_FEATURE_METADATA_PATH) as f:
            metadata = json.load(f)
        self.feature_columns: list[str] = metadata["feature_columns"]

        self.pitcher_features, self.batter_features = load_player_features()

        self._league_avg_pitcher: dict[str, Any] = self._mean_features(self.pitcher_features)
        self._league_avg_batter: dict[str, Any] = self._mean_features(self.batter_features)

    @staticmethod
    def _mean_features(feature_dict: dict[int, dict[str, Any]]) -> dict[str, Any]:
        """Compute mean of all numeric features across all players."""
        if not feature_dict:
            return {}
        totals: dict[str, float] = defaultdict(float)
        counts: dict[str, int] = defaultdict(int)
        for player_feats in feature_dict.values():
            for k, v in player_feats.items():
                if isinstance(v, (int, float)):
                    totals[k] += float(v)
                    counts[k] += 1
        return {k: totals[k] / counts[k] for k in totals}

    def predict_proba_for_matchup(
        self,
        pitcher_id: int | str,
        batter_id: int | str,
        context: dict[str, Any] | None = None,
    ) -> dict[str, float]:
        """Return 8-class outcome probabilities for a pitcher-batter matchup.

        Falls back to league-average features for unknown players.
        """
        try:
            pid = int(pitcher_id)
        except (ValueError, TypeError):
            pid = -1
        try:
            bid = int(batter_id)
        except (ValueError, TypeError):
            bid = -1

        p_feats = self.pitcher_features.get(pid, self._league_avg_pitcher)
        b_feats = self.batter_features.get(bid, self._league_avg_batter)

        p_throws = str(p_feats.get("p_throws", "R"))
        b_stands = str(b_feats.get("b_stands", "R"))

        matchup_feats = {
            "platoon_same": 1.0 if p_throws == b_stands else 0.0,
            "platoon_opposite": 1.0 if p_throws != b_stands else 0.0,
            "p_throws_L": 1.0 if p_throws == "L" else 0.0,
            "b_stands_L": 1.0 if b_stands == "L" else 0.0,
        }

        ctx = context or {}
        context_feats = {
            "park_factor_hr": float(ctx.get("park_factor_hr", 1.0)),
            "park_factor_hit": float(ctx.get("park_factor_hit", 1.0)),
            "temp_f": float(ctx.get("temp_f", 72.0)),
            "wind_mph": float(ctx.get("wind_mph", 5.0)),
            "wind_out": float(ctx.get("wind_out", 0.0)),
            "umpire_k_delta": float(ctx.get("umpire_k_delta", 0.0)),
            "umpire_bb_delta": float(ctx.get("umpire_bb_delta", 0.0)),
            "inning": float(ctx.get("inning", 1)),
            "score_diff": float(ctx.get("score_diff", 0)),
        }

        all_feats = {**p_feats, **b_feats, **matchup_feats, **context_feats}
        vector = np.array(
            [float(all_feats.get(col, 0.0)) for col in self.feature_columns],
            dtype=np.float32,
        )

        raw = self.model.predict(vector.reshape(1, -1))
        probs_array = np.array(raw).flatten()

        probs = {label: float(probs_array[i]) for i, label in enumerate(_OUTCOME_LABELS)}
        total = sum(probs.values())
        if total > 0:
            probs = {k: v / total for k, v in probs.items()}
        return probs

    def has_player_data(self, pitcher_id: int | str, batter_id: int | str) -> bool:
        """Return True if both players are in the feature lookup."""
        try:
            pid = int(pitcher_id)
        except (ValueError, TypeError):
            return False
        try:
            bid = int(batter_id)
        except (ValueError, TypeError):
            return False
        return pid in self.pitcher_features and bid in self.batter_features


def get_wrapper(model_path: str | None = None) -> MatchupModelWrapper:
    """Return the module-level singleton MatchupModelWrapper."""
    global _instance
    if _instance is None:
        _instance = MatchupModelWrapper(model_path=model_path)
    return _instance

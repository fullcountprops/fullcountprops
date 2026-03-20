"""
Pre-compute player feature vectors from Statcast PA-level data.

Loads the per-year Statcast feature parquets and computes season averages
for each pitcher and batter. Returns lookup dicts used by the model wrapper.

Usage:
    from simulator.player_features import load_player_features
    pitcher_features, batter_features = load_player_features()
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"

_PITCHER_NUMERIC_COLS = [
    "p_avg_velo", "p_swstr_pct", "p_csw_pct", "p_zone_pct", "p_k_pct", "p_bb_pct",
    "p_gb_rate", "p_fb_rate", "p_ld_rate", "p_pct_fastball", "p_pct_slider",
    "p_pct_curve", "p_pct_change", "p_pct_cutter", "p_whiff_fastball",
    "p_whiff_slider", "p_whiff_curve", "p_whiff_change", "p_whiff_cutter",
]

_BATTER_NUMERIC_COLS = [
    "b_k_pct", "b_bb_pct", "b_xba", "b_xslg", "b_barrel_pct", "b_chase_rate",
    "b_whiff_pct", "b_avg_ev", "b_hard_hit_pct",
]

# Simple module-level cache — populated once per process
_cache: dict[str, Any] = {}


def load_player_features() -> tuple[dict[int, dict[str, Any]], dict[int, dict[str, Any]]]:
    """Return (pitcher_features, batter_features) dicts keyed by MLBAM player ID.

    Results are cached in memory after the first call.
    """
    if "pitcher_features" in _cache:
        return _cache["pitcher_features"], _cache["batter_features"]

    import pandas as pd  # type: ignore[import]

    parquet_path = DATA_DIR / "statcast_pa_features_2025_2025.parquet"
    if not parquet_path.exists():
        parquet_path = DATA_DIR / "statcast_pa_features_2020_2024.parquet"

    if not parquet_path.exists():
        logger.warning("No Statcast parquet found — player feature lookup unavailable.")
        _cache["pitcher_features"] = {}
        _cache["batter_features"] = {}
        return {}, {}

    logger.info("Loading player features from %s", parquet_path)
    df = pd.read_parquet(parquet_path)

    # --- Pitcher features ---
    p_cols = [c for c in _PITCHER_NUMERIC_COLS if c in df.columns]
    global_p_means = df[p_cols].mean()
    df[p_cols] = df[p_cols].fillna(global_p_means)

    pitcher_df = df.groupby("pitcher_id")[p_cols].mean()
    if "p_throws" in df.columns:
        pitcher_throws = df.groupby("pitcher_id")["p_throws"].agg(
            lambda x: x.mode().iloc[0] if len(x) > 0 else "R"
        )
        pitcher_df = pitcher_df.join(pitcher_throws)

    pitcher_features: dict[int, dict[str, Any]] = {
        int(pid): row.to_dict() for pid, row in pitcher_df.iterrows()
    }

    # --- Batter features ---
    b_cols = [c for c in _BATTER_NUMERIC_COLS if c in df.columns]
    global_b_means = df[b_cols].mean()
    df[b_cols] = df[b_cols].fillna(global_b_means)

    batter_df = df.groupby("batter_id")[b_cols].mean()
    if "b_stands" in df.columns:
        batter_stands = df.groupby("batter_id")["b_stands"].agg(
            lambda x: x.mode().iloc[0] if len(x) > 0 else "R"
        )
        batter_df = batter_df.join(batter_stands)

    batter_features: dict[int, dict[str, Any]] = {
        int(bid): row.to_dict() for bid, row in batter_df.iterrows()
    }

    logger.info(
        "Player features loaded: %d pitchers, %d batters",
        len(pitcher_features),
        len(batter_features),
    )

    _cache["pitcher_features"] = pitcher_features
    _cache["batter_features"] = batter_features
    return pitcher_features, batter_features

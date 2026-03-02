#!/usr/bin/env python3
"""
build_training_dataset.py — Baseline MLB
Transform the Statcast PA-level parquet into the exact feature matrix
(X) and label vector (y) required for training the matchup probability
model (XGBoost / LightGBM).

The model predicts P(outcome | pitcher_features, batter_features, context)
where outcome ∈ {K, BB, HBP, 1B, 2B, 3B, HR, out}.

Usage:
    # Default: read from data/statcast_pa_features_2020_2025.parquet
    python pipeline/build_training_dataset.py

    # Custom input file
    python pipeline/build_training_dataset.py --input data/statcast_pa_features_2024_2024.parquet

    # Specify train/test split
    python pipeline/build_training_dataset.py --test-year 2025

    # Output binary outcome (K vs not-K) for strikeout model
    python pipeline/build_training_dataset.py --binary-target K

Output:
    data/training/X_train.parquet
    data/training/y_train.parquet
    data/training/X_test.parquet
    data/training/y_test.parquet
    data/training/feature_metadata.json
"""

import sys
import json
import argparse
import logging
from pathlib import Path

import pandas as pd
import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("build_training_dataset")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TRAIN_DIR = DATA_DIR / "training"

# ── Outcome encoding ─────────────────────────────────────────────────────────
OUTCOME_LABELS = ["K", "BB", "HBP", "1B", "2B", "3B", "HR", "out"]
OUTCOME_TO_IDX = {label: idx for idx, label in enumerate(OUTCOME_LABELS)}

# ── Feature columns ──────────────────────────────────────────────────────────

# Pitcher features (all numeric)
PITCHER_FEATURES = [
    "p_avg_velo",
    "p_swstr_pct",
    "p_csw_pct",
    "p_zone_pct",
    "p_k_pct",
    "p_bb_pct",
    "p_gb_rate",
    "p_fb_rate",
    "p_ld_rate",
    "p_pct_fastball",
    "p_pct_slider",
    "p_pct_curve",
    "p_pct_change",
    "p_pct_cutter",
    "p_whiff_fastball",
    "p_whiff_slider",
    "p_whiff_curve",
    "p_whiff_change",
    "p_whiff_cutter",
]

# Batter features (all numeric)
BATTER_FEATURES = [
    "b_k_pct",
    "b_bb_pct",
    "b_xba",
    "b_xslg",
    "b_barrel_pct",
    "b_chase_rate",
    "b_whiff_pct",
    "b_avg_ev",
    "b_hard_hit_pct",
]

# Matchup features (engineered)
MATCHUP_FEATURES = [
    "platoon_same",       # 1 if same hand, 0 if opposite
    "platoon_opposite",   # 1 if opposite hand, 0 if same
    "p_throws_L",         # 1 if pitcher is LHP
    "b_stands_L",         # 1 if batter is LHB
]

# Context features
CONTEXT_FEATURES = [
    "inning",
    "score_diff",
    "base_state",
    "outs",
]

ALL_FEATURES = PITCHER_FEATURES + BATTER_FEATURES + MATCHUP_FEATURES + CONTEXT_FEATURES


# ── Feature engineering ───────────────────────────────────────────────────────

def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add matchup and context features, encode categoricals, handle nulls.
    """
    log.info("Engineering training features ...")
    out = df.copy()

    # ── Matchup features ─────────────────────────────────────────────────
    out["platoon_same"] = (out["platoon"] == "same").astype(int)
    out["platoon_opposite"] = (out["platoon"] == "opposite").astype(int)
    out["p_throws_L"] = (out["p_throws"] == "L").astype(int)
    out["b_stands_L"] = (out["b_stands"] == "L").astype(int)

    # ── Context features: ensure numeric ─────────────────────────────────
    out["inning"] = pd.to_numeric(out["inning"], errors="coerce").fillna(1).astype(int)
    out["score_diff"] = pd.to_numeric(out["score_diff"], errors="coerce").fillna(0).astype(int)
    out["base_state"] = pd.to_numeric(out["base_state"], errors="coerce").fillna(0).astype(int)
    out["outs"] = pd.to_numeric(out["outs"], errors="coerce").fillna(0).astype(int)

    # ── Park encoding (one-hot top-15 parks, rest = "other") ─────────────
    # Note: park_id is stored as home_team abbreviation; we'll use top-N
    if "park_id" in out.columns:
        top_parks = out["park_id"].value_counts().head(15).index.tolist()
        for park in top_parks:
            col_name = f"park_{park}".replace(" ", "_").lower()
            out[col_name] = (out["park_id"] == park).astype(int)
            if col_name not in ALL_FEATURES:
                ALL_FEATURES.append(col_name)

    # ── Handle missing numeric features ──────────────────────────────────
    # For tree models (XGBoost/LightGBM), NaN is handled natively,
    # but we'll fill with sensible defaults for compatibility.
    fill_defaults = {
        "p_avg_velo": 93.0,     # MLB avg fastball velocity
        "p_swstr_pct": 0.11,
        "p_csw_pct": 0.29,
        "p_zone_pct": 0.45,
        "p_k_pct": 0.224,
        "p_bb_pct": 0.082,
        "p_gb_rate": 0.43,
        "p_fb_rate": 0.35,
        "p_ld_rate": 0.22,
        "b_k_pct": 0.224,
        "b_bb_pct": 0.082,
        "b_xba": 0.250,
        "b_xslg": 0.400,
        "b_barrel_pct": 0.068,
        "b_chase_rate": 0.30,
        "b_whiff_pct": 0.25,
        "b_avg_ev": 88.0,
        "b_hard_hit_pct": 0.35,
    }
    for col, default in fill_defaults.items():
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce").fillna(default)

    # Fill pitch mix and whiff-by-type with 0 if missing
    for col in out.columns:
        if col.startswith("p_pct_") or col.startswith("p_whiff_"):
            out[col] = pd.to_numeric(out[col], errors="coerce").fillna(0.0)

    return out


def encode_outcomes(df: pd.DataFrame, binary_target: str = None) -> pd.Series:
    """
    Encode PA outcomes as integers.

    If binary_target is set (e.g., "K"), encodes as 1 = target, 0 = not target.
    Otherwise, encodes as multiclass (0-7).
    """
    if binary_target:
        y = (df["pa_outcome"] == binary_target).astype(int)
        log.info(f"Binary target '{binary_target}': {y.sum():,} positives out of {len(y):,} ({y.mean()*100:.1f}%)")
    else:
        y = df["pa_outcome"].map(OUTCOME_TO_IDX)
        unmapped = y.isna().sum()
        if unmapped > 0:
            log.warning(f"{unmapped} PAs with unmapped outcomes — dropping")
            y = y.dropna()
        y = y.astype(int)
    return y


def compute_sample_weights(y: pd.Series) -> np.ndarray:
    """
    Compute inverse-frequency sample weights to handle class imbalance.
    Outs dominate (~65%+), so we upweight rare outcomes (HR, 3B, HBP).
    """
    counts = y.value_counts()
    total = len(y)
    weight_map = {label: total / (len(counts) * count) for label, count in counts.items()}
    weights = y.map(weight_map).values
    return weights


# ── Main pipeline ─────────────────────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Build ML training dataset from Statcast PA features."
    )
    parser.add_argument(
        "--input", type=str,
        default=str(DATA_DIR / "statcast_pa_features_2020_2025.parquet"),
        help="Input parquet file path."
    )
    parser.add_argument(
        "--test-year", type=int, default=2025,
        help="Hold out this year for test set (default: 2025)."
    )
    parser.add_argument(
        "--binary-target", type=str, default=None,
        choices=OUTCOME_LABELS,
        help="If set, create binary classification (target vs rest)."
    )
    parser.add_argument(
        "--min-pa", type=int, default=50,
        help="Minimum PAs for a pitcher/batter to be included (default: 50)."
    )
    parser.add_argument(
        "--include-weights", action="store_true",
        help="Include sample weights to handle class imbalance."
    )
    return parser.parse_args()


def main():
    args = parse_args()
    TRAIN_DIR.mkdir(parents=True, exist_ok=True)

    # ── Load data ────────────────────────────────────────────────────────
    input_path = Path(args.input)
    if not input_path.exists():
        log.error(f"Input file not found: {input_path}")
        log.info("Run pipeline/fetch_statcast_historical.py first to generate PA features.")
        sys.exit(1)

    log.info(f"Loading PA features from {input_path} ...")
    df = pd.read_parquet(input_path)
    log.info(f"Loaded {len(df):,} PAs")

    # ── Filter low-sample players ────────────────────────────────────────
    if args.min_pa > 0:
        pitcher_counts = df["pitcher_id"].value_counts()
        batter_counts = df["batter_id"].value_counts()
        valid_pitchers = pitcher_counts[pitcher_counts >= args.min_pa].index
        valid_batters = batter_counts[batter_counts >= args.min_pa].index
        before = len(df)
        df = df[df["pitcher_id"].isin(valid_pitchers) & df["batter_id"].isin(valid_batters)]
        log.info(f"Filtered to {len(df):,} PAs (dropped {before - len(df):,} with <{args.min_pa} PA)")

    # ── Engineer features ────────────────────────────────────────────────
    df = engineer_features(df)

    # ── Select feature columns that actually exist ───────────────────────
    available_features = [f for f in ALL_FEATURES if f in df.columns]
    missing = set(ALL_FEATURES) - set(available_features)
    if missing:
        log.warning(f"Missing features (will be excluded): {missing}")

    log.info(f"Using {len(available_features)} features")

    # ── Train / test split by year ───────────────────────────────────────
    test_mask = df["game_year"] == args.test_year
    train_df = df[~test_mask].copy()
    test_df = df[test_mask].copy()

    log.info(f"Train set: {len(train_df):,} PAs ({train_df['game_year'].nunique()} seasons)")
    log.info(f"Test set:  {len(test_df):,} PAs (year {args.test_year})")

    if train_df.empty:
        log.error("Train set is empty. Check date range and test-year.")
        sys.exit(1)

    # ── Build X and y ────────────────────────────────────────────────────
    X_train = train_df[available_features].copy()
    y_train = encode_outcomes(train_df, args.binary_target)

    # Align X/y after potential NaN drops in y
    X_train = X_train.loc[y_train.index]

    if not test_df.empty:
        X_test = test_df[available_features].copy()
        y_test = encode_outcomes(test_df, args.binary_target)
        X_test = X_test.loc[y_test.index]
    else:
        X_test = pd.DataFrame(columns=available_features)
        y_test = pd.Series(dtype=int)

    # ── Compute sample weights if requested ──────────────────────────────
    if args.include_weights:
        weights_train = compute_sample_weights(y_train)
        weights_df = pd.DataFrame({"weight": weights_train}, index=y_train.index)
        weights_df.to_parquet(TRAIN_DIR / "weights_train.parquet", index=False)
        log.info("Saved sample weights.")

    # ── Save ─────────────────────────────────────────────────────────────
    X_train.to_parquet(TRAIN_DIR / "X_train.parquet", index=False)
    y_train.to_frame("label").to_parquet(TRAIN_DIR / "y_train.parquet", index=False)
    log.info(f"Saved X_train: {X_train.shape}")

    if not X_test.empty:
        X_test.to_parquet(TRAIN_DIR / "X_test.parquet", index=False)
        y_test.to_frame("label").to_parquet(TRAIN_DIR / "y_test.parquet", index=False)
        log.info(f"Saved X_test: {X_test.shape}")

    # ── Feature metadata (for model interpretability) ────────────────────
    metadata = {
        "features": available_features,
        "n_features": len(available_features),
        "outcome_labels": OUTCOME_LABELS if not args.binary_target else [f"not_{args.binary_target}", args.binary_target],
        "outcome_to_idx": OUTCOME_TO_IDX if not args.binary_target else {f"not_{args.binary_target}": 0, args.binary_target: 1},
        "binary_target": args.binary_target,
        "test_year": args.test_year,
        "min_pa_filter": args.min_pa,
        "train_samples": len(X_train),
        "test_samples": len(X_test),
        "feature_groups": {
            "pitcher": [f for f in available_features if f.startswith("p_")],
            "batter": [f for f in available_features if f.startswith("b_")],
            "matchup": [f for f in available_features if f.startswith("platoon")],
            "context": [f for f in available_features if f in CONTEXT_FEATURES],
            "park": [f for f in available_features if f.startswith("park_")],
        },
    }

    meta_path = TRAIN_DIR / "feature_metadata.json"
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)
    log.info(f"Saved feature metadata: {meta_path}")

    # ── Print summary ────────────────────────────────────────────────────
    log.info("=== Training Dataset Summary ===")
    log.info(f"  Features:       {len(available_features)}")
    log.info(f"  Train samples:  {len(X_train):,}")
    log.info(f"  Test samples:   {len(X_test):,}")
    if not args.binary_target:
        log.info("  Outcome distribution (train):")
        for label, count in y_train.value_counts().sort_index().items():
            name = OUTCOME_LABELS[label]
            log.info(f"    {name:>5s} ({label}): {count:>8,} ({count/len(y_train)*100:.1f}%)")
    else:
        pos = y_train.sum()
        neg = len(y_train) - pos
        log.info(f"  Positive ({args.binary_target}): {pos:,} ({pos/len(y_train)*100:.1f}%)")
        log.info(f"  Negative:     {neg:,} ({neg/len(y_train)*100:.1f}%)")

    log.info("=== Done ===")


if __name__ == "__main__":
    main()

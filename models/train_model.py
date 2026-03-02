#!/usr/bin/env python3
"""
train_model.py — BaselineMLB Model Training CLI

Trains the multi-class LightGBM matchup model and saves it as a
joblib artifact.  Implements proper temporal train/val/test splits
to prevent future-data leakage.

Split strategy:
    Train:      2020-01-01  →  2024-12-31   (~5 seasons of Statcast PAs)
    Validate:   2025-01-01  →  2025-06-30   (first half 2025 — calibration)
    Test:       2025-07-01  →  2025-12-31   (second half 2025 — held out)

Usage:
    # Full training pipeline
    python -m models.train_model

    # Custom data path
    python -m models.train_model --data data/statcast_pa_features_2020_2025.parquet

    # Skip calibration
    python -m models.train_model --no-calibrate

    # Custom output path
    python -m models.train_model --output artifacts/matchup_v1.joblib

    # Quick test with fewer estimators
    python -m models.train_model --quick
"""

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# ── Ensure project root is on PYTHONPATH ──
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from models.matchup_model import MatchupModel
from models.feature_config import (
    PA_OUTCOMES,
    FEATURE_NAMES,
    TARGET_COL,
    DATE_COL,
    RAW_EVENT_COL,
    LEAGUE_AVG_PROBS,
    OUTCOME_SHORT,
    map_event,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("train_model")


# ═══════════════════════════════════════════════════════════════════════════
# Date-Based Splitting
# ═══════════════════════════════════════════════════════════════════════════

TRAIN_END = "2024-12-31"
VAL_START = "2025-01-01"
VAL_END = "2025-06-30"
TEST_START = "2025-07-01"


def temporal_split(
    df: pd.DataFrame,
) -> tuple:
    """
    Split data by date — no future leakage.

    Returns:
        (train_df, val_df, test_df)
    """
    if DATE_COL not in df.columns:
        raise ValueError(
            f"DataFrame missing '{DATE_COL}' column. "
            f"Available columns: {list(df.columns)[:20]}"
        )

    df[DATE_COL] = pd.to_datetime(df[DATE_COL])

    train = df[df[DATE_COL] <= TRAIN_END].copy()
    val = df[(df[DATE_COL] >= VAL_START) & (df[DATE_COL] <= VAL_END)].copy()
    test = df[df[DATE_COL] >= TEST_START].copy()

    log.info(f"Temporal split:")
    log.info(f"  Train: {len(train):>10,} rows  (≤ {TRAIN_END})")
    log.info(f"  Val:   {len(val):>10,} rows  ({VAL_START} – {VAL_END})")
    log.info(f"  Test:  {len(test):>10,} rows  (≥ {TEST_START})")

    if len(train) == 0:
        raise ValueError("Training set is empty — check date column format.")
    if len(val) == 0:
        log.warning("Validation set is empty — using last 15% of train as val.")
        split_idx = int(len(train) * 0.85)
        val = train.iloc[split_idx:].copy()
        train = train.iloc[:split_idx].copy()
    if len(test) == 0:
        log.warning("Test set is empty — will skip final evaluation.")

    return train, val, test


# ═══════════════════════════════════════════════════════════════════════════
# Data Loading
# ═══════════════════════════════════════════════════════════════════════════

def load_training_data(path: str) -> pd.DataFrame:
    """
    Load the training parquet and perform basic validation.
    """
    path = Path(path)
    if not path.exists():
        log.error(f"Training data not found at: {path}")
        log.error(
            "The training dataset is built by a separate pipeline task.\n"
            "Expected file: data/statcast_pa_features_2020_2025.parquet\n"
            "Run the Statcast feature pipeline first."
        )
        sys.exit(1)

    log.info(f"Loading training data from {path}...")
    start = time.time()
    df = pd.read_parquet(path)
    elapsed = time.time() - start
    log.info(f"Loaded {len(df):,} rows × {len(df.columns)} columns in {elapsed:.1f}s")

    # ── Validate required columns ──
    missing_features = [f for f in FEATURE_NAMES if f not in df.columns]
    if missing_features:
        log.warning(
            f"Missing {len(missing_features)} feature columns "
            f"(will use defaults): {missing_features[:10]}"
        )

    has_target = TARGET_COL in df.columns or RAW_EVENT_COL in df.columns
    if not has_target:
        log.error(
            f"DataFrame needs either '{TARGET_COL}' or '{RAW_EVENT_COL}' column.\n"
            f"Columns found: {sorted(df.columns.tolist())}"
        )
        sys.exit(1)

    # ── Map raw events → outcome labels if needed ──
    if RAW_EVENT_COL in df.columns and TARGET_COL not in df.columns:
        log.info("Mapping Statcast events to PA outcome labels...")
        bb_col = "bb_type" if "bb_type" in df.columns else None
        df[TARGET_COL] = df.apply(
            lambda row: map_event(
                row[RAW_EVENT_COL],
                row[bb_col] if bb_col else None,
            ),
            axis=1,
        )
        before = len(df)
        df = df.dropna(subset=[TARGET_COL]).copy()
        log.info(f"Mapped events: {before:,} → {len(df):,} valid PAs")

    # ── Outcome distribution ──
    dist = df[TARGET_COL].value_counts(normalize=True)
    log.info("Outcome distribution:")
    for outcome in PA_OUTCOMES:
        pct = dist.get(outcome, 0) * 100
        log.info(f"  {outcome:15s}: {pct:5.1f}%")

    return df


# ═══════════════════════════════════════════════════════════════════════════
# Calibration Curve Computation
# ═══════════════════════════════════════════════════════════════════════════

def compute_calibration_curves(
    model: MatchupModel,
    df: pd.DataFrame,
    n_bins: int = 10,
) -> dict:
    """
    Compute calibration curves for each outcome class.

    For each class, bin the predicted probabilities and compare
    to actual frequency. A well-calibrated model has
    mean_predicted ≈ actual_frequency in each bin.

    Returns:
        Dict mapping outcome → list of {bin_center, predicted, actual, count}
    """
    X, y = model.prepare_data(df)
    probs = model.predict_proba(X)

    curves = {}
    for class_idx, outcome in enumerate(PA_OUTCOMES):
        class_probs = probs[:, class_idx]
        class_true = (y == class_idx).astype(int)

        bins = np.linspace(0, 1, n_bins + 1)
        bin_centers = (bins[:-1] + bins[1:]) / 2

        calibration_data = []
        for j in range(n_bins):
            mask = (class_probs >= bins[j]) & (class_probs < bins[j + 1])
            count = mask.sum()
            if count >= 10:  # Need minimum samples for reliable calibration
                mean_pred = class_probs[mask].mean()
                actual_freq = class_true[mask].mean()
                calibration_data.append({
                    "bin_center": round(float(bin_centers[j]), 3),
                    "predicted": round(float(mean_pred), 4),
                    "actual": round(float(actual_freq), 4),
                    "count": int(count),
                })

        curves[outcome] = calibration_data

    return curves


# ═══════════════════════════════════════════════════════════════════════════
# Main Training Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def train(args: argparse.Namespace) -> None:
    """Full training pipeline: load → split → train → calibrate → evaluate → save."""

    start_time = time.time()

    # ── Load data ──
    df = load_training_data(args.data)

    # ── Temporal split ──
    train_df, val_df, test_df = temporal_split(df)

    # ── Initialize model ──
    params = {}
    if args.quick:
        params["n_estimators"] = 200
        params["num_leaves"] = 31
        log.info("Quick mode: reduced estimators and leaves")

    model = MatchupModel(params=params)

    # ── Train ──
    train_metrics = model.fit(
        train_df,
        val_df,
        early_stopping_rounds=args.early_stopping,
    )

    # ── Calibrate ──
    if not args.no_calibrate:
        model.calibrate(val_df, method="isotonic")

    # ── Evaluate vs baselines ──
    if len(test_df) > 0:
        log.info("\n" + "=" * 60)
        log.info("HELD-OUT TEST SET EVALUATION")
        log.info("=" * 60)
        baseline_results = model.evaluate_vs_baselines(test_df)
        train_metrics["baseline_comparison"] = baseline_results

        # Calibration curves on test set
        log.info("\nComputing calibration curves on test set...")
        calibration = compute_calibration_curves(model, test_df)
        train_metrics["calibration_curves"] = calibration
    else:
        log.warning("Skipping test evaluation (no test data)")

    # ── Save model artifact ──
    output_path = Path(args.output)
    model.save(str(output_path))

    # ── Save training report ──
    report_path = output_path.with_suffix(".json")
    with open(report_path, "w") as f:
        # Convert numpy types for JSON serialization
        json.dump(
            _make_serializable(train_metrics),
            f,
            indent=2,
            default=str,
        )
    log.info(f"Training report saved to {report_path}")

    # ── Summary ──
    elapsed = time.time() - start_time
    log.info("\n" + "=" * 60)
    log.info("TRAINING COMPLETE")
    log.info("=" * 60)
    log.info(f"  Time:           {elapsed / 60:.1f} minutes")
    log.info(f"  Train samples:  {train_metrics['n_train']:,}")
    log.info(f"  Val samples:    {train_metrics['n_val']:,}")
    log.info(f"  Best iteration: {train_metrics['best_iteration']}")
    log.info(f"  Val log-loss:   {train_metrics['val_log_loss']:.5f}")
    log.info(f"  Val accuracy:   {train_metrics['val_accuracy']:.4f}")
    if "baseline_comparison" in train_metrics:
        bc = train_metrics["baseline_comparison"]
        log.info(f"  Test log-loss:  {bc['model']['log_loss']:.5f}")
        log.info(f"  vs League avg:  {bc['improvement']['vs_league_avg_pct']:+.2f}%")
        log.info(f"  vs Career avg:  {bc['improvement']['vs_career_avg_pct']:+.2f}%")
    log.info(f"  Model saved:    {output_path}")
    log.info(f"  Report saved:   {report_path}")


def _make_serializable(obj):
    """Recursively convert numpy types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _make_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_make_serializable(v) for v in obj]
    elif isinstance(obj, np.integer):
        return int(obj)
    elif isinstance(obj, np.floating):
        return round(float(obj), 6)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, pd.DataFrame):
        return obj.to_dict(orient="records")
    return obj


# ═══════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the BaselineMLB matchup probability model",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m models.train_model
  python -m models.train_model --data data/statcast_pa_features_2020_2025.parquet
  python -m models.train_model --quick --no-calibrate
  python -m models.train_model --output artifacts/matchup_v2.joblib
        """,
    )

    parser.add_argument(
        "--data",
        default="data/statcast_pa_features_2020_2025.parquet",
        help="Path to training parquet file (default: data/statcast_pa_features_2020_2025.parquet)",
    )
    parser.add_argument(
        "--output",
        default="models/artifacts/matchup_model.joblib",
        help="Path to save the trained model artifact (default: models/artifacts/matchup_model.joblib)",
    )
    parser.add_argument(
        "--no-calibrate",
        action="store_true",
        help="Skip probability calibration step",
    )
    parser.add_argument(
        "--early-stopping",
        type=int,
        default=100,
        help="Early stopping patience (default: 100)",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Quick training with fewer estimators (for testing)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable debug-level logging",
    )

    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    train(args)

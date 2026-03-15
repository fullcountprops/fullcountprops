#!/usr/bin/env python3
"""
build_multiyear_dataset.py
==========================
Stage 1: Download 2020-2023 Statcast data (2024 already exists)
Stage 2: Transform each year to PA features
Stage 3: Concatenate all years → data/statcast_pa_features_2020_2024.parquet
Stage 4: Build train/test split (2024 held out as test)
Stage 5: Train LightGBM model with cross-validation
Stage 6: Report accuracy vs single-year baseline
"""

import os
import sys
import time
import subprocess
import logging
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("multiyear")

REPO = Path(__file__).resolve().parent.parent
DATA_DIR = REPO / "data"
STATCAST_DIR = DATA_DIR / "statcast"
TRAINING_DIR = DATA_DIR / "training"
ARTIFACTS_DIR = REPO / "models" / "artifacts"

YEARS = {
    2023: ("2023-03-30", "2023-10-01"),
    2022: ("2022-04-07", "2022-10-05"),
    2021: ("2021-04-01", "2021-10-03"),
    2020: ("2020-07-23", "2020-09-27"),
}

# Single-year baseline (from earlier today)
BASELINE_ACCURACY = 0.178
BASELINE_LOGLOSS = 1.97


def run(cmd: list, label: str) -> int:
    """Run a subprocess, stream output, return exit code."""
    log.info(">>> %s", label)
    t0 = time.time()
    proc = subprocess.run(cmd, cwd=str(REPO))
    elapsed = time.time() - t0
    if proc.returncode == 0:
        log.info("    ✓ %s completed in %.0fs", label, elapsed)
    else:
        log.error("    ✗ %s failed (exit %d) after %.0fs", label, proc.returncode, elapsed)
    return proc.returncode


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1: Download raw Statcast
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 1: Download Statcast data (2020–2023)")
log.info("=" * 60)

STATCAST_DIR.mkdir(parents=True, exist_ok=True)

for year, (start, end) in YEARS.items():
    out_path = STATCAST_DIR / f"statcast_{year}.parquet"
    if out_path.exists():
        size_mb = out_path.stat().st_size / 1e6
        log.info("  SKIP %d — already exists (%.1f MB)", year, size_mb)
        continue

    log.info("  Downloading %d (%s → %s) ...", year, start, end)
    download_script = f"""
import pybaseball as pb
import pandas as pd
from pathlib import Path

pb.cache.enable()
print("Fetching {year} Statcast data...")
df = pb.statcast(start_dt='{start}', end_dt='{end}')
print(f"Downloaded {{len(df):,}} rows")
out = Path('{out_path}')
out.parent.mkdir(parents=True, exist_ok=True)
df.to_parquet(out, index=False)
print(f"Saved to {{out}} ({{out.stat().st_size / 1e6:.1f}} MB)")
"""
    attempt = 0
    max_attempts = 3
    while attempt < max_attempts:
        attempt += 1
        log.info("  Attempt %d/%d for %d ...", attempt, max_attempts, year)
        result = subprocess.run(
            [sys.executable, "-c", download_script],
            cwd=str(REPO),
        )
        if result.returncode == 0 and out_path.exists():
            size_mb = out_path.stat().st_size / 1e6
            log.info("  ✓ %d downloaded (%.1f MB)", year, size_mb)
            break
        else:
            log.warning("  Attempt %d failed for %d. Waiting 30s before retry...", attempt, year)
            if out_path.exists():
                out_path.unlink()  # remove partial file
            time.sleep(30)
    else:
        log.error("  ✗ All %d attempts failed for %d. Exiting.", max_attempts, year)
        sys.exit(1)

log.info("Stage 1 complete.\n")

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2: Transform each year to PA features
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 2: Transform raw Statcast → PA features")
log.info("=" * 60)

# Include 2024 — already exists but re-check
all_years = list(YEARS.keys()) + [2024]

for year in sorted(all_years):
    raw_path = STATCAST_DIR / f"statcast_{year}.parquet"
    pa_path = DATA_DIR / f"statcast_pa_features_{year}_{year}.parquet"

    if pa_path.exists():
        size_mb = pa_path.stat().st_size / 1e6
        log.info("  SKIP %d PA features — already exists (%.1f MB)", year, size_mb)
        continue

    if not raw_path.exists():
        log.error("  Missing raw file for %d: %s", year, raw_path)
        sys.exit(1)

    rc = run(
        [sys.executable, "pipeline/transform_statcast_to_pa_features.py",
         "--input", str(raw_path),
         "--output", str(pa_path)],
        f"Transform {year}"
    )
    if rc != 0:
        log.error("Transform failed for %d", year)
        sys.exit(1)

log.info("Stage 2 complete.\n")

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 3: Concatenate all years
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 3: Concatenate all years → statcast_pa_features_2020_2024.parquet")
log.info("=" * 60)

combined_path = DATA_DIR / "statcast_pa_features_2020_2024.parquet"

dfs = []
for year in sorted(all_years):
    pa_path = DATA_DIR / f"statcast_pa_features_{year}_{year}.parquet"
    if not pa_path.exists():
        log.error("Missing PA features for %d: %s", year, pa_path)
        sys.exit(1)
    df = pd.read_parquet(pa_path)
    log.info("  %d: %d rows, %d cols", year, len(df), df.shape[1])
    dfs.append(df)

combined = pd.concat(dfs, ignore_index=True)
log.info("Combined: %d total rows", len(combined))

combined.to_parquet(combined_path, index=False)
log.info("Saved → %s (%.1f MB)", combined_path, combined_path.stat().st_size / 1e6)
log.info("Stage 3 complete.\n")

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 4: Build training dataset
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 4: Build train/test split")
log.info("=" * 60)

TRAINING_DIR.mkdir(parents=True, exist_ok=True)

rc = run(
    [sys.executable, "pipeline/build_training_dataset.py",
     "--input", str(combined_path),
     "--output-dir", str(TRAINING_DIR)],
    "Build training dataset"
)
if rc != 0:
    log.error("build_training_dataset.py failed")
    sys.exit(1)

# Report split sizes
for fname in ["X_train.parquet", "X_test.parquet", "y_train.parquet", "y_test.parquet"]:
    p = TRAINING_DIR / fname
    if p.exists():
        df = pd.read_parquet(p)
        log.info("  %s: %d rows", fname, len(df))

log.info("Stage 4 complete.\n")

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 5: Train model
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 5: Train LightGBM model (5-fold CV)")
log.info("=" * 60)

ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

rc = run(
    [sys.executable, "-m", "models.train_model",
     "--data-dir", str(TRAINING_DIR),
     "--artifact-dir", str(ARTIFACTS_DIR)],
    "Train LightGBM"
)
if rc != 0:
    log.error("train_model failed")
    sys.exit(1)

log.info("Stage 5 complete.\n")

# ─────────────────────────────────────────────────────────────────────────────
# STAGE 6: Report accuracy vs baseline
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("STAGE 6: Results vs single-year baseline")
log.info("=" * 60)

metadata_path = ARTIFACTS_DIR / "training_metadata.json"
if metadata_path.exists():
    import json
    with open(metadata_path) as f:
        meta = json.load(f)

    new_acc = meta.get("test_accuracy") or meta.get("accuracy")
    new_ll  = meta.get("test_log_loss") or meta.get("log_loss")

    log.info("  %-28s %s", "Metric", "Single-year → Multi-year")
    log.info("  %-28s %s", "-" * 28, "-" * 28)
    if new_acc:
        delta_acc = (new_acc - BASELINE_ACCURACY) * 100
        log.info("  %-28s %.4f → %.4f  (%+.2f pp)", "Test accuracy", BASELINE_ACCURACY, new_acc, delta_acc)
    if new_ll:
        delta_ll = new_ll - BASELINE_LOGLOSS
        log.info("  %-28s %.4f → %.4f  (%+.4f)", "Log-loss", BASELINE_LOGLOSS, new_ll, delta_ll)

    log.info("\n  Full metadata:")
    for k, v in sorted(meta.items()):
        log.info("    %s: %s", k, v)
else:
    log.warning("training_metadata.json not found — check model artifacts")

log.info("\n" + "=" * 60)
log.info("PIPELINE COMPLETE")
log.info("=" * 60)

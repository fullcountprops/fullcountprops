# FullCountProps — Data Pipeline Guide

This document explains how to run the full model-training data pipeline:
from raw Statcast download through feature engineering to a trained LightGBM
artifact ready for the Monte Carlo simulator.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Architecture Overview](#architecture-overview)
4. [Stage Walkthrough](#stage-walkthrough)
   - [Stage 1 — fetch_statcast_historical.py](#stage-1--fetch_statcast_historicalpy)
   - [Stage 2 — build_training_dataset.py](#stage-2--build_training_datasetpy)
   - [Stage 3 — train_model.py](#stage-3--train_modelpy)
5. [Data Formats](#data-formats)
   - [Statcast PA Features Parquet](#statcast-pa-features-parquet)
   - [Training Split Parquets](#training-split-parquets)
   - [Model Artifacts](#model-artifacts)
6. [Expected Runtimes](#expected-runtimes)
7. [Resuming an Interrupted Run](#resuming-an-interrupted-run)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Python | 3.11+ | Tested on 3.11 and 3.12 |
| Supabase project | any | `SUPABASE_URL` + `SUPABASE_KEY` env vars required |
| Disk space | ~4 GB | For 2020–2025 raw + processed parquets |
| Network | stable | Baseball Savant rate-limits aggressive clients |

**Install dependencies:**

```bash
pip install -r requirements.txt
# Core packages: pandas, numpy, requests, pyarrow, lightgbm, scikit-learn
```

**Set environment variables:**

```bash
export SUPABASE_URL="https://<project>.supabase.co"
export SUPABASE_KEY="<service_role_key>"
```

---

## Quick Start

### Full pipeline (2020–2025, ~3–6 hours)

```bash
# Stage 1: Download Statcast data for all seasons
python pipeline/fetch_statcast_historical.py --start-year 2020 --end-year 2025

# Stage 2: Build train/test splits
python pipeline/build_training_dataset.py \
    --input data/statcast_pa_features_2020_2025.parquet \
    --output-dir data/training

# Stage 3: Train the LightGBM model
python -m models.train_model --data-dir data/training
```

Or use the Makefile shortcut (after configuring `START_YEAR` / `END_YEAR`):

```bash
make full-pipeline
```

### Quick test (single season, ~35–60 minutes)

```bash
make quick-test-pipeline
# Equivalent to: 2024 only, no-cv flag on train_model
```

---

## Architecture Overview

```
Baseball Savant (public CSV API)
        │
        │  weekly chunked requests, ~3s rate limit
        ▼
pipeline/fetch_statcast_historical.py
        │
        │  pitch-level → PA-level feature engineering
        │  Output: data/statcast_pa_features_<years>.parquet
        ▼
pipeline/build_training_dataset.py
        │
        │  normalise, encode, train/test split (80/20 stratified)
        │  Output: data/training/X_train.parquet
        │          data/training/y_train.parquet
        │          data/training/X_test.parquet
        │          data/training/y_test.parquet
        ▼
models/train_model.py
        │
        │  LightGBM multiclass (8 PA outcomes)
        │  5-fold stratified CV  →  final model on full train set
        │  Output: models/artifacts/matchup_model.lgb
        │          models/artifacts/feature_importance.json
        │          models/artifacts/training_metadata.json
        ▼
simulator/run_daily.py  (consumes model artifacts at runtime)
```

---

## Stage Walkthrough

### Stage 1 — `fetch_statcast_historical.py`

**What it does:**
Downloads raw Statcast pitch-by-pitch data from
`baseballsavant.mlb.com/statcast_search` in 7-day chunks, then aggregates
pitch-level rows into one row per plate appearance with engineered features.

**Key CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--start-year` | 2020 | First season |
| `--end-year` | 2025 | Last season (capped at current year) |
| `--start-date` | — | Override to exact date (YYYY-MM-DD) |
| `--end-date` | — | Override end date |
| `--upload-supabase` | off | Also upsert aggregated player-season stats |
| `--raw-only` | off | Save raw pitches; skip feature engineering |
| `--output` | auto | Override output parquet filename |

**Example — single season:**

```bash
python pipeline/fetch_statcast_historical.py \
    --start-year 2024 --end-year 2024 \
    --upload-supabase
```

**Rate limiting:**
The script sleeps 3 seconds between weekly chunks. A 403 response triggers
a 30-second back-off and one retry. After 3 failures the chunk is skipped
and a warning is logged — partial data is still saved.

**Output:**
`data/statcast_pa_features_<start_year>_<end_year>.parquet`

---

### Stage 2 — `build_training_dataset.py`

**What it does:**
Reads the PA-features parquet, applies column normalisation, encodes
categorical features, drops rows with excessive nulls, and writes
stratified 80/20 train/test parquet splits.

**Key CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--input` | required | Path to PA features parquet |
| `--output-dir` | `data/training` | Destination for split files |
| `--test-size` | 0.2 | Fraction held out for test |
| `--min-pa` | 50 | Min PA per pitcher/batter to keep |
| `--seed` | 42 | Random seed for reproducibility |

**Example:**

```bash
python pipeline/build_training_dataset.py \
    --input data/statcast_pa_features_2020_2025.parquet \
    --output-dir data/training \
    --min-pa 30
```

**Outputs:**

```
data/training/
├── X_train.parquet   # feature matrix, float32
├── y_train.parquet   # labels 0–7, int32
├── X_test.parquet
└── y_test.parquet
```

---

### Stage 3 — `train_model.py`

**What it does:**
Loads the training splits, optionally runs 5-fold stratified CV, then
trains a final LightGBM multiclass model on the full training set using
a 10% internal hold-out for early stopping.

**Key CLI flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir` | `data/training` | Directory with parquet splits |
| `--artifact-dir` | `models/artifacts` | Where to write model files |
| `--no-cv` | off | Skip cross-validation (faster) |
| `--binary-target` | — | Train binary classifier (e.g. `K`) |
| `--n-estimators` | 800 | Override boosting rounds |
| `--learning-rate` | 0.05 | Override learning rate |
| `--max-depth` | 7 | Override tree depth |
| `--num-leaves` | 63 | Override leaf count |

**PA outcome classes (8):**

| Label | Int | Description |
|-------|-----|-------------|
| K | 0 | Strikeout |
| BB | 1 | Walk |
| HBP | 2 | Hit by pitch |
| 1B | 3 | Single |
| 2B | 4 | Double |
| 3B | 5 | Triple |
| HR | 6 | Home run |
| out | 7 | All other outs |

**Example — skip CV for iteration:**

```bash
python -m models.train_model \
    --data-dir data/training \
    --no-cv \
    --n-estimators 400 \
    --learning-rate 0.1
```

---

## Data Formats

### Statcast PA Features Parquet

One row per completed plate appearance. Key columns:

| Column | Type | Description |
|--------|------|-------------|
| `game_pk` | int | MLB game ID |
| `game_date` | date | Game date |
| `game_year` | int | Season |
| `pitcher_id` | int | MLBAM pitcher ID |
| `batter_id` | int | MLBAM batter ID |
| `p_throws` | str | Pitcher handedness (R/L) |
| `b_stands` | str | Batter side (R/L) |
| `platoon` | str | same / opposite |
| `pa_outcome` | str | K / BB / HBP / 1B / 2B / 3B / HR / out |
| `p_avg_velo` | float | Pitcher avg fastball velo |
| `p_swstr_pct` | float | Pitcher swinging-strike % |
| `p_k_pct` | float | Pitcher strikeout % |
| `p_bb_pct` | float | Pitcher walk % |
| `p_pct_fastball` | float | Fastball usage % |
| `p_pct_slider` | float | Slider usage % |
| `b_k_pct` | float | Batter strikeout % |
| `b_bb_pct` | float | Batter walk % |
| `b_xba` | float | Batter expected BA |
| `b_barrel_pct` | float | Batter barrel % |
| `b_avg_ev` | float | Batter avg exit velocity |
| `score_diff` | int | Score diff from batter's perspective |
| `base_state` | int | Bitfield 0–7 (1b/2b/3b occupied) |
| `inning` | int | Inning number |
| `outs` | int | Outs when up (0–2) |

### Training Split Parquets

- **X_train / X_test**: All numeric feature columns from the PA parquet
  (categoricals one-hot encoded, nulls filled with column median).
- **y_train / y_test**: Single column `label` (int 0–7 mapping to outcome
  classes above).

### Model Artifacts

| File | Description |
|------|-------------|
| `matchup_model.lgb` | LightGBM binary model file |
| `feature_importance.json` | Gain-normalised importance per feature, ranked |
| `training_metadata.json` | Hyperparameters, CV metrics, test metrics, timestamps |

---

## Expected Runtimes

| Task | Approximate Time | Notes |
|------|-----------------|-------|
| Full Statcast backfill 2020–2025 | 3–6 hours | ~450 weekly chunks; network-bound |
| Single season download (2024) | 35–60 min | ~52 weekly chunks |
| Feature engineering (2020–2025) | 15–25 min | CPU-bound; 5–7M pitches |
| build_training_dataset.py | 3–8 min | Depends on row count |
| train_model.py (5-fold CV + final) | 20–45 min | Depends on CPU cores |
| train_model.py (--no-cv) | 5–10 min | |

---

## Resuming an Interrupted Run

**Stage 1 (Statcast download):**
The script does not checkpoint individual weekly chunks. If interrupted,
re-run with a narrower `--start-date` / `--end-date` range to fill the
gap, then concatenate output files manually:

```python
import pandas as pd, glob
dfs = [pd.read_parquet(f) for f in glob.glob("data/statcast_pa_features_*.parquet")]
pd.concat(dfs, ignore_index=True).to_parquet("data/statcast_pa_features_2020_2025.parquet", index=False)
```

**Stage 2 and 3:**
Both stages are idempotent — simply re-run with the same arguments.
Existing output files are overwritten.

---

## Troubleshooting

### Baseball Savant returns 403 / empty responses

The public endpoint enforces rate limits. Symptoms:
- Repeated `Rate limited (403). Waiting 30s ...` log lines
- Chunks returning 0 rows

**Fix:** The script automatically backs off 30 seconds on 403. If errors
persist, add `time.sleep()` by increasing `RATE_LIMIT_SECONDS` in
`fetch_statcast_historical.py` (default: 3 seconds).

### `FileNotFoundError: Feature file not found`

`train_model.py` requires both `X_train.parquet` and `y_train.parquet`
in `--data-dir`. Run Stage 2 (`build_training_dataset.py`) first.

### LightGBM `num_class` mismatch

If you retrain after modifying `PA_OUTCOME_MAP` in
`fetch_statcast_historical.py` to add or remove outcome classes, you must
also update `OUTCOME_CLASSES` and `NUM_CLASSES` in `train_model.py`.

### Supabase upload fails with `JWT expired`

Rotate the `SUPABASE_KEY` environment variable with a fresh service-role
token from the Supabase dashboard → Settings → API.

### `build_training_dataset.py` produces very few rows

Check `--min-pa` threshold. Setting it above 50 for smaller date ranges
(e.g. single month) will filter most pitchers. Lower to 10–20 for
narrow date ranges.

# Matchup Probability Model — Technical Specification

## Overview

The matchup probability model is the core prediction engine powering FullCountProps's Monte Carlo game simulator. For every plate appearance in a simulated game, the model predicts the probability distribution over 11 mutually exclusive outcomes:

| Code | Outcome       | 2020-2024 MLB Avg |
|------|---------------|-------------------|
| K    | Strikeout     | 22.4%             |
| BB   | Walk          | 8.2%              |
| HBP  | Hit by Pitch  | 1.2%              |
| 1B   | Single        | 15.2%             |
| 2B   | Double        | 4.4%              |
| 3B   | Triple        | 0.4%              |
| HR   | Home Run      | 3.1%              |
| FO   | Flyout        | 17.0%             |
| GO   | Groundout     | 18.3%             |
| LO   | Lineout       | 6.5%              |
| PU   | Popup         | 3.3%              |

The simulator samples from this distribution using `np.random.choice(outcomes, p=probs)` to resolve each PA, then advances game state accordingly.

## Architecture

```
models/
├── __init__.py           # Package init
├── feature_config.py     # Feature definitions, outcome labels, defaults
├── matchup_model.py      # Core LightGBM model class + SHAP explanations
├── train_model.py        # CLI training pipeline
├── predict.py            # Inference API (called by simulator)
└── artifacts/
    ├── matchup_model.joblib   # Trained model artifact
    └── matchup_model.json     # Training report + metrics
```

## Model Details

### Algorithm: LightGBM (Gradient Boosted Decision Trees)

LightGBM was chosen over XGBoost for:
- **Faster training** on millions of plate appearances (histogram-based splitting)
- **Native NaN handling** — missing features don't require imputation
- **Lower memory footprint** — critical when the training set is 2M+ rows
- **Comparable accuracy** to XGBoost on tabular data

### Hyperparameters

| Parameter          | Value | Rationale                                      |
|--------------------|-------|-------------------------------------------------|
| objective          | multiclass | 11-class classification                    |
| boosting_type      | gbdt  | Standard gradient boosting                      |
| learning_rate      | 0.05  | Moderate — balanced speed vs. accuracy           |
| num_leaves         | 63    | Moderately complex trees                         |
| max_depth          | 8     | Prevent extreme overfitting                      |
| min_child_samples  | 200   | Require meaningful sample sizes per leaf         |
| subsample          | 0.8   | Row subsampling for regularization               |
| colsample_bytree   | 0.8   | Feature subsampling for regularization           |
| reg_alpha          | 0.1   | L1 regularization                                |
| reg_lambda         | 1.0   | L2 regularization                                |
| n_estimators       | 2000  | Max trees (early stopping prevents overfit)      |

### Class Imbalance Handling

Triples (0.4%) and HBP (1.2%) are rare classes. We use computed sample weights:
```
weight_i = total_samples / (num_classes * class_count_i)
```
Capped at [0.5, 5.0] to prevent extreme upweighting of triples.

## Feature Set

### Pitcher Features (16)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| p_k_pct            | Strikeout rate                       | Statcast      |
| p_bb_pct           | Walk rate                            | Statcast      |
| p_swstr_pct        | Swinging-strike rate                 | Statcast      |
| p_csw_pct          | Called + swinging strike rate         | Statcast      |
| p_zone_pct         | Pitch zone percentage                | Statcast      |
| p_whiff_fastball   | Whiff rate on fastballs              | Statcast      |
| p_whiff_breaking   | Whiff rate on breaking balls         | Statcast      |
| p_whiff_offspeed   | Whiff rate on offspeed               | Statcast      |
| p_ff_pct           | 4-seam fastball usage                | Statcast      |
| p_si_pct           | Sinker usage                         | Statcast      |
| p_sl_pct           | Slider usage                         | Statcast      |
| p_cu_pct           | Curveball usage                      | Statcast      |
| p_ch_pct           | Changeup usage                       | Statcast      |
| p_fc_pct           | Cutter usage                         | Statcast      |
| p_ff_velo          | Fastball avg velocity                | Statcast      |
| p_stuff_plus       | Stuff+ rating                        | Statcast      |

### Batter Features (11)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| b_k_pct            | Strikeout rate                       | Statcast      |
| b_bb_pct           | Walk rate                            | Statcast      |
| b_xba              | Expected batting average             | Statcast      |
| b_xslg             | Expected slugging                    | Statcast      |
| b_barrel_pct       | Barrel rate                          | Statcast      |
| b_chase_pct        | Chase rate (O-Swing%)                | Statcast      |
| b_avg_exit_velo    | Avg exit velocity                    | Statcast      |
| b_hard_hit_pct     | Hard-hit rate (95+ mph)              | Statcast      |
| b_gb_pct           | Ground ball rate                     | Statcast      |
| b_fb_pct           | Fly ball rate                        | Statcast      |
| b_pull_pct         | Pull percentage                      | Statcast      |

### Matchup Features (2)

| Feature            | Description                          |
|--------------------|--------------------------------------|
| platoon            | 1=same hand, 0=different             |
| platoon_advantage  | 1=pitcher advantage, -1=batter, 0=neutral |

### Park Features (4)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| park_factor_r      | Runs factor (100=neutral)            | FanGraphs     |
| park_factor_hr     | HR factor (100=neutral)              | FanGraphs     |
| park_factor_k      | K factor                             | Calculated    |
| park_factor_h      | Hits factor                          | Calculated    |

### Umpire Features (2)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| ump_ez_rate        | Expanded zone rate                   | Savant/UmpScorecards |
| ump_k_boost        | K% above/below average               | Savant/UmpScorecards |

### Catcher Features (2)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| c_framing_runs     | Framing runs above average           | Statcast      |
| c_strike_rate      | Called-strike rate                    | Statcast      |

### Context Features (4)

| Feature            | Description                          | Source        |
|--------------------|--------------------------------------|---------------|
| temp_f             | Temperature (°F)                     | Weather API   |
| wind_mph           | Wind speed (mph)                     | Weather API   |
| wind_in            | 1=blowing in, 0=out/cross/dome       | Weather API   |
| game_total         | Vegas game total (O/U)               | Odds API      |

**Total: 41 features**

## Training Data

### Source
`data/statcast_pa_features_2020_2025.parquet` — built by the Statcast feature pipeline (separate task). Contains one row per plate appearance with pre-computed rolling features for both the pitcher and batter at the time of the PA.

### Temporal Split (no future leakage)

| Split      | Date Range            | Purpose                        |
|------------|------------------------|--------------------------------|
| Train      | 2020-01-01 → 2024-12-31 | Model fitting (5 seasons)     |
| Validate   | 2025-01-01 → 2025-06-30 | Early stopping + calibration  |
| Test       | 2025-07-01 → 2025-12-31 | Final held-out evaluation     |

The date-based split is critical: using random splits would allow the model to see 2025 pitcher performance trends when predicting 2025 outcomes, creating artificial accuracy inflation.

### Expected Size
- ~900,000 PAs per season × 5 seasons = ~4.5M training rows
- ~450,000 validation rows (first half 2025)
- ~450,000 test rows (second half 2025)

## Probability Calibration

Raw LightGBM multi-class probabilities can be miscalibrated (e.g., the model might say 30% K chance but the true frequency is 28%). We apply isotonic regression calibration on the validation set:

```python
from sklearn.calibration import CalibratedClassifierCV

calibrated = CalibratedClassifierCV(model, method="isotonic", cv="prefit")
calibrated.fit(X_val, y_val)
```

Calibration curves are computed on the test set to verify reliability.

## Baseline Comparisons

The model is evaluated against two naive baselines to prove it adds value:

### 1. League Average Baseline
Always predicts the MLB average distribution for every PA. Log-loss provides the floor — any useful model must beat this.

### 2. Career Average Baseline
Adjusts league averages using pitcher K% + batter K% + batter xBA. This is a "smart" baseline representing what a knowledgeable fan might estimate.

### Expected Results
- Model should achieve **5-15% lower log-loss** than league average
- Model should achieve **3-8% lower log-loss** than career average
- Larger improvements indicate the model is capturing meaningful matchup-specific signal (pitch mix vs. batter tendencies, platoon effects, park/weather interactions)

## SHAP Explanations

Every prediction can include SHAP (SHapley Additive exPlanations) values showing which features drove the prediction up or down for each outcome class.

Example explanation for a high-K prediction:
```json
{
  "strikeout": [
    {"feature": "p_swstr_pct", "value": 0.14, "shap": +0.042, "direction": "+"},
    {"feature": "b_chase_pct", "value": 0.33, "shap": +0.031, "direction": "+"},
    {"feature": "p_whiff_breaking", "value": 0.38, "shap": +0.025, "direction": "+"},
    {"feature": "b_k_pct", "value": 0.28, "shap": +0.018, "direction": "+"},
    {"feature": "platoon", "value": 1, "shap": +0.012, "direction": "+"}
  ]
}
```

This powers the glass-box transparency promise: users can see exactly WHY the model thinks a given matchup favors strikeouts vs. contact.

## Usage

### Training
```bash
# Full training (requires data/statcast_pa_features_2020_2025.parquet)
python -m models.train_model

# Quick test run
python -m models.train_model --quick

# Custom data path
python -m models.train_model --data my_data.parquet --output my_model.joblib
```

### Prediction (Simulator API)
```python
from models.predict import predict_pa, predict_pa_array

# Dict output
probs = predict_pa(
    pitcher_features={"p_k_pct": 0.28, "p_swstr_pct": 0.13},
    batter_features={"b_k_pct": 0.22, "b_xba": 0.260},
    context={"platoon": 1, "park_factor_hr": 105},
)
# → {"strikeout": 0.267, "walk": 0.072, ..., "popup": 0.028}

# Numpy array for Monte Carlo sampling
probs_array = predict_pa_array(pitcher_features, batter_features, context)
outcome = np.random.choice(PA_OUTCOMES, p=probs_array)
```

### CLI Testing
```bash
# Demo with sample matchups
python -m models.predict --demo

# Custom matchup
python -m models.predict --pitcher-k-pct 0.28 --batter-xba 0.260 --platoon 1
```

## Graceful Degradation

If the model artifact doesn't exist yet (training data still being built), the prediction API falls back to a league-average-adjusted baseline that uses available pitcher/batter features. This ensures the simulator can run even before the model is fully trained.

## File Inventory

| File                    | Lines | Purpose                                    |
|-------------------------|-------|--------------------------------------------|
| `feature_config.py`     | ~300  | Feature defs, outcome labels, event mapping |
| `matchup_model.py`      | ~720  | Core LightGBM model + SHAP + calibration   |
| `train_model.py`        | ~390  | CLI training pipeline with temporal splits  |
| `predict.py`            | ~580  | Inference API + CLI demo + singleton cache  |
| `__init__.py`           | ~15   | Package initialization                      |

## Dependencies

Added to `requirements.txt`:
```
lightgbm>=4.0.0
scikit-learn>=1.3.0
shap>=0.43.0
joblib>=1.3.0
matplotlib>=3.7.0
```

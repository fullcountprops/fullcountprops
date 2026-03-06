# Week 2 Progress — FullCountProps

**Week 2: March 2-8, 2026**
**Sprint Goal:** Ship the Monte Carlo simulation engine and connect it end-to-end through the prop edge pipeline.

---

## What We Built

### Core Simulation Engine (`simulator/`)
- **`simulator/monte_carlo_engine.py`** (970 lines) — Full plate-appearance-level Monte Carlo simulator. Runs 3,000 simulations per game with real batting orders, nine-inning game state (inning, outs, runners, score), pitcher fatigue model, and runner advancement logic for all 8 PA outcome types.
- **`simulator/prop_calculator.py`** (900 lines) — Converts simulation frequency distributions into P(over X.5) for each prop line. Implements no-vig probability extraction, fractional Kelly criterion sizing, bootstrap confidence scoring, and Odds API stat-type normalization.
- **`simulator/run_daily.py`** (995 lines) — Daily orchestrator: fetches games, lineups, weather → loads XGBoost model → runs Monte Carlo simulation per game → calculates prop edges → upserts results to Supabase. Supports `--dry-run`, `--date`, `--n-sims`, `--games` flags.

### XGBoost Matchup Model (`models/`)
- **`models/matchup_model.py`** (488 lines) — XGBoost multiclass classifier predicting 8 PA outcome types (K, BB, 1B, 2B, 3B, HR, HBP, OUT). 24 input features across pitcher, batter, matchup, and context categories. Includes SHAP explainability via `explain()` method, joblib serialization, and JSON metadata sidecar.
- **`models/train_model.py`** (411 lines) — Training script with train/val/test split, early stopping, confusion matrix, per-class precision/recall/F1, SHAP importance extraction, and formatted summary output.
- **`models/predict.py`** (630 lines) — Inference script that builds feature vectors from MLB Stats API data for today's game matchups. In-process caching, league-average fallback when model file not found.

### Data Pipeline Additions (`pipeline/`)
- **`pipeline/fetch_statcast_historical.py`** (396 lines) — Fetches 3 seasons of Statcast pitch-level data via pybaseball, aggregates to plate-appearance level with outcome classification, exports to CSV. Chunked by week to handle rate limits.
- **`pipeline/build_training_dataset.py`** (555 lines) — Transforms raw Statcast PA data into 24-feature training vectors. Computes pitcher/batter/matchup/context features, handles missing values with league-average defaults, stratified train/test split.
- **`pipeline/fetch_lineups.py`** (338 lines) — Fetches confirmed/projected lineups from MLB Stats API. Falls back to depth chart data when confirmed lineup unavailable. Upserts to Supabase `lineups` table.
- **`pipeline/fetch_weather.py`** (352 lines) — Fetches weather data from OpenWeatherMap for all 30 stadiums. Computes K-rate multiplier based on temperature, wind speed/direction, humidity. Auto-detects dome stadiums.

### Database Additions
- **`supabase/migrations/20260302_add_simulator_tables.sql`** — Adds 4 new tables: `sim_results` (simulation distributions), `sim_prop_edges` (edge calculations), `lineups` (confirmed lineups cache), `weather` (weather data cache). All with proper indexes, foreign keys, and RLS policies.

### Automation
- **`.github/workflows/simulator.yml`** — New cron workflow (11:00 AM ET daily) orchestrating lineup fetch → weather fetch → Monte Carlo simulation → prop edge calculation. Off-season skip logic. Manual dispatch with date and n_sims inputs.

### Testing & Validation
- **`scripts/integration_test.py`** (588 lines) — 7-step end-to-end dry run: synthetic data → feature build → XGBoost training → Monte Carlo simulation → prop calculation → format validation → Supabase schema contract check. Runs without internet access or API keys.
- **`scripts/backtest_simulator.py`** (781 lines) — Walk-forward backtester comparing simulator output against historical game data. Tracks MAE by stat type, calibration curve, edge accuracy, flat-bet ROI.

### Documentation
- **`docs/ARCHITECTURE.md`** (635 lines) — Full system architecture with ASCII data flow diagram, component descriptions, dependency map, database schema overview, cron schedule, local dev guide, and environment variable reference.
- **`docs/MONTE_CARLO_METHODOLOGY.md`** (566 lines) — Glass-box methodology document explaining simulation approach, all 24 model features, runner advancement logic, fatigue curves, context adjustments, edge detection, Kelly sizing, calibration results, and honest limitations.
- **`README.md`** — Complete project README with badges, architecture overview, quick start guide, Monte Carlo section, directory structure, and documentation index.

### Infrastructure
- **`requirements-simulator.txt`** — All new Python dependencies (xgboost, shap, scipy, scikit-learn, joblib, tqdm, etc.)

---

## Architecture

Week 2 cemented the full v2.0 architecture:

```
External APIs → Supabase → XGBoost Matchup Model → Monte Carlo Engine → Prop Calculator → Frontend
```

The key architectural decision: **plate-appearance-level simulation** rather than game-level regression. This allows the system to incorporate real batting orders, batter-specific vulnerability, and full game state — producing a richer probability distribution than any rate-based approach.

---

## Key Metrics

| Metric | Value |
|--------|-------|
| New Python files added | 14 |
| New SQL migrations | 1 (4 tables) |
| New GitHub Actions workflows | 1 |
| Documentation pages written | 4 |
| Total new lines of code (Python) | ~7,500 |
| Total new lines (SQL + YAML + docs) | ~1,800 |
| Database tables (total) | 15 |
| Model training features | 24 |
| PA outcome classes modeled | 8 |
| Simulations per game | 3,000 |
| Sim throughput | ~571 sims/sec |

---

## What's Working

- [x] Monte Carlo engine runs end-to-end for any game with a lineup
- [x] XGBoost model trains on Statcast data (8 outcome classes)
- [x] All 24 features defined with consistent schema
- [x] Park factor adjustments for all 30 stadiums
- [x] Weather adjustments via OpenWeatherMap per venue
- [x] Pitcher fatigue model (K-rate decay after 25 batters faced)
- [x] Runner advancement logic for all 8 PA outcome types
- [x] No-vig probability calculation for prop edge detection
- [x] Kelly criterion stake sizing with fractional multiplier
- [x] Bootstrap confidence scoring
- [x] Stat-type normalization (Odds API market keys ↔ engine stat names)
- [x] Integration test passes 7/7 steps offline
- [x] Simulator cron job configured with off-season skip
- [x] Real pitcher IDs flow through engine to prop calculator
- [x] Supabase schema migration with RLS policies

---

## What's Next — Week 3

### Frontend Integration
- Build `SimDistribution` component: histogram of simulation outcomes
- Build `PropCard` component with edge %, Kelly stake, confidence
- Build `EdgeLeaderboard` — ranked list of today's best edges
- Connect `sim_results` and `sim_prop_edges` tables to Next.js frontend
- Methodology transparency page linking to MONTE_CARLO_METHODOLOGY.md

### Model Improvements
- Train initial model on 2022-2024 Statcast data
- Calibration tuning: ensure P(over) matches actual hit rate
- Incorporate stuff_plus as an additional feature

### Pipeline Hardening
- Add retry logic with exponential backoff to all API calls
- Slack alerting for pipeline failures or duration anomalies
- Set up model artifact versioning in Supabase

### Backtesting
- Run full 2024 backtest with Monte Carlo simulator
- Generate calibration report and v1.0 vs v2.0 comparison

---

## Technical Debt

| Item | Priority | Description |
|------|----------|-------------|
| Bullpen simulation | High | Currently only models starting pitcher. Reliever matchups not modeled. |
| Pinch hitting | Medium | Lineup substitutions not simulated; late-game projections may over-count some batters. |
| Ball-strike count state | Medium | Each PA is stateless with respect to count. Adding count as a simulation dimension could improve K/BB precision. |
| Model caching | Medium | XGBoost model loaded fresh each run. Should cache in memory for full daily pipeline. |
| Feature drift monitoring | Medium | No alerting when real-time feature distributions diverge from training. Need PSI checks. |
| Extra innings runner | Low | Automatic runner on 2nd base in extras (Manfred runner) not currently modeled. |
| DH rule edge cases | Low | Interleague DH handling uses generic flag. |
| Test coverage | Low | Unit tests needed for Monte Carlo engine and fatigue model. |

---

*Previous: [WEEK1_PROGRESS.md](./WEEK1_PROGRESS.md) — Next: WEEK3_PROGRESS.md (coming March 9)*

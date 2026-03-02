# BaselineMLB

[![Build Status](https://img.shields.io/github/actions/workflow/status/nrlefty5/baselinemlb/pipelines.yml?branch=main&label=CI)](https://github.com/nrlefty5/baselinemlb/actions)
[![Pipeline](https://img.shields.io/github/actions/workflow/status/nrlefty5/baselinemlb/simulator.yml?branch=main&label=pipeline)](https://github.com/nrlefty5/baselinemlb/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vercel](https://img.shields.io/badge/frontend-Vercel-black?logo=vercel)](https://baselinemlb.vercel.app)

**MLB player prop analytics powered by plate-appearance-level Monte Carlo simulation.**

---

## What Is BaselineMLB?

BaselineMLB is an open-source platform that simulates every MLB game 3,000 times — one plate appearance at a time — to generate probability distributions over player prop outcomes (strikeouts, hits, total bases, RBIs, walks, and more).

The simulation uses an XGBoost matchup model trained on ~6 million historical plate appearances from Statcast data. Outputs are cross-referenced against live sportsbook lines to identify edges, ranked by a fractional Kelly criterion for stake sizing, and surfaced daily on a Next.js frontend.

**No black boxes.** Every step of the methodology is documented in [`docs/MONTE_CARLO_METHODOLOGY.md`](docs/MONTE_CARLO_METHODOLOGY.md).

### Key Capabilities

| Capability | Details |
|-----------|---------|
| **Simulation depth** | 3,000 iterations per game; full nine-inning game state |
| **Model basis** | XGBoost multiclass, 24 features, ~6M training PA |
| **Prop types covered** | Strikeouts, hits, total bases, RBIs, walks, runs scored |
| **Context adjustments** | Park factors, weather, umpire tendencies, catcher framing |
| **Edge detection** | No-vig implied probability vs. simulated probability |
| **Stake sizing** | Fractional Kelly criterion (default: quarter Kelly) |
| **Pipeline frequency** | 4 automated runs per day via GitHub Actions |
| **Database** | Supabase (PostgreSQL) — 11 tables |
| **Frontend** | Next.js on Vercel |

---

## Architecture Overview

The system flows from four external APIs through a data ingestion pipeline, into Supabase, through an XGBoost matchup model and Monte Carlo engine, and out to the frontend via prop edge calculations.

```
External APIs → Supabase → XGBoost Model → Monte Carlo Engine → Prop Calculator → Frontend
```

For the full architecture with ASCII data flow diagram, component descriptions, dependency map, database schema, and local dev guide, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- A Supabase project (free tier works for development)
- API keys: [The Odds API](https://the-odds-api.com/), [OpenWeatherMap](https://openweathermap.org/api)

### 1. Clone and Install

```bash
git clone https://github.com/nrlefty5/baselinemlb.git
cd baselinemlb

# Python environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

### 2. Configure Environment Variables

```bash
cp .env.example .env
# Edit .env with your Supabase URL, service role key, and API keys
```

See [Environment Variables](#environment-variables) below for the full list.

### 3. Run Database Migrations

```bash
supabase db push
# or manually: psql $DATABASE_URL < supabase/migrations/001_initial_schema.sql
```

### 4. Build and Train the Model

```bash
# Build training dataset from Statcast data (~20 min first time)
python models/build_training_dataset.py

# Train XGBoost model (~10 min on a modern laptop)
python models/train_model.py
```

### 5. Run the Pipeline

```bash
python pipeline/fetch_games.py
python pipeline/fetch_players.py
python pipeline/fetch_props.py
python pipeline/fetch_weather.py
python scripts/generate_projections.py --date today
python simulator/monte_carlo_engine.py --date today
python simulator/prop_calculator.py --date today
python simulator/find_edges.py --date today
```

### 6. Start the Frontend

```bash
cd frontend
cp .env.example .env.local   # Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
# Visit http://localhost:3000
```

---

## Monte Carlo Simulator

### How It Works

BaselineMLB's core is a **plate-appearance-level Monte Carlo simulator**. Rather than using a career average rate multiplied by estimated innings (which gives one number, not a distribution), we simulate each PA individually:

1. **For each PA**, the XGBoost matchup model outputs a probability distribution over 8 outcome types: `K, BB, 1B, 2B, 3B, HR, HBP, OUT`
2. **Adjustments** are applied: park factors, weather, umpire tendencies, catcher framing, pitcher fatigue
3. **One outcome is sampled** from the adjusted distribution
4. **Game state advances**: runners move, outs recorded, score updated
5. **Repeat** for every PA in all 9 innings

This runs 3,000 times per game. The resulting distribution lets us compute:
- `P(player records ≥ 7 strikeouts)` — over the sportsbook's 6.5 line
- The expected mean, median, and variance of any stat
- A confidence score via bootstrap resampling

### The Matchup Model

- **Training data:** ~6 million plate appearances (2022–2024 Statcast)
- **Algorithm:** XGBoost multiclass classifier (`multi:softprob`)
- **Features:** 24 features across 4 categories — pitcher rates, batter rates, head-to-head matchup history, and game context (park, weather, umpire)
- **Inference speed:** < 1ms per PA (enables ~1.6M inference calls on a 15-game day)
- **Backtested calibration error (ECE):** 0.031 — predictions within ~3 percentage points of actual frequency

For complete methodology, see [`docs/MONTE_CARLO_METHODOLOGY.md`](docs/MONTE_CARLO_METHODOLOGY.md).

---

## Directory Structure

```
baselinemlb/
├── pipeline/                   # Data ingestion scripts
│   ├── fetch_games.py          #   MLB Stats API: schedule + venues
│   ├── fetch_players.py        #   Lineups + rosters
│   ├── fetch_props.py          #   The Odds API: sportsbook lines
│   ├── fetch_weather.py        #   OpenWeatherMap: game-time conditions
│   ├── fetch_statcast_historical.py  # pybaseball: Statcast backfill
│   └── grade_props.py          #   Post-game prop grading
│
├── models/                     # XGBoost matchup model
│   ├── build_training_dataset.py
│   ├── train_model.py
│   ├── evaluate_model.py
│   └── feature_registry.py     # Single source of truth for 24 features
│
├── simulator/                  # Monte Carlo engine
│   ├── monte_carlo_engine.py   #   Main 3,000-sim loop
│   ├── game_state.py           #   Inning/outs/runners dataclass
│   ├── pitcher_fatigue.py      #   K/BB rate decay curve
│   ├── runner_advancement.py   #   Empirical runner advance probs
│   ├── park_factors.py         #   All 30 stadiums
│   ├── weather_adjustments.py  #   Temp/wind/humidity multipliers
│   ├── umpire_tendencies.py    #   Per-umpire K/BB deltas
│   ├── catcher_framing.py      #   BP CSAA framing adjustments
│   ├── prop_calculator.py      #   P(over X.5) + Kelly sizing
│   └── find_edges.py           #   Edge detection + ranking
│
├── scripts/                    # Utilities and backtesting
│   ├── backtest.py
│   ├── calibration_check.py
│   ├── generate_projections.py
│   ├── compare_models.py
│   └── export_results.py
│
├── frontend/                   # Next.js on Vercel
│   ├── app/                    #   App Router pages
│   ├── components/             #   React components
│   └── lib/                    #   Supabase JS client
│
├── lib/                        # Shared Python helpers
│   ├── supabase_client.py
│   ├── db_helpers.py
│   └── logging_helpers.py
│
├── supabase/                   # Schema + migrations
│   ├── migrations/             #   007 migration files
│   └── seed/                   #   Park factors, umpire data
│
├── .github/workflows/          # CI/CD
│   ├── pipelines.yml                  #   Lint + test on push/PR
│   ├── morning_pipeline.yml    #   8:00 AM ET
│   ├── simulator.yml     #   10:30 AM ET ← main sim run
│   ├── afternoon_pipeline.yml  #   4:30 PM ET
│   └── overnight_pipeline.yml  #   2:00 AM ET
│
├── data/                       # Training data + model artifacts (gitignored)
│   ├── training_set.parquet
│   ├── xgboost_model.json
│   └── backtest_results/
│
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── MONTE_CARLO_METHODOLOGY.md
│   └── DATABASE_SCHEMA.md
│
├── .env.example
├── requirements.txt
├── README.md
└── LICENSE
```

---

## Daily Pipeline Schedule

| Time (ET) | Workflow | What Runs |
|-----------|----------|-----------|
| **8:00 AM** | Morning | Fetch games + players; confirm lineups |
| **10:30 AM** | Midday | Fetch props + weather → Monte Carlo (3,000 sims/game) → edge finder → **picks live on frontend** |
| **4:30 PM** | Afternoon | Line refresh + re-simulation with updated weather |
| **2:00 AM** | Overnight | Statcast backfill (previous day) + prop grading + calibration check |

All workflows send Slack alerts on failure. Pipeline run metadata is logged to the `pipeline_runs` audit table in Supabase.

---

## Environment Variables

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...       # Server-side pipeline only
SUPABASE_ANON_KEY=...               # Frontend (safe to expose)
DATABASE_URL=postgresql://...

# External APIs
ODDS_API_KEY=...
OPENWEATHER_API_KEY=...

# Simulator configuration
MODEL_VERSION=2.0
N_SIMULATIONS=3000
MIN_EDGE_THRESHOLD=0.04             # Minimum edge % to surface a pick
KELLY_FRACTION=0.25                 # Fractional Kelly multiplier

# Notifications
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...

# Frontend (Next.js — prefix with NEXT_PUBLIC_ for client-side use)
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

See `.env.example` for the full template. Never commit `.env` to version control.

---

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Full system architecture: data flow, component descriptions, dependency map, schema, cron schedule, local dev guide |
| [`docs/MONTE_CARLO_METHODOLOGY.md`](docs/MONTE_CARLO_METHODOLOGY.md) | Glass-box simulation methodology: model features, adjustments, edge calculation, calibration, limitations |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | Complete table-by-table schema reference |
| [`WEEK2_PROGRESS.md`](WEEK2_PROGRESS.md) | Week 2 build log: Monte Carlo engine + prop edge pipeline |
| [`WEEK1_PROGRESS.md`](WEEK1_PROGRESS.md) | Week 1 build log: data pipeline + Supabase schema |

---

## Contributing

Contributions are welcome. Please open an issue before submitting a pull request for significant changes.

```bash
# Run linting and tests before opening a PR
pip install -r requirements-dev.txt
ruff check .
pytest tests/
```

**Areas actively seeking contributions:**
- Bullpen transition modeling (high priority — see technical debt in WEEK2_PROGRESS.md)
- Pinch-hitting substitution logic
- Count (ball-strike) state integration into PA simulation
- Frontend component development (PropCard, SimDistribution, EdgeLeaderboard)

---

## License

MIT © BaselineMLB Contributors

See [LICENSE](LICENSE) for full terms.

---

> **Disclaimer:** BaselineMLB is an analytical tool for baseball research and entertainment purposes. Nothing on this platform constitutes financial or gambling advice. Please bet responsibly and in accordance with the laws of your jurisdiction.

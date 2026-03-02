# baselinemlb

> **MLB player prop analytics for mid-stakes bettors** — glass-box AI projections, umpire/framing composites, public accuracy dashboard

[![Data Pipeline](https://github.com/nrlefty5/baselinemlb/actions/workflows/pipelines.yml/badge.svg)](https://github.com/nrlefty5/baselinemlb/actions/workflows/pipelines.yml)

---

## What is this?

**baselinemlb** is an open-source MLB analytics engine that:

- Fetches daily game schedules, player stats, and prop lines automatically via GitHub Actions
- Pulls Statcast pitch data to compute **catcher framing scores** and **umpire accuracy** for each game
- Generates **glass-box prop projections** (no black-box models — every factor is visible and explained)
- Tracks historical prediction accuracy on a **public dashboard** at [baselinemlb.vercel.app](https://baselinemlb.vercel.app)
- Designed for **mid-stakes prop bettors** who want edge, not guesswork

---

## Key Features

| Feature | Details |
|---|---|
| **Automated pipelines** | GitHub Actions cron jobs run 4x daily (8 AM, 10:30 AM, 4:30 PM, 2 AM ET) |
| **Glass-box models** | All projection inputs are logged and publicly viewable |
| **Off-season aware** | Pipelines automatically skip Nov 16 – Feb 14 |
| **Umpire composites** | Per-umpire called-strike accuracy, zone tendencies (L/R batter splits) |
| **Catcher framing** | Shadow-zone framing rate per catcher, updated nightly from Statcast |
| **Prop coverage** | K's, hits, total bases, RBIs, runs scored, home runs, pitcher outs |
| **Public accuracy dashboard** | Track our hit rate vs. the closing line over time |
| **Edge detection** | Kelly criterion bet sizing with confidence tiers |
| **CLV tracking** | Closing Line Value analysis for every pick |

---

## Repository Structure

```
baselinemlb/
├── .github/workflows/
│   └── pipelines.yml              # Daily cron: 4 pipeline windows + linting
├── frontend/                      # Next.js 14 app (Vercel)
│   └── app/
│       ├── layout.tsx             # Root layout with nav + SEO meta tags
│       ├── page.tsx               # Homepage — today's slate
│       ├── props/page.tsx         # Live prop lines from The Odds API
│       ├── projections/page.tsx   # Model projections with confidence scores
│       ├── accuracy/page.tsx      # Live + backtest accuracy dashboard
│       └── players/page.tsx       # Player lookup
├── pipeline/                      # Data ingestion + projection engines
│   ├── fetch_games.py             # MLB Stats API → games table
│   ├── fetch_players.py           # MLB Stats API → players table
│   ├── fetch_props.py             # The Odds API → props table
│   ├── fetch_statcast.py          # Statcast → framing + umpire data
│   ├── fetch_umpire_framing.py    # Umpire framing composites
│   ├── generate_projections.py    # Pitcher K projection engine (30 parks)
│   └── generate_batter_projections.py  # Batter TB projection engine (30 parks)
├── scripts/                       # Analysis + grading scripts
│   ├── fetch_games.py             # Game schedule fetcher
│   ├── fetch_players.py           # Player roster fetcher
│   ├── fetch_props.py             # Prop line fetcher
│   ├── fetch_statcast.py          # Statcast data fetcher
│   ├── grade_accuracy.py          # Nightly accuracy grading
│   ├── track_clv.py               # Closing Line Value tracker
│   └── find_edges.py              # Edge detection + Kelly sizing
├── lib/                           # Shared Python utilities
│   └── supabase.py                # Centralized Supabase client + helpers
├── supabase/                      # Database schema + migrations
│   ├── schema.sql                 # Full schema (all tables)
│   └── migrations/                # Versioned migrations
├── docs/
│   └── MODEL_METHODOLOGY.md       # Detailed model documentation
├── requirements.txt               # Python dependencies
├── .env.example                   # Environment variable template
├── LICENSE                        # MIT License
└── README.md
```

---

## Data Sources

- **[MLB Stats API](https://statsapi.mlb.com/api/v1/)** — free, official, no key required
- **[Statcast / pybaseball](https://github.com/jldbc/pybaseball)** — pitch-level data, catcher framing, umpire calls
- **[The Odds API](https://the-odds-api.com)** — prop lines across major US sportsbooks (API key required)

---

## Setup

### Local Development

```bash
git clone https://github.com/nrlefty5/baselinemlb.git
cd baselinemlb
pip install -r requirements.txt
cp .env.example .env
# Fill in your API keys and Supabase credentials in .env
```

Run individual scripts:

```bash
python pipeline/fetch_games.py          # Fetch today's game schedule
python pipeline/fetch_players.py        # Fetch active rosters
python pipeline/fetch_props.py          # Fetch prop lines (requires ODDS_API_KEY)
python pipeline/generate_projections.py # Generate pitcher K projections
python pipeline/generate_batter_projections.py  # Generate batter TB projections
python scripts/grade_accuracy.py        # Grade yesterday's picks
python scripts/find_edges.py            # Find today's betting edges
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

### GitHub Actions Secrets Required

| Secret | Description |
|---|---|
| `SUPABASE_PROJECT_URL` | Your Supabase project URL (`https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `ODDS_API_KEY` | From [the-odds-api.com](https://the-odds-api.com) |

### Vercel Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (for frontend) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (for frontend) |

---

## Model Methodology

See **[docs/MODEL_METHODOLOGY.md](docs/MODEL_METHODOLOGY.md)** for full documentation of:
- Pitcher strikeout model (v1.0-glass-box)
- Batter total bases model (v1.1-glass-box-tb-rampup)
- Edge detection and Kelly criterion sizing
- Accuracy grading and CLV tracking
- Park factors for all 30 MLB stadiums

---

## Prop Markets Tracked

- `pitcher_strikeouts` — our #1 focus
- `batter_total_bases` — batter model
- `pitcher_outs`
- `pitcher_hits_allowed`
- `pitcher_walks`
- `pitcher_earned_runs`
- `batter_hits`
- `batter_home_runs`
- `batter_rbis`
- `batter_runs_scored`

---

## Umpire + Framing Composites

Every game projection includes:

- **Umpire accuracy %** — correct called-pitch rate over trailing 30 games
- **Umpire zone bias** — called-strike rate above/below league average, L/R batter split
- **Catcher framing rate** — shadow-zone strike conversion over trailing 30 games
- **Net framing impact** — estimated extra K's per 9 innings from umpire + catcher combo

All of this is pulled nightly from Statcast via pybaseball and stored in Supabase.

---

## License

MIT — open source, use freely. See [LICENSE](LICENSE).

---

## Supabase Setup

### Running Migrations

All database schema changes are versioned in `supabase/migrations/`.

```bash
# Install Supabase CLI
brew install supabase/tap/supabase  # macOS

# Link to your project
supabase link --project-ref [YOUR_PROJECT_REF]

# Apply all pending migrations
supabase db push
```

### Required Tables

| Table | Purpose |
|-------|---------|
| `games` | MLB game schedule |
| `players` | Active MLB players (40-man rosters) |
| `props` | Prop lines from The Odds API |
| `projections` | K/TB projections |
| `statcast` | Pitch-level data from MLB |
| `picks` | Graded projection results |
| `accuracy_summary` | Aggregate hit rate stats |
| `clv_tracking` | Closing Line Value analysis |
| `email_subscribers` | Newsletter subscriptions |
| `pitcher_overrides` | Manual pitcher assignments |

# Week 1 Retrospective — Baseline MLB

**Date:** 2025-02-25  
**Sprint:** Days 1–5 (Infrastructure & Launch)

---

## What We Built

- **Database schema** — Supabase PostgreSQL with games, players, pitchers, umpires, ballparks, and projections tables
- **Data pipeline** — Statcast ingestion via pybaseball, umpire assignment scraping, ballpark environment data
- **Projection model** — Glass-box K projection engine (pitcher + batter + umpire + park factors)
- **Frontend** — Next.js dashboard deployed on Vercel with Today's Projections, Accuracy Summary, and individual player cards
- **Accuracy tracking** — `accuracy_summary` table wired to public dashboard for ongoing grading
- **CI/CD** — GitHub Actions pipelines (static site + data ingestion), Vercel auto-deploy on push
- **Domain** — baselinemlb.com added to Vercel (DNS propagation in progress)

---

## What Went Well

- Full stack from raw data to deployed UI in 5 days
- Glass-box model means every projection is explainable (no black box)
- Supabase RLS + anon key pattern keeps data public-read without exposing writes
- Vercel GitHub integration made deploys zero-friction after initial setup
- 100 commits in Week 1 — strong momentum

---

## What Was Hard

- Statcast schema changes required mid-sprint adjustments to pipeline queries
- `game_time` ISO timestamp extraction needed a dedicated fix (gameDate field)
- VERCEL_TOKEN secret management — had to use SUPABASE_PROJECT_URL workaround
- DNS propagation always takes longer than you want

---

## Week 2 Priorities

1. Umpire accuracy composites — expanded zone call rate as K projection factor
2. Catcher framing scores — framing runs above average per catcher
3. Park K-factors — refine with altitude, humidity, fence distance
4. Probable pitcher tracking — SP announcement ingestion (mid-March)
5. Accuracy dashboard wiring — auto-update `accuracy_summary` from grading runs

---

## Screenshots

See `docs/screenshots/` for Week 1 launch screenshots.

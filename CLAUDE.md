# CLAUDE.md — FullCountProps

> **This file is the canonical source of truth for product specifications.**
> If any other document in this repository contradicts the numbers or definitions below, this file takes precedence.

---

## Product Overview

FullCountProps is an MLB prop betting SaaS that uses MLB Statcast data to generate prediction-driven prop recommendations. Predictions are powered by **5,000 Monte Carlo simulations**, a **LightGBM matchup model**, and **24 Statcast features**.

### Subscription Tiers

| Tier | Price | Notes |
|------|-------|-------|
| Free | $0 | Limited access |
| Paid | $9/month | Full access |

---

## Canonical Product Specifications

These values are authoritative. Any conflicting values elsewhere in the repo are incorrect.

- **Monte Carlo simulations:** 5,000
- **ML model:** LightGBM (matchup model)
- **Statcast features:** 24
- **Subscription price (paid tier):** $9/month
- **Subscription price (free tier):** $0

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js (React) |
| Database | Supabase (PostgreSQL + Auth + RLS) |
| Deployment | Vercel |
| ML / Predictions | LightGBM, Monte Carlo simulation |
| Data Source | MLB Statcast |

---

## Project Structure

```
/
├── CLAUDE.md              # This file — source of truth
├── README.md
├── Makefile
├── .github/workflows/     # CI/CD workflows
├── analysis/              # Data analysis scripts
├── configs/               # Configuration files
├── dashboard/data/        # Dashboard data files
├── data/                  # Raw and processed data
├── docs/                  # Documentation
├── frontend/              # Next.js frontend application
├── lib/                   # Shared libraries
├── models/                # ML model files and logic
├── pipeline/              # Data pipeline scripts
├── scripts/               # Utility scripts
├── simulation/            # Monte Carlo simulation engine
├── simulator/             # Simulator utilities
├── supabase/              # Supabase migrations and config
├── tests/                 # Test files
├── .env.example
├── .env.local.example
└── .gitignore
```

---

## Build & Dev Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run production build
npm run build

# Run linter
npm run lint

# Run tests
npm test
```

---

## Coding Conventions

- Use TypeScript with strict mode enabled
- Use functional React components with hooks (no class components)
- Use named exports where possible
- Keep components small and composable
- Use `async/await` over raw Promises
- Format with Prettier; lint with ESLint

---

## Mandatory Rules

### Do NOT do the following without explicit approval from the founder:

1. **NEVER modify pricing logic or subscription tier definitions.** This includes prices, tier names, feature gates, trial periods, or billing intervals.

2. **NEVER delete or alter database tables or RLS policies.** Do not drop tables, remove columns, or modify RLS policies. If a schema change is needed, create a new migration and get approval first.

3. **NEVER change environment variables or API keys.** Do not modify `.env.local`, `.env.production`, Vercel environment settings, or any file containing secrets/keys.

### Always follow this workflow:

4. **Always use plan mode first.** Before writing any code, explain what you intend to change and why. Get confirmation, then proceed.

5. **Always explain changes in plain language.** The founder is a non-developer. Every explanation should be clear and jargon-free.

6. **Run existing tests after any code changes.** Run `npm test` and verify all tests pass before considering the task complete.

7. **Create a new Git branch for every task.** Never commit directly to `main`. Use descriptive branch names. Open a PR for review.

---

## Environment Variables

Expected env vars (do NOT commit actual values):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

## Deployment

- **Platform:** Vercel
- **Branch strategy:** `main` auto-deploys to production. Feature branches get preview deployments.
- **Database:** Supabase (managed PostgreSQL). Migrations in `supabase/`.

---

## Testing

Tests should cover:
- Monte Carlo simulation output ranges and distributions
- LightGBM model input/output contracts
- Statcast feature extraction (all 24 features)
- Subscription tier gating logic
- API route handlers

---

## Notes for AI Assistants

- Read this file first before making any changes to the codebase.
- The canonical product specs (5,000 sims, LightGBM, 24 features, $9/month paid tier) are defined here and override any other documentation.
- When in doubt, ask the founder before proceeding.
- Keep PRs small and focused — one task per branch.

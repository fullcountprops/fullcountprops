# FullCountProps — Improvement Backlog

_Last updated: March 2, 2026 (post-Cycle #5)_

## Priority 1 — Critical Path to Opening Day (March 27)

| # | Task | Complexity | Status |
|---|------|-----------|--------|
| 1 | Run `make full-pipeline` (Statcast backfill → training data → model) | Large | Ready to execute |
| 2 | Add Stripe webhook handler (`/api/webhooks/stripe`) for subscription fulfillment | Medium | Not started |
| 3 | Set up WBC pitcher overrides (March 5-22) | Small | Schema ready, needs data |
| 4 | Wire `generate_daily_content.py` into morning pipeline | Small | Script exists, needs workflow step |

## Priority 2 — Technical Debt

| # | Task | Complexity | Status |
|---|------|-----------|--------|
| 5 | Migrate `tests/test_simulation.py` → import from `simulator/` | Small | Wrapper in place |
| 6 | Add `email_subscribers` table to monetization migration | Small | Table exists from prior migration |
| 7 | Add daily reset cron for `api_keys.requests_today` | Small | Not started |
| 8 | Fix `increment_rate_limit()` stored proc (needs INSERT...ON CONFLICT) | Small | Not started |
| 9 | Generate and commit `frontend/package-lock.json` | Small | Not started |
| 10 | Add Supabase migration 001 stub pointing to schema.sql | Small | Not started |

## Priority 3 — Enhancements

| # | Task | Complexity | Status |
|---|------|-----------|--------|
| 11 | Add early-season TB ramp-up weighting to batter projections | Medium | Not started |
| 12 | Integrate umpire/catcher framing composites into projections | Large | Model exists in analysis/ |
| 13 | Add SHAP explanations to projection detail pages | Medium | SHAP in requirements |
| 14 | Build email newsletter with Resend (daily edge digest) | Medium | Template exists |
| 15 | Add Twitter API integration for automated posting | Medium | Script exists |

## Completed (Cycle #5)
- ~~Merge PR #4 (Statcast pipeline)~~
- ~~Merge PR #5 (REST API + monetization)~~
- ~~Fix outcome class mismatch (11 → 8 classes)~~
- ~~Consolidate simulation/ and simulator/~~
- ~~Build LightGBM training pipeline~~
- ~~Wire accuracy dashboard to live Supabase~~
- ~~Fix weather table mismatch~~
- ~~Expand CI lint scope~~
- ~~Add DATA_PIPELINE.md~~
- ~~Add Makefile pipeline targets~~

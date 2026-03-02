# BaselineMLB — Improvement Backlog

> Generated: 2026-03-02 (Continuous Improvement Cycle #2)

## Component Grades (Phase 1 Audit — Cycle #2)

| Component | Cycle #1 Grade | Cycle #2 Grade | Δ | Notes |
|-----------|---------------|---------------|---|-------|
| **Pipeline (pipeline/)** | B | B+ | ↑ | v2.0 model with 7 factors, umpire/catcher integration. Nested `pipeline/pipeline/` leftover needs cleanup. |
| **Scripts (scripts/)** | D | C- | ↑ | `grade_accuracy.py` fixed but 4 duplicate fetch scripts still present. `backtest_simulator.py` uses stub fallbacks. `analysis/projection_model.py` has TODO placeholders returning 0.0. |
| **Simulator (simulator/)** | B- | B | ↑ | Compatibility layer added. `run_daily.py` has undefined `BatterProfile` type annotation (F821). 2 test failures from signature mismatch. |
| **Simulation (simulation/)** | B+ | B+ | = | 130 tests pass. Still a separate package from `simulator/` — consolidation pending from Cycle #1. |
| **Models (models/)** | B | B | = | Well-structured but still untrained (no Statcast parquet data). LightGBM training blocked until data pipeline runs. |
| **Frontend (frontend/)** | B | B+ | ↑ | Many new pages (best-bets, calibration, players, simulator). Accuracy page wired to Supabase with hardcoded fallback. |
| **GitHub Actions** | C+ | **D** | ↓ | **CI is failing** — all recent runs fail on Ruff lint (F841, E722, E701 errors). `model_retrain.yml` triggers on every push to main. |
| **Supabase Schema** | A- | A- | = | 16 tables in main schema. Multiple migration files with some overlapping table names (sim_results vs simulation_results). |
| **Documentation** | B+ | A- | ↑ | IMPROVEMENT_LOG, BACKLOG, ARCHITECTURE, METHODOLOGY docs all present. |
| **Tests** | C | **B-** | ↑ | 242/244 passing (2 failures from `build_batter_profile` signature mismatch). Down from 247 — some tests may have been removed. |
| **Code Quality (Ruff)** | C- | C | ↑ | 105 errors remaining (down from 163). 57 auto-fixable. F821 undefined name in run_daily.py. |
| **Overall** | **C+** | **C+** | = | Foundation improved but CI regression is a blocker. |

---

## Ranked Improvements (Top 5)

### 1. 🔴 FIX: CI is broken — Ruff lint errors failing every push
- **Impact**: CRITICAL — no code can be validated through CI. Every push triggers a failing run.
- **Category**: Fixing broken code
- **Details**: CI `lint-python` job fails on: 20× F841 (unused variables), 9× E701 (multiple statements on one line), 1× E722 (bare except), 1× F821 (undefined name). The `model_retrain.yml` also fires on every push to main (misconfigured trigger).
- **Fix**: Auto-fix 57 fixable errors with `ruff --fix`, manually fix remaining F841/E701/E722/F821 errors. Fix model_retrain.yml trigger to only fire on schedule/workflow_dispatch.

### 2. 🔴 FIX: 2 test failures — `build_batter_profile()` signature mismatch
- **Impact**: HIGH — Tests pass `lineup_position=` and rate kwargs but function expects `position=` and `stats=` dict.
- **Category**: Fixing broken code
- **Details**: `tests/test_simulator.py` lines 821-843 call `build_batter_profile(lineup_position=3, k_rate=0.22, ...)` but the actual function in `simulator/run_daily.py` expects `position=3, stats={...}`.
- **Fix**: Update the test to match the actual function signature, OR add backward-compatible kwargs to the function.

### 3. 🟡 CLEANUP: Remove stale duplicates and nested directories
- **Impact**: MEDIUM — confusing repo structure, potential for running wrong version of scripts.
- **Category**: Code organization
- **Details**: (a) 4 duplicate fetch scripts in `scripts/` vs `pipeline/` (pipeline/ is authoritative). (b) Nested `pipeline/pipeline/` directory with stale .env.example, requirements.txt, schema.sql. (c) `simulation/` and `simulator/` are separate packages doing similar things.
- **Fix**: Remove `scripts/fetch_games.py`, `scripts/fetch_players.py`, `scripts/fetch_props.py`, `scripts/fetch_statcast.py`. Remove `pipeline/pipeline/` nested dir. Add deprecation notice to `simulation/`.

### 4. 🟡 COMPLETE: `analysis/projection_model.py` has placeholder stubs returning 0.0
- **Impact**: MEDIUM — the glass-box projection model's `opponent_k_rate()` and `park_factor_adjustment()` are incomplete.
- **Category**: Completing stub/placeholder code
- **Details**: `opponent_k_rate()` returns 0.0 with a TODO comment. `park_factor_adjustment()` only covers 4 parks (not all 30). `expected_ip` is hardcoded at 5.5. Note: `pipeline/generate_projections.py` (the production version) already has these fixed in v2.0 — `analysis/projection_model.py` is the original prototype.
- **Fix**: Either remove `analysis/projection_model.py` (superseded by pipeline v2.0) or update it to match v2.0 logic.

### 5. 🟢 IMPROVE: Fix `model_retrain.yml` misconfigured trigger
- **Impact**: LOW-MEDIUM — fires on every push to main (should only fire monthly/on-demand).
- **Category**: Fixing broken code
- **Details**: The workflow fires on `push: branches: [main]` in addition to its monthly cron. This wastes CI minutes and creates noise.
- **Fix**: Remove the `push` trigger, keep only `schedule` and `workflow_dispatch`.

---

## Additional Improvements (Queued from Cycle #1 + New)

6. Consolidate `simulation/` and `simulator/` into one canonical package
7. Train LightGBM model on Statcast data before Opening Day (March 27)
8. Clean up overlapping Supabase migration files (sim_results vs simulation_results naming)
9. Add integration test for full `make simulate` pipeline with mocked APIs
10. Remaining Ruff lint errors after auto-fix (manual review needed)

"""
run_daily.py — Daily orchestrator for the BaselineMLB simulation pipeline
==========================================================================

Drives the full end-to-end simulation workflow for a given MLB game date:

1. Fetch today's games from Supabase ``games`` table.
2. Fetch confirmed lineups (from Supabase ``lineups`` table or
   ``pipeline/fetch_lineups.py``).
3. Fetch weather data (from Supabase ``weather`` table or
   ``pipeline/fetch_weather.py``).
4. Load the trained matchup model from
   ``models/trained/matchup_model.joblib``.
5. For each game, generate per-PA matchup probabilities from the model.
6. Apply weather adjustments to matchup probabilities.
7. Run the Monte Carlo simulation (default 3 000 iterations per game).
8. Calculate prop edges against today's sportsbook lines.
9. Upsert simulation results to Supabase ``sim_results`` table.
10. Upsert prop edges to Supabase ``sim_prop_edges`` table.
11. Print a daily summary report.

CLI usage
---------
Run all games for today::

    python -m simulator.run_daily

Run a specific date with 5 000 simulations::

    python -m simulator.run_daily --date 2026-04-15 --n-sims 5000

Dry-run (no Supabase writes)::

    python -m simulator.run_daily --dry-run

Limit to specific games::

    python -m simulator.run_daily --games 745123,745124

Exit codes
----------
0   All games processed successfully.
1   One or more games failed, or a fatal error occurred.
"""

from __future__ import annotations

import argparse
import importlib
import json
import logging
import os
import sys
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .monte_carlo_engine import BatterProfile

import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants / paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = PROJECT_ROOT / "models" / "trained"
MATCHUP_MODEL_PATH = MODELS_DIR / "matchup_model.joblib"

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _headers() -> dict[str, str]:
    key = os.environ.get("SUPABASE_SERVICE_KEY", _SUPABASE_KEY)
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _get(endpoint: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    base = os.environ.get("SUPABASE_URL", _SUPABASE_URL)
    if not base:
        raise RuntimeError("SUPABASE_URL is not set.")
    url = f"{base}/rest/v1{endpoint}"
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    if not resp.ok:
        raise RuntimeError(f"GET {endpoint} failed [{resp.status_code}]: {resp.text[:400]}")
    return resp.json()


def _upsert(endpoint: str, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    base = os.environ.get("SUPABASE_URL", _SUPABASE_URL)
    if not base:
        raise RuntimeError("SUPABASE_URL is not set.")
    url = f"{base}/rest/v1{endpoint}"
    resp = requests.post(url, headers=_headers(), json=rows, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"UPSERT {endpoint} failed [{resp.status_code}]: {resp.text[:400]}")
    logger.info("Upserted %d rows to %s", len(rows), endpoint)


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class GameRecord:
    game_pk: int
    game_date: str
    home_team_id: int
    away_team_id: int
    venue_id: int
    status: str


@dataclass
class PipelineResult:
    game_pk: int
    success: bool
    error: str = ""
    elapsed_seconds: float = 0.0
    n_simulations: int = 0
    n_prop_edges: int = 0
    home_score_mean: float = 0.0
    away_score_mean: float = 0.0
    sim_result_id: str = ""


# ---------------------------------------------------------------------------
# Data-fetch helpers
# ---------------------------------------------------------------------------


def fetch_todays_games(game_date: str, game_pks: list[int] | None = None) -> list[GameRecord]:
    params: dict[str, Any] = {
        "select": "game_pk,game_date,home_team_id,away_team_id,venue_id,status",
        "game_date": f"eq.{game_date}",
    }
    if game_pks:
        params["game_pk"] = f"in.({','.join(str(pk) for pk in game_pks)})"
    logger.info("Fetching games for %s...", game_date)
    rows = _get("/games", params=params)
    games = [
        GameRecord(
            game_pk=int(r["game_pk"]),
            game_date=str(r.get("game_date", game_date)),
            home_team_id=int(r.get("home_team_id", 0)),
            away_team_id=int(r.get("away_team_id", 0)),
            venue_id=int(r.get("venue_id", 0)),
            status=str(r.get("status", "")),
        )
        for r in rows
    ]
    logger.info("Found %d game(s) for %s", len(games), game_date)
    return games


def fetch_lineups(game_pk: int, game_date: str) -> dict[str, Any]:
    try:
        fetch_mod = importlib.import_module("pipeline.fetch_lineups")
        return fetch_mod.get_lineups(game_pk)
    except (ImportError, AttributeError):
        logger.debug("pipeline.fetch_lineups unavailable; falling back to Supabase.")
    rows = _get("/lineups", params={"game_pk": f"eq.{game_pk}", "select": "*"})
    home_rows = [r for r in rows if r.get("side") == "home"]
    away_rows = [r for r in rows if r.get("side") == "away"]
    home_lineup = sorted(home_rows, key=lambda r: r.get("batting_order", 99))
    away_lineup = sorted(away_rows, key=lambda r: r.get("batting_order", 99))
    home_pitcher = next((r for r in home_rows if r.get("is_pitcher")), {})
    away_pitcher = next((r for r in away_rows if r.get("is_pitcher")), {})
    return {
        "home_lineup": [str(r["player_id"]) for r in home_lineup if not r.get("is_pitcher")],
        "away_lineup": [str(r["player_id"]) for r in away_lineup if not r.get("is_pitcher")],
        "home_pitcher_id": str(home_pitcher.get("player_id", "home_sp")),
        "away_pitcher_id": str(away_pitcher.get("player_id", "away_sp")),
    }


def fetch_weather(game_pk: int, venue_id: int) -> dict[str, Any]:
    _DEFAULTS: dict[str, Any] = {
        "temp_f": 72.0, "wind_mph": 0.0, "wind_dir": "calm",
        "humidity_pct": 50.0, "precip_in": 0.0,
    }
    try:
        rows = _get("/game_weather", params={"game_pk": f"eq.{game_pk}", "select": "*"})
        if rows:
            raw = rows[0]
            return {
                "temp_f": float(raw.get("temp_f") or raw.get("temperature_f") or _DEFAULTS["temp_f"]),
                "wind_mph": float(raw.get("wind_mph") or raw.get("wind_speed_mph") or _DEFAULTS["wind_mph"]),
                "wind_dir": str(raw.get("wind_dir") or raw.get("wind_direction") or _DEFAULTS["wind_dir"]),
                "humidity_pct": float(raw.get("humidity_pct") or raw.get("humidity") or _DEFAULTS["humidity_pct"]),
                "precip_in": float(raw.get("precip_in") or raw.get("precipitation_in") or _DEFAULTS["precip_in"]),
            }
    except Exception:
        logger.debug("game_weather lookup failed for game_pk=%d; trying legacy table.", game_pk)
    try:
        rows = _get("/weather", params={"game_pk": f"eq.{game_pk}", "select": "*"})
        if rows:
            logger.debug("Using legacy weather table for game_pk=%d.", game_pk)
            return rows[0]
    except Exception:
        logger.debug("Legacy weather lookup failed for game_pk=%d.", game_pk)
    logger.warning("No weather data for game_pk=%d; using defaults.", game_pk)
    return _DEFAULTS


def load_matchup_model(model_path: Path | None = None) -> Any:
    path = model_path or MATCHUP_MODEL_PATH
    if not path.exists():
        logger.warning("Matchup model not found at %s; using baseline probabilities.", path)
        return None
    try:
        import joblib
        model = joblib.load(path)
        logger.info("Loaded matchup model from %s", path)
        return model
    except Exception as exc:
        logger.error("Failed to load matchup model: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Probability generation
# ---------------------------------------------------------------------------

_LEAGUE_AVG_PROBS: dict[str, float] = {
    "K": 0.225, "BB": 0.085, "HBP": 0.010, "1B": 0.155,
    "2B": 0.050, "3B": 0.005, "HR": 0.035, "out": 0.435,
}

_WEATHER_ADJUSTMENTS: dict[str, dict[str, float]] = {
    "HR": {"wind_out": 0.08, "wind_in": -0.08, "high_temp": 0.03, "high_humidity": -0.02},
    "2B": {"wind_out": 0.03, "wind_in": -0.02, "high_temp": 0.01, "high_humidity": -0.01},
    "K": {"wind_out": 0.0, "wind_in": 0.0, "high_temp": -0.01, "high_humidity": 0.01},
    "out": {"wind_out": -0.02, "wind_in": 0.02, "high_temp": 0.0, "high_humidity": 0.0},
}


def generate_matchup_probs(pitcher_id: str, batter_id: str, model: Any) -> dict[str, float]:
    if model is None:
        return dict(_LEAGUE_AVG_PROBS)
    try:
        if hasattr(model, "predict_proba_for_matchup"):
            return model.predict_proba_for_matchup(pitcher_id, batter_id)
        return dict(_LEAGUE_AVG_PROBS)
    except Exception as exc:
        logger.debug("Model prediction failed (%s); using league averages.", exc)
        return dict(_LEAGUE_AVG_PROBS)


def apply_weather_adjustments(probs: dict[str, float], weather: dict[str, Any]) -> dict[str, float]:
    adjusted = dict(probs)
    wind_mph = float(weather.get("wind_mph", 0))
    wind_dir = str(weather.get("wind_dir", "calm")).lower()
    temp_f = float(weather.get("temp_f", 72))
    humidity = float(weather.get("humidity_pct", 50))
    if wind_mph >= 10 and "out" in wind_dir:
        for outcome, adj in _WEATHER_ADJUSTMENTS.items():
            adjusted[outcome] = adjusted.get(outcome, 0) * (1 + adj.get("wind_out", 0))
    elif wind_mph >= 10 and "in" in wind_dir:
        for outcome, adj in _WEATHER_ADJUSTMENTS.items():
            adjusted[outcome] = adjusted.get(outcome, 0) * (1 + adj.get("wind_in", 0))
    if temp_f >= 85:
        for outcome, adj in _WEATHER_ADJUSTMENTS.items():
            adjusted[outcome] = adjusted.get(outcome, 0) * (1 + adj.get("high_temp", 0))
    if humidity >= 80:
        for outcome, adj in _WEATHER_ADJUSTMENTS.items():
            adjusted[outcome] = adjusted.get(outcome, 0) * (1 + adj.get("high_humidity", 0))
    total = sum(adjusted.values())
    if total > 0:
        adjusted = {k: v / total for k, v in adjusted.items()}
    return adjusted


def build_pitcher_probs(pitcher_id: str, lineup: list[str], model: Any, weather: dict[str, Any]) -> dict[str, dict[str, float]]:
    probs: dict[str, dict[str, float]] = {}
    for batter_id in lineup:
        base_probs = generate_matchup_probs(pitcher_id, batter_id, model)
        adjusted = apply_weather_adjustments(base_probs, weather)
        probs[batter_id] = adjusted
    return probs


# ---------------------------------------------------------------------------
# Supabase output formatters
# ---------------------------------------------------------------------------


def _sim_result_rows(game_pk, game_date, summary, n_sims):
    rows: list[dict[str, Any]] = []
    run_at = datetime.utcnow().isoformat()

    def _stat_dict(stat_sum):
        return {"mean": stat_sum.mean, "median": stat_sum.median, "std": stat_sum.std,
                "p10": stat_sum.p10, "p25": stat_sum.p25, "p75": stat_sum.p75,
                "p90": stat_sum.p90, "min": stat_sum.min, "max": stat_sum.max}

    rows.append({"game_pk": game_pk, "game_date": game_date, "player_id": "home_team",
                 "player_type": "team", "stat_type": "runs", "stats": _stat_dict(summary.home_score),
                 "n_simulations": n_sims, "run_at": run_at})
    rows.append({"game_pk": game_pk, "game_date": game_date, "player_id": "away_team",
                 "player_type": "team", "stat_type": "runs", "stats": _stat_dict(summary.away_score),
                 "n_simulations": n_sims, "run_at": run_at})
    for player_id, stat_map in summary.batter_stats.items():
        for stat_name, stat_sum in stat_map.items():
            rows.append({"game_pk": game_pk, "game_date": game_date, "player_id": player_id,
                         "player_type": "batter", "stat_type": stat_name,
                         "stats": _stat_dict(stat_sum), "n_simulations": n_sims, "run_at": run_at})
    for player_id, stat_map in summary.pitcher_stats.items():
        for stat_name, stat_sum in stat_map.items():
            rows.append({"game_pk": game_pk, "game_date": game_date, "player_id": player_id,
                         "player_type": "pitcher", "stat_type": stat_name,
                         "stats": _stat_dict(stat_sum), "n_simulations": n_sims, "run_at": run_at})
    return rows


def _prop_edge_rows(game_pk, game_date, edges):
    run_at = datetime.utcnow().isoformat()
    rows: list[dict[str, Any]] = []
    for e in edges:
        row = asdict(e) if hasattr(e, "__dataclass_fields__") else dict(e)
        row["game_pk"] = game_pk
        row["game_date"] = game_date
        row["run_at"] = run_at
        if isinstance(row.get("explanation"), dict):
            row["explanation"] = json.dumps(row["explanation"], default=str)
        rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Per-game pipeline
# ---------------------------------------------------------------------------


def run_game_pipeline(game: GameRecord, model: Any, n_sims: int, dry_run: bool) -> PipelineResult:
    from .monte_carlo_engine import GameSimulator, SimulationConfig
    from .prop_calculator import PropCalculator

    t0 = time.perf_counter()
    logger.info("--- Game %d (%s @ %s) ---", game.game_pk, game.away_team_id, game.home_team_id)

    try:
        t_step = time.perf_counter()
        lineups = fetch_lineups(game.game_pk, game.game_date)
        home_lineup: list[str] = lineups.get("home_lineup", [])
        away_lineup: list[str] = lineups.get("away_lineup", [])
        home_pitcher_id: str = lineups.get("home_pitcher_id", "home_sp")
        away_pitcher_id: str = lineups.get("away_pitcher_id", "away_sp")
        logger.info("  Lineups fetched in %.2fs  (home=%d, away=%d)",
                    time.perf_counter() - t_step, len(home_lineup), len(away_lineup))

        if not home_lineup or not away_lineup:
            raise ValueError(f"Missing lineup data for game_pk={game.game_pk}")

        while len(home_lineup) < 9:
            home_lineup.append(f"home_b{len(home_lineup)}")
        while len(away_lineup) < 9:
            away_lineup.append(f"away_b{len(away_lineup)}")

        t_step = time.perf_counter()
        weather = fetch_weather(game.game_pk, game.venue_id)
        logger.info("  Weather: %.0f\u00b0F, wind %s mph %s  (%.2fs)",
                    weather.get("temp_f", 72), weather.get("wind_mph", 0),
                    weather.get("wind_dir", "calm"), time.perf_counter() - t_step)

        t_step = time.perf_counter()
        home_pitcher_probs = build_pitcher_probs(home_pitcher_id, away_lineup, model, weather)
        away_pitcher_probs = build_pitcher_probs(away_pitcher_id, home_lineup, model, weather)
        logger.info("  Matchup probs generated in %.2fs", time.perf_counter() - t_step)

        t_step = time.perf_counter()
        engine = GameSimulator()
        cfg = SimulationConfig(n_simulations=n_sims)
        sim_result = engine.simulate_game(
            home_lineup, away_lineup, home_pitcher_probs, away_pitcher_probs, cfg,
            home_pitcher_id=home_pitcher_id, away_pitcher_id=away_pitcher_id,
        )
        summary = engine.summarise(sim_result)
        sim_elapsed = time.perf_counter() - t_step
        logger.info("  Simulation: home %.2f | away %.2f  (%d sims in %.2fs)",
                    summary.home_score.mean, summary.away_score.mean, n_sims, sim_elapsed)

        t_step = time.perf_counter()
        calc = PropCalculator()
        try:
            props = calc.fetch_todays_props(game.game_date, [game.game_pk])
        except RuntimeError as exc:
            logger.warning("  Props fetch failed: %s — skipping prop edges.", exc)
            props = []
        edges = calc.calculate_prop_edges(summary, props) if props else []
        logger.info("  Prop edges: %d edges found  (%.2fs)", len(edges), time.perf_counter() - t_step)

        if not dry_run:
            t_step = time.perf_counter()
            sim_rows = _sim_result_rows(game.game_pk, game.game_date, summary, n_sims)
            _upsert("/sim_results", sim_rows)
            if edges:
                edge_rows = _prop_edge_rows(game.game_pk, game.game_date, edges)
                _upsert("/sim_prop_edges", edge_rows)
            logger.info("  Upserted %d sim rows + %d edge rows  (%.2fs)",
                        len(sim_rows), len(edges), time.perf_counter() - t_step)
        else:
            logger.info("  [dry-run] Skipping Supabase upserts.")

        elapsed = time.perf_counter() - t0
        return PipelineResult(
            game_pk=game.game_pk, success=True, elapsed_seconds=round(elapsed, 2),
            n_simulations=n_sims, n_prop_edges=len(edges),
            home_score_mean=round(summary.home_score.mean, 3),
            away_score_mean=round(summary.away_score.mean, 3),
        )

    except Exception as exc:
        elapsed = time.perf_counter() - t0
        logger.error("  FAILED game_pk=%d: %s", game.game_pk, exc, exc_info=True)
        return PipelineResult(game_pk=game.game_pk, success=False, error=str(exc),
                              elapsed_seconds=round(elapsed, 2))


# ---------------------------------------------------------------------------
# Daily summary report
# ---------------------------------------------------------------------------


def generate_daily_report(game_date, results, total_elapsed, dry_run):
    sep = "=" * 66
    successes = [r for r in results if r.success]
    failures = [r for r in results if not r.success]
    total_sims = sum(r.n_simulations for r in successes)
    total_edges = sum(r.n_prop_edges for r in successes)
    lines = [
        sep,
        f"  BaselineMLB Daily Simulation Report — {game_date}",
        f"  {'[DRY RUN] ' if dry_run else ''}Run at {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
        sep,
        f"  Games processed : {len(results)}  ({len(successes)} OK, {len(failures)} failed)",
        f"  Total sims      : {total_sims:,}",
        f"  Prop edges      : {total_edges}",
        f"  Total time      : {total_elapsed:.1f}s",
        sep,
        "  PER-GAME RESULTS:",
    ]
    for r in results:
        status = "OK" if r.success else f"FAIL ({r.error[:50]})"
        lines.append(f"    game_pk={r.game_pk:>7}  {status:55s}  {r.elapsed_seconds:.1f}s  "
                     f"H:{r.home_score_mean:.2f} A:{r.away_score_mean:.2f}  edges={r.n_prop_edges}")
    lines.append(sep)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run the BaselineMLB Monte Carlo simulation pipeline for today's games.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--date", type=str, default=date.today().isoformat())
    parser.add_argument("--games", type=str, default=None)
    parser.add_argument("--n-sims", type=int, default=3_000)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--model-path", type=str, default=None)
    parser.add_argument("--log-level", choices=["DEBUG", "INFO", "WARNING", "ERROR"], default="INFO")
    args = parser.parse_args(argv)
    logging.getLogger().setLevel(getattr(logging, args.log_level))

    game_date: str = args.date
    game_pks: list[int] | None = (
        [int(pk.strip()) for pk in args.games.split(",") if pk.strip()] if args.games else None
    )
    n_sims: int = args.n_sims
    dry_run: bool = args.dry_run
    model_path = Path(args.model_path) if args.model_path else None

    logger.info("BaselineMLB daily pipeline starting: date=%s  n_sims=%d  dry_run=%s",
                game_date, n_sims, dry_run)
    pipeline_start = time.perf_counter()

    try:
        games = fetch_todays_games(game_date, game_pks)
    except RuntimeError as exc:
        logger.error("Failed to fetch games: %s", exc)
        return 1

    if not games:
        logger.warning("No games found for %s — exiting.", game_date)
        return 0

    model = load_matchup_model(model_path)
    results: list[PipelineResult] = []
    for game in games:
        result = run_game_pipeline(game, model, n_sims, dry_run)
        results.append(result)

    total_elapsed = time.perf_counter() - pipeline_start
    report = generate_daily_report(game_date, results, total_elapsed, dry_run)
    print("\n" + report + "\n")

    any_failed = any(not r.success for r in results)
    if any_failed:
        logger.error("Pipeline completed with errors.")
        return 1

    logger.info("Pipeline completed successfully in %.1fs.", total_elapsed)
    return 0


if __name__ == "__main__":
    sys.exit(main())


# ===========================================================================
# RUN DAILY COMPATIBILITY LAYER
# ===========================================================================


def _normalize_stat_type(raw_stat: str) -> str:
    _MAP: dict[str, str] = {
        "pitcher_strikeouts": "K", "batter_strikeouts": "K",
        "batter_total_bases": "TB", "total_bases": "TB",
        "batter_hits": "H", "hits": "H",
        "home_runs": "HR", "batter_home_runs": "HR",
        "batter_walks": "BB", "pitcher_walks": "BB", "walks": "BB",
        "rbis": "RBI", "batter_rbis": "RBI",
        "batter_runs": "R", "runs": "R",
    }
    return _MAP.get(raw_stat, raw_stat)


def weather_to_modifier(weather: dict) -> float:
    temp_f = float(weather.get("temperature_f", weather.get("temp_f", 72)))
    wind_mph = float(weather.get("wind_mph", 0))
    temp_mod = 1.0 + (temp_f - 72.0) * 0.003
    wind_mod = 1.0 + wind_mph * 0.001
    modifier = temp_mod * wind_mod
    return float(max(0.85, min(1.15, modifier)))


def build_batter_profile(mlbam_id: int, name: str, position: int, stats: dict, min_pa: int = 50) -> "BatterProfile":
    from .monte_carlo_engine import MLB_AVG_PROBS, BatterProfile, build_batter_probs

    pa = int(stats.get("plateAppearances", 0))
    if pa < min_pa:
        return BatterProfile(mlbam_id=mlbam_id, name=name, lineup_position=position, probs=MLB_AVG_PROBS.copy())

    k = int(stats.get("strikeOuts", 0))
    bb = int(stats.get("baseOnBalls", 0))
    hbp = int(stats.get("hitByPitch", 0))
    h = int(stats.get("hits", 0))
    d = int(stats.get("doubles", 0))
    t = int(stats.get("triples", 0))
    hr = int(stats.get("homeRuns", 0))
    singles = h - d - t - hr

    probs = build_batter_probs(
        k_rate=k / pa, bb_rate=bb / pa, hbp_rate=hbp / pa,
        single_rate=max(0.0, singles / pa), double_rate=d / pa,
        triple_rate=t / pa, hr_rate=hr / pa,
    )
    return BatterProfile(mlbam_id=mlbam_id, name=name, lineup_position=position, probs=probs)

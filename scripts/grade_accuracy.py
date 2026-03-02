"""
grade_accuracy.py — Baseline MLB
Nightly grading script: compares projections to actual results,
populates `picks` and `accuracy_summary` tables in Supabase.

Run via GitHub Actions at 2 AM ET (after all games complete).
Can also be run manually: python scripts/grade_accuracy.py [--date 2026-03-15]

Flow:
  1. Fetch completed games for the target date from MLB Stats API
  2. Extract actual pitcher strikeout totals from box scores
  3. Load ungraded projections from Supabase `projections` table
  4. Compare projected Ks vs actual Ks vs prop line
  5. Calculate hit/miss, CLV, and confidence calibration
  6. Upsert graded picks to `picks` table
  7. Roll up accuracy stats to `accuracy_summary` table
"""

import argparse
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Config & logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("grade_accuracy")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1"

REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]

def validate_env():
    """Raise immediately if any required env var is missing."""
    missing = [v for v in REQUIRED_ENV if not os.environ.get(v)]
    if missing:
        raise EnvironmentError(f"Missing env vars: {', '.join(missing)}")

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

def supabase_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

def supabase_get(table: str, params: dict) -> list:
    """GET rows from a Supabase table with query params."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.get(url, headers=supabase_headers(), params=params)
    resp.raise_for_status()
    return resp.json()

def supabase_upsert(table: str, rows: list, batch_size: int = 500):
    """Upsert rows into a Supabase table in batches."""
    if not rows:
        log.info(f"  No rows to upsert into {table}")
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        resp = requests.post(url, headers=supabase_headers(), json=batch)
        resp.raise_for_status()
        log.info(f"  Upserted {len(batch)} rows into {table}")

# ---------------------------------------------------------------------------
# MLB Stats API — fetch actual results
# ---------------------------------------------------------------------------

def fetch_completed_games(date_str: str) -> list:
    game_pks = []
    for sport_id in [1, 51]:
        url = f"{MLB_STATS_BASE}/schedule"
        params = {"sportId": sport_id, "date": date_str, "hydrate": "linescore"}
        resp = requests.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        for date_entry in data.get("dates", []):
            for game in date_entry.get("games", []):
                status = game.get("status", {}).get("abstractGameState", "")
                if status == "Final":
                    game_pks.append(game["gamePk"])
    log.info(f"Found {len(game_pks)} completed games on {date_str}")
    return game_pks

def fetch_pitcher_actuals(game_pk: int) -> list:
    url = f"{MLB_STATS_BASE}/game/{game_pk}/boxscore"
    resp = requests.get(url)
    resp.raise_for_status()
    box = resp.json()
    results = []
    for side in ["away", "home"]:
        team_data = box.get("teams", {}).get(side, {})
        team_name = team_data.get("team", {}).get("name", "Unknown")
        players = team_data.get("players", {})
        for player_key, player_data in players.items():
            stats = player_data.get("stats", {}).get("pitching", {})
            if not stats or stats.get("inningsPitched", "0.0") == "0.0":
                continue
            pitcher_id = player_data.get("person", {}).get("id")
            pitcher_name = player_data.get("person", {}).get("fullName", "Unknown")
            ip_str = stats.get("inningsPitched", "0.0")
            try:
                parts = ip_str.split(".")
                ip_float = int(parts[0]) + (int(parts[1]) / 3 if len(parts) > 1 else 0)
            except (ValueError, IndexError):
                ip_float = 0.0
            results.append({
                "game_pk": game_pk,
                "pitcher_id": pitcher_id,
                "pitcher_name": pitcher_name,
                "team": team_name,
                "actual_ks": int(stats.get("strikeOuts", 0)),
                "innings_pitched": round(ip_float, 2),
                "hits_allowed": int(stats.get("hits", 0)),
                "walks": int(stats.get("baseOnBalls", 0)),
                "earned_runs": int(stats.get("earnedRuns", 0)),
                "pitches_thrown": int(stats.get("numberOfPitches", 0)),
            })
    return results

def load_ungraded_projections(date_str: str) -> list:
    params = {"game_date": f"eq.{date_str}", "select": "*"}
    rows = supabase_get("projections", params)
    log.info(f"Loaded {len(rows)} projections for {date_str}")
    return rows

def load_prop_lines(date_str: str) -> dict:
    """
    Fetch prop lines for the date from `props` table.
    Returns dict keyed by (mlbam_id, stat_type) -> {line, odds, book}.
    FIXED: Uses actual column names from the props table schema.
    """
    params = {"game_date": f"eq.{date_str}", "select": "*", "order": "fetched_at.desc"}
    rows = supabase_get("props", params)
    props = {}
    for row in rows:
        mlbam_id = row.get("mlbam_id")
        stat_type = row.get("stat_type", "")
        if not mlbam_id or not stat_type:
            continue
        key = (int(mlbam_id), stat_type)
        if key not in props:
            props[key] = {
                "line": row.get("line"),
                "over_odds": row.get("over_odds"),
                "under_odds": row.get("under_odds"),
                "book": row.get("source", "unknown"),
            }
    log.info(f"Loaded prop lines for {len(props)} player-market combos")
    return props

def grade_projection(projection: dict, actual: dict, prop: Optional[dict]) -> dict:
    """Grade a single projection against actuals and the prop line."""
    projected_ks = projection.get("projection", 0)
    actual_ks = actual.get("actual_ks", 0)
    confidence = projection.get("confidence", 50)
    pick = {
        "game_pk": projection.get("game_pk"),
        "game_date": projection.get("game_date"),
        "mlbam_id": projection.get("mlbam_id"),
        "player_name": actual.get("pitcher_name", projection.get("player_name", "")),
        "stat_type": projection.get("stat_type", "pitcher_strikeouts"),
        "projection": round(float(projected_ks), 2),
        "actual_value": actual_ks,
        "confidence": confidence,
        "published": True,
        "graded_at": datetime.utcnow().isoformat(),
    }
    if prop and prop.get("line") is not None:
        line = float(prop["line"])
        pick["line"] = line
        pick["prop_book"] = prop.get("book", "unknown")
        if projected_ks > line + 0.5:
            pick["direction"] = "over"
        elif projected_ks < line - 0.5:
            pick["direction"] = "under"
        else:
            pick["direction"] = "push_zone"
        if pick["direction"] == "over":
            pick["result"] = "hit" if actual_ks > line else ("push" if actual_ks == line else "miss")
        elif pick["direction"] == "under":
            pick["result"] = "hit" if actual_ks < line else ("push" if actual_ks == line else "miss")
        else:
            pick["result"] = "no_play"
        line_error = abs(actual_ks - line)
        proj_error = abs(actual_ks - projected_ks)
        pick["edge"] = round(line_error - proj_error, 2)
        pick["proj_error"] = round(proj_error, 2)
    else:
        pick["line"] = None
        pick["direction"] = "no_line"
        pick["result"] = "ungraded"
        pick["edge"] = None
        pick["proj_error"] = round(abs(actual_ks - projected_ks), 2)
    return pick

def compute_accuracy_summary(all_picks: list) -> list:
    from collections import defaultdict
    buckets = defaultdict(list)
    for pick in all_picks:
        if pick.get("result") in ("hit", "miss", "push"):
            buckets["overall"].append(pick)
            stat_type = pick.get("stat_type", "unknown")
            buckets[stat_type].append(pick)
    summaries = []
    now = datetime.utcnow().isoformat()
    for bucket_name, picks in buckets.items():
        hits = sum(1 for p in picks if p["result"] == "hit")
        misses = sum(1 for p in picks if p["result"] == "miss")
        pushes = sum(1 for p in picks if p["result"] == "push")
        total = hits + misses
        edge_values = [p["edge"] for p in picks if p.get("edge") is not None]
        summary = {
            "stat_type": bucket_name,
            "period": "all_time",
            "total_picks": len(picks),
            "hits": hits,
            "misses": misses,
            "pushes": pushes,
            "hit_rate": round(hits / total * 100, 1) if total > 0 else 0,
            "avg_edge": round(sum(edge_values) / len(edge_values), 3) if edge_values else 0,
            "updated_at": now,
        }
        summaries.append(summary)
    return summaries

def export_dashboard_json(picks: list, summaries: list, date_str: str):
    dashboard_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dashboard", "data")
    os.makedirs(dashboard_dir, exist_ok=True)
    daily_file = os.path.join(dashboard_dir, f"picks_{date_str}.json")
    with open(daily_file, "w") as f:
        json.dump(picks, f, indent=2, default=str)
    log.info(f"Exported {len(picks)} picks to {daily_file}")
    summary_file = os.path.join(dashboard_dir, "accuracy_summary.json")
    with open(summary_file, "w") as f:
        json.dump(summaries, f, indent=2, default=str)
    log.info(f"Exported {len(summaries)} summary rows to {summary_file}")
    meta_file = os.path.join(dashboard_dir, "meta.json")
    with open(meta_file, "w") as f:
        json.dump({"last_graded_date": date_str, "last_updated": datetime.utcnow().isoformat(), "total_picks_graded": len(picks)}, f, indent=2)

def run_grading(date_str: str):
    log.info(f"=== Grading projections for {date_str} ===")
    game_pks = fetch_completed_games(date_str)
    if not game_pks:
        log.info("No completed games found. Exiting.")
        return
    all_actuals = []
    for gpk in game_pks:
        try:
            actuals = fetch_pitcher_actuals(gpk)
            all_actuals.extend(actuals)
        except Exception as e:
            log.warning(f"Failed to fetch box score for game {gpk}: {e}")
    log.info(f"Fetched actuals for {len(all_actuals)} pitcher appearances")
    actuals_index = {}
    for a in all_actuals:
        key = (a["game_pk"], a["pitcher_id"])
        actuals_index[key] = a
    projections = load_ungraded_projections(date_str)
    if not projections:
        log.info("No projections found for this date. Exiting.")
        return
    props = load_prop_lines(date_str)
    graded_picks = []
    for proj in projections:
        game_pk = proj.get("game_pk")
        mlbam_id = proj.get("mlbam_id")
        if not game_pk or not mlbam_id:
            log.warning(f"Projection missing game_pk or mlbam_id: {proj.get('player_name', 'unknown')}")
            continue
        actual = actuals_index.get((game_pk, mlbam_id))
        if not actual:
            log.warning(f"No actual found for pitcher {mlbam_id} ({proj.get('player_name', '')}) in game {game_pk}")
            continue
        stat_type = proj.get("stat_type", "pitcher_strikeouts")
        prop = props.get((mlbam_id, stat_type))
        pick = grade_projection(proj, actual, prop)
        graded_picks.append(pick)
    log.info(f"Graded {len(graded_picks)} picks")
    if not graded_picks:
        log.info("No picks to write. Exiting.")
        return
    hits = sum(1 for p in graded_picks if p.get("result") == "hit")
    misses = sum(1 for p in graded_picks if p.get("result") == "miss")
    no_play = sum(1 for p in graded_picks if p.get("result") in ("no_play", "ungraded"))
    log.info(f"Results: {hits} hits, {misses} misses, {no_play} no-play/ungraded")
    supabase_upsert("picks", graded_picks)
    all_historical = supabase_get("picks", {"result": "in.(hit,miss,push)", "select": "stat_type,result,edge,proj_error"})
    summaries = compute_accuracy_summary(all_historical)
    supabase_upsert("accuracy_summary", summaries)
    export_dashboard_json(graded_picks, summaries, date_str)
    log.info(f"=== Grading complete for {date_str} ===")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Grade Baseline MLB projections")
    parser.add_argument("--date", type=str, default=None, help="Date to grade (YYYY-MM-DD). Defaults to yesterday.")
    parser.add_argument("--backfill", type=int, default=None, help="Grade the last N days")
    args = parser.parse_args()
    validate_env()
    if args.backfill:
        for i in range(args.backfill, 0, -1):
            date = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
            try:
                run_grading(date)
            except Exception as e:
                log.error(f"Failed to grade {date}: {e}")
    else:
        date_str = args.date or (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
        run_grading(date_str)

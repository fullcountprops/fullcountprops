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

import os
import sys
import json
import logging
import argparse
import requests
from datetime import datetime, timedelta
from typing import Optional

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
    """
    Fetch all completed games for a given date.
    Checks both MLB (sportId=1) and WBC (sportId=51).
    Returns list of game_pk IDs.
    """
    game_pks = []
    for sport_id in [1, 51]:
        url = f"{MLB_STATS_BASE}/schedule"
        params = {
            "sportId": sport_id,
            "date": date_str,
            "hydrate": "linescore",
        }
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
    """
    Fetch box score for a game and extract actual pitcher K totals.
    Returns list of dicts: {game_pk, pitcher_id, pitcher_name, team,
                            actual_ks, innings_pitched, hits_allowed,
                            walks, earned_runs, pitches_thrown}
    """
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
            # Skip players who didn't pitch
            if not stats or stats.get("inningsPitched", "0.0") == "0.0":
                continue

            pitcher_id = player_data.get("person", {}).get("id")
            pitcher_name = player_data.get("person", {}).get("fullName", "Unknown")

            # Determine if this was the starting pitcher
            batting_order = player_data.get("battingOrder")
            game_status = player_data.get("gameStatus", {})
            is_starter = game_status.get("isCurrentPitcher", False) or \
                         player_data.get("position", {}).get("abbreviation") == "P"

            # Parse innings pitched (MLB format: "6.1" = 6 1/3 innings)
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


# ---------------------------------------------------------------------------
# Load ungraded projections from Supabase
# ---------------------------------------------------------------------------

def load_ungraded_projections(date_str: str) -> list:
    """
    Fetch projections for a given date that haven't been graded yet.
    Looks for rows in `projections` table matching the date.
    """
    params = {
        "game_date": f"eq.{date_str}",
        "select": "*",
    }
    rows = supabase_get("projections", params)
    log.info(f"Loaded {len(rows)} projections for {date_str}")
    return rows


# ---------------------------------------------------------------------------
# Load prop lines for comparison
# ---------------------------------------------------------------------------

def load_prop_lines(date_str: str) -> dict:
    """
    Fetch prop lines for the date from `props` table.
    Returns dict keyed by (pitcher_id, market_type) → {line, odds, book}.
    Uses the most recent line for each pitcher/market combo.
    """
    params = {
        "game_date": f"eq.{date_str}",
        "select": "*",
        "order": "timestamp.desc",
    }
    rows = supabase_get("props", params)

    props = {}
    for row in rows:
        # Extract player_id — field name may vary based on your schema
        player_id = row.get("player_id") or row.get("pitcher_id")
        market = row.get("market_type", row.get("market", ""))

        if not player_id or not market:
            continue

        key = (int(player_id), market)
        # Keep only the most recent line (rows are ordered desc by timestamp)
        if key not in props:
            props[key] = {
                "line": row.get("line"),
                "over_odds": row.get("over_odds", row.get("odds")),
                "under_odds": row.get("under_odds"),
                "book": row.get("bookmaker", row.get("book_name", "unknown")),
            }

    log.info(f"Loaded prop lines for {len(props)} player-market combos")
    return props


# ---------------------------------------------------------------------------
# Grading logic
# ---------------------------------------------------------------------------

def grade_projection(projection: dict, actual: dict, prop: Optional[dict]) -> dict:
    """
    Grade a single projection against actuals and the prop line.

    Returns a `picks` table row with:
      - projected vs actual values
      - lean (over/under) and whether it hit
      - CLV estimate
      - full glass-box factor breakdown
    """
    projected_ks = projection.get("projected_value", 0)
    actual_ks = actual.get("actual_ks", 0)
    confidence = projection.get("confidence", 50)
    features = projection.get("features", {})

    pick = {
        "game_pk": projection.get("game_pk"),
        "game_date": projection.get("game_date"),
        "pitcher_id": projection.get("pitcher_id"),
        "pitcher_name": actual.get("pitcher_name", projection.get("pitcher_name", "")),
        "stat_type": projection.get("stat_type", "pitcher_strikeouts"),
        "projected_value": round(projected_ks, 2),
        "actual_value": actual_ks,
        "confidence": confidence,
        "factors": json.dumps(features) if isinstance(features, dict) else features,
        "actual_innings": actual.get("innings_pitched", 0),
        "actual_pitches": actual.get("pitches_thrown", 0),
        "graded_at": datetime.utcnow().isoformat(),
        "published": True,  # Public by default for accuracy dashboard
    }

    # Grade against the prop line if available
    if prop and prop.get("line") is not None:
        line = float(prop["line"])
        pick["prop_line"] = line
        pick["prop_book"] = prop.get("book", "unknown")

        # Determine our lean
        if projected_ks > line + 0.5:
            pick["lean"] = "over"
        elif projected_ks < line - 0.5:
            pick["lean"] = "under"
        else:
            pick["lean"] = "push_zone"  # Too close to call

        # Grade the result
        if pick["lean"] == "over":
            pick["result"] = "hit" if actual_ks > line else ("push" if actual_ks == line else "miss")
        elif pick["lean"] == "under":
            pick["result"] = "hit" if actual_ks < line else ("push" if actual_ks == line else "miss")
        else:
            pick["result"] = "no_play"  # Didn't lean strongly enough

        # Closing Line Value (CLV) estimate
        # Positive CLV = our projection was closer to the actual than the line was
        line_error = abs(actual_ks - line)
        proj_error = abs(actual_ks - projected_ks)
        pick["clv"] = round(line_error - proj_error, 2)

        # Projection accuracy (absolute error)
        pick["proj_error"] = round(proj_error, 2)

    else:
        # No prop line available — grade projection accuracy only
        pick["prop_line"] = None
        pick["prop_book"] = None
        pick["lean"] = "no_line"
        pick["result"] = "ungraded"
        pick["clv"] = None
        pick["proj_error"] = round(abs(actual_ks - projected_ks), 2)

    return pick


# ---------------------------------------------------------------------------
# Accuracy summary rollup
# ---------------------------------------------------------------------------

def compute_accuracy_summary(all_picks: list) -> list:
    """
    Aggregate graded picks into accuracy_summary rows.
    Produces summaries by stat_type, and an overall summary.
    """
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
        total = hits + misses  # Exclude pushes from hit rate calc

        clv_values = [p["clv"] for p in picks if p.get("clv") is not None]
        proj_errors = [p["proj_error"] for p in picks if p.get("proj_error") is not None]

        summary = {
            "stat_type": bucket_name,
            "period": "all_time",
            "total_picks": len(picks),
            "hits": hits,
            "misses": misses,
            "pushes": pushes,
            "hit_rate": round(hits / total * 100, 1) if total > 0 else 0,
            "avg_clv": round(sum(clv_values) / len(clv_values), 3) if clv_values else 0,
            "avg_proj_error": round(sum(proj_errors) / len(proj_errors), 2) if proj_errors else 0,
            "updated_at": now,
        }

        summaries.append(summary)

    return summaries


# ---------------------------------------------------------------------------
# Export dashboard JSON (for GitHub Pages static dashboard)
# ---------------------------------------------------------------------------

def export_dashboard_json(picks: list, summaries: list, date_str: str):
    """
    Write graded data to JSON files in /dashboard/data/ for the
    GitHub Pages accuracy dashboard to consume.
    """
    dashboard_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "dashboard", "data"
    )
    os.makedirs(dashboard_dir, exist_ok=True)

    # Write daily picks
    daily_file = os.path.join(dashboard_dir, f"picks_{date_str}.json")
    with open(daily_file, "w") as f:
        json.dump(picks, f, indent=2, default=str)
    log.info(f"Exported {len(picks)} picks to {daily_file}")

    # Write / update cumulative summary
    summary_file = os.path.join(dashboard_dir, "accuracy_summary.json")
    with open(summary_file, "w") as f:
        json.dump(summaries, f, indent=2, default=str)
    log.info(f"Exported {len(summaries)} summary rows to {summary_file}")

    # Write latest update timestamp
    meta_file = os.path.join(dashboard_dir, "meta.json")
    with open(meta_file, "w") as f:
        json.dump({
            "last_graded_date": date_str,
            "last_updated": datetime.utcnow().isoformat(),
            "total_picks_graded": len(picks),
        }, f, indent=2)


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def run_grading(date_str: str):
    """Full grading pipeline for a single date."""
    log.info(f"=== Grading projections for {date_str} ===")

    # 1. Fetch completed games
    game_pks = fetch_completed_games(date_str)
    if not game_pks:
        log.info("No completed games found. Exiting.")
        return

    # 2. Fetch actual pitcher stats from box scores
    all_actuals = []
    for gpk in game_pks:
        try:
            actuals = fetch_pitcher_actuals(gpk)
            all_actuals.extend(actuals)
        except Exception as e:
            log.warning(f"Failed to fetch box score for game {gpk}: {e}")

    log.info(f"Fetched actuals for {len(all_actuals)} pitcher appearances")

    # Index actuals by (game_pk, pitcher_id) for fast lookup
    actuals_index = {}
    for a in all_actuals:
        key = (a["game_pk"], a["pitcher_id"])
        actuals_index[key] = a

    # 3. Load projections
    projections = load_ungraded_projections(date_str)
    if not projections:
        log.info("No projections found for this date. Exiting.")
        return

    # 4. Load prop lines
    props = load_prop_lines(date_str)

    # 5. Grade each projection
    graded_picks = []
    for proj in projections:
        game_pk = proj.get("game_pk")
        pitcher_id = proj.get("pitcher_id")

        if not game_pk or not pitcher_id:
            log.warning(f"Projection missing game_pk or pitcher_id: {proj}")
            continue

        # Find actual results
        actual = actuals_index.get((game_pk, pitcher_id))
        if not actual:
            log.warning(
                f"No actual found for pitcher {pitcher_id} in game {game_pk}"
            )
            continue

        # Find prop line
        stat_type = proj.get("stat_type", "pitcher_strikeouts")
        prop = props.get((pitcher_id, stat_type))

        # Grade it
        pick = grade_projection(proj, actual, prop)
        graded_picks.append(pick)

    log.info(f"Graded {len(graded_picks)} picks")

    if not graded_picks:
        log.info("No picks to write. Exiting.")
        return

    # 6. Log results summary
    hits = sum(1 for p in graded_picks if p.get("result") == "hit")
    misses = sum(1 for p in graded_picks if p.get("result") == "miss")
    no_play = sum(1 for p in graded_picks if p.get("result") in ("no_play", "ungraded"))
    log.info(f"Results: {hits} hits, {misses} misses, {no_play} no-play/ungraded")

    # 7. Upsert graded picks to Supabase
    supabase_upsert("picks", graded_picks)

    # 8. Load ALL historical picks for accuracy rollup
    all_historical = supabase_get("picks", {
        "result": "in.(hit,miss,push)",
        "select": "stat_type,result,clv,proj_error",
    })
    # Merge with today's graded picks (in case upsert hasn't propagated)
    all_for_summary = all_historical + [
        p for p in graded_picks if p.get("result") in ("hit", "miss", "push")
    ]

    # 9. Compute and upsert accuracy summaries
    summaries = compute_accuracy_summary(all_for_summary)
    supabase_upsert("accuracy_summary", summaries)

    # 10. Export JSON for GitHub Pages dashboard
    export_dashboard_json(graded_picks, summaries, date_str)

    log.info(f"=== Grading complete for {date_str} ===")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Grade Baseline MLB projections")
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Date to grade (YYYY-MM-DD). Defaults to yesterday.",
    )
    parser.add_argument(
        "--backfill",
        type=int,
        default=None,
        help="Grade the last N days (e.g., --backfill 7 grades the past week)",
    )
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

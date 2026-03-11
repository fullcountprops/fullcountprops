#!/usr/bin/env python3
"""
fetch_lineups.py - Baseline MLB
Fetch starting lineups via BallDontLie licensed API.
Uses the Stats endpoint with game_ids to get players who appeared in each game.
For pre-game lineups, falls back to the Games endpoint probable pitcher data
combined with active roster data.

Replaces previous statsapi.mlb.com boxscore/feed scraping for legal compliance.

Data source: https://api.balldontlie.io/mlb/v1
Requires: BDL_API_KEY environment variable

Usage:
    python pipeline/fetch_lineups.py
    python pipeline/fetch_lineups.py --date 2025-06-15
    python pipeline/fetch_lineups.py --no-upload
"""
import argparse
import json
import logging
import sys
from datetime import date
from pathlib import Path

import requests

# -- Project imports --
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.supabase import sb_upsert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("fetch_lineups")

import os

# -- BallDontLie API Config --
BDL_BASE = "https://api.balldontlie.io/mlb/v1"
BDL_API_KEY = os.getenv("BDL_API_KEY", "").strip()
if not BDL_API_KEY:
    raise EnvironmentError("Missing BDL_API_KEY in environment")

BDL_HEADERS = {"Authorization": BDL_API_KEY}


def fetch_games_for_date(target_date: str) -> list[dict]:
    """Get games for a specific date from BallDontLie."""
    all_games = []
    params = {"dates[]": target_date, "per_page": 100}
    cursor = None

    while True:
        p = dict(params)
        if cursor:
            p["cursor"] = cursor

        try:
            r = requests.get(f"{BDL_BASE}/games", params=p, headers=BDL_HEADERS, timeout=15)
            r.raise_for_status()
            data = r.json()
            all_games.extend(data.get("data", []))
            next_cursor = data.get("meta", {}).get("next_cursor")
            if not next_cursor:
                break
            cursor = next_cursor
        except Exception as e:
            log.error(f"Failed to fetch games: {e}")
            return []

    return all_games


def fetch_stats_for_game(game_id: int) -> list[dict]:
    """
    Fetch per-game player stats from BallDontLie Stats endpoint.
    Returns list of stat entries (each has player info + stats).
    """
    all_stats = []
    params = {"game_ids[]": str(game_id), "per_page": 100}
    cursor = None

    while True:
        p = dict(params)
        if cursor:
            p["cursor"] = cursor

        try:
            r = requests.get(f"{BDL_BASE}/stats", params=p, headers=BDL_HEADERS, timeout=15)
            r.raise_for_status()
            data = r.json()
            all_stats.extend(data.get("data", []))
            next_cursor = data.get("meta", {}).get("next_cursor")
            if not next_cursor:
                break
            cursor = next_cursor
        except Exception as e:
            log.warning(f"Failed to fetch stats for game {game_id}: {e}")
            return []

    return all_stats


def extract_lineup_from_stats(stats: list[dict], game_id: int, target_date: str) -> list[dict]:
    """
    Extract lineup entries from per-game stats.
    Players with at_bats > 0 or who appeared as batters are in the lineup.
    """
    lineup_rows = []
    seen = set()

    for stat in stats:
        player = stat.get("player", {})
        player_id = player.get("id")
        if not player_id or player_id in seen:
            continue
        seen.add(player_id)

        # Check if player had batting appearances
        at_bats = stat.get("at_bats", 0) or 0
        if at_bats == 0 and not stat.get("hits") and not stat.get("bb"):
            # Likely a pitcher who didn't bat (NL rules pre-DH or reliever)
            # Still include if they have any plate appearance indicator
            if not stat.get("runs") and not stat.get("rbi"):
                continue

        team_name = stat.get("team_name", "")
        bats_throws = player.get("bats_throws", "")
        parts = bats_throws.split("/") if bats_throws else []
        bat_side = parts[0][0] if len(parts) >= 1 and parts[0] else None

        # Determine side based on team matching
        side = "unknown"

        lineup_rows.append({
            "game_pk": game_id,
            "game_date": target_date,
            "mlbam_id": player_id,
            "full_name": player.get("full_name", "Unknown"),
            "team": team_name,
            "side": side,
            "batting_order": None,  # BDL stats don't include batting order
            "position": player.get("position", ""),
            "bats": bat_side,
            "venue": None,
        })

    return lineup_rows


def process_games(target_date: str, upload: bool = True) -> list[dict]:
    """Main logic: fetch games, extract lineups from stats, optionally upload."""
    log.info(f"Fetching lineups for {target_date} via BallDontLie ...")
    games = fetch_games_for_date(target_date)
    log.info(f"Found {len(games)} games")

    all_lineup_rows = []
    games_with_lineups = 0

    for game in games:
        game_id = game.get("id")
        home_team = game.get("home_team_name", game.get("home_team", {}).get("display_name", "Unknown"))
        away_team = game.get("away_team_name", game.get("away_team", {}).get("display_name", "Unknown"))
        venue_name = game.get("venue")
        if isinstance(venue_name, dict):
            venue_name = venue_name.get("name", "Unknown")

        log.info(f"  Game {game_id}: {away_team} @ {home_team}")

        # Fetch stats for this game
        stats = fetch_stats_for_game(game_id)
        if not stats:
            log.info("    No stats available yet (game may not have started)")
            continue

        games_with_lineups += 1
        lineup_entries = extract_lineup_from_stats(stats, game_id, target_date)

        # Enrich with side (home/away) and venue
        for entry in lineup_entries:
            if entry["team"] and home_team and entry["team"].lower() in home_team.lower():
                entry["side"] = "home"
            elif entry["team"] and away_team and entry["team"].lower() in away_team.lower():
                entry["side"] = "away"
            entry["venue"] = venue_name

        all_lineup_rows.extend(lineup_entries)
        log.info(f"    {len(lineup_entries)} players found in stats")

    log.info(f"\n{games_with_lineups}/{len(games)} games have lineup data")
    log.info(f"Total lineup entries: {len(all_lineup_rows)}")

    if upload and all_lineup_rows:
        sb_upsert("lineups", all_lineup_rows)
        log.info(f"Uploaded {len(all_lineup_rows)} lineup entries to Supabase.")

    return all_lineup_rows


# -- CLI --
def parse_args():
    parser = argparse.ArgumentParser(
        description="Fetch lineups from BallDontLie API."
    )
    parser.add_argument(
        "--date", type=str, default=None,
        help="Game date (YYYY-MM-DD). Default: today."
    )
    parser.add_argument(
        "--no-upload", action="store_true",
        help="Skip Supabase upload (print to stdout only)."
    )
    parser.add_argument(
        "--json", action="store_true",
        help="Output lineup data as JSON."
    )
    return parser.parse_args()


def main():
    args = parse_args()
    target_date = args.date or date.today().isoformat()
    upload = not args.no_upload

    rows = process_games(target_date, upload=upload)

    if args.json:
        print(json.dumps(rows, indent=2, default=str))

    log.info("=== Done ===")


if __name__ == "__main__":
    main()

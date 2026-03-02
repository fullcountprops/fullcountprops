"""
pipeline/fetch_lineups.py

Fetch confirmed or projected lineups for today's (or a specified) MLB games.

Uses the MLB Stats API schedule endpoint with lineups and probable pitchers hydration.
Falls back to probable pitchers from depth charts when confirmed lineups are unavailable.
Upserts results to the Supabase `lineups` table or logs to stdout.
"""

import argparse
import logging
import os
import time
from datetime import date
from typing import Optional

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
MLB_ROSTER_URL   = "https://statsapi.mlb.com/api/v1/teams/{team_id}/roster/depthChart"
SUPABASE_TABLE   = "lineups"

MAX_RETRIES    = 4
RETRY_BACKOFF  = [2, 5, 10, 20]  # seconds between retries


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def _supabase_headers() -> dict:
    """Return standard Supabase REST API request headers."""
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _supabase_url() -> str:
    """Return the Supabase REST API base URL."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    return f"{base}/rest/v1"


def upsert_lineups(records: list[dict]) -> None:
    """
    Upsert lineup records to the Supabase lineups table.

    Args:
        records: List of lineup dicts to upsert.
    """
    if not records:
        logger.warning("No lineup records to upsert.")
        return

    url = f"{_supabase_url()}/{SUPABASE_TABLE}"
    headers = _supabase_headers()

    resp = requests.post(url, headers=headers, json=records, timeout=30)
    if resp.status_code not in (200, 201):
        logger.error("Supabase upsert failed (%s): %s", resp.status_code, resp.text[:400])
    else:
        logger.info("Upserted %d lineup records to Supabase", len(records))


# ---------------------------------------------------------------------------
# HTTP helper with retry logic
# ---------------------------------------------------------------------------
def _get_with_retry(
    url: str,
    params: Optional[dict] = None,
    retries: int = MAX_RETRIES,
) -> Optional[dict]:
    """
    Perform an HTTP GET with exponential-ish backoff retry.

    Args:
        url:     Request URL.
        params:  Optional query parameters dict.
        retries: Maximum number of attempts.

    Returns:
        Parsed JSON response dict, or None on repeated failure.
    """
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning(
                "Request failed (attempt %d/%d): %s -- retrying in %ds",
                attempt + 1, retries, exc, wait,
            )
            time.sleep(wait)
    logger.error("All %d attempts failed for %s", retries, url)
    return None


# ---------------------------------------------------------------------------
# Lineup extraction helpers
# ---------------------------------------------------------------------------
def _extract_batting_order(team_data: dict) -> list[int]:
    """
    Extract an ordered list of MLBAM player IDs from a team's batting order.

    Args:
        team_data: Team dict from the schedule API 'teams' key.

    Returns:
        List of integer MLBAM IDs in batting-order position, empty if unavailable.
    """
    order = team_data.get("battingOrder", [])
    return [int(p["id"]) for p in order if isinstance(p, dict) and "id" in p]


def _extract_probable_pitcher(team_data: dict) -> Optional[int]:
    """
    Extract the probable pitcher's MLBAM ID from team data.

    Args:
        team_data: Team dict from the schedule API 'teams' key.

    Returns:
        Integer MLBAM ID of the probable pitcher, or None.
    """
    pp = team_data.get("probablePitcher")
    if pp and "id" in pp:
        return int(pp["id"])
    return None


def _fetch_depth_chart_order(team_id: int) -> list[int]:
    """
    Fetch a fallback batting order from the MLB depth chart for a given team.

    Returns the top 9 hitters listed in the position player section.

    Args:
        team_id: MLBAM team ID.

    Returns:
        List of up to 9 MLBAM player IDs, or empty list on failure.
    """
    url = MLB_ROSTER_URL.format(team_id=team_id)
    data = _get_with_retry(url)
    if not data:
        return []

    roster = data.get("roster", [])
    # Depth chart lists players in priority order; take non-pitchers first
    batters = [
        int(p["person"]["id"])
        for p in roster
        if isinstance(p, dict)
        and p.get("person", {}).get("id")
        and p.get("position", {}).get("type", "") != "Pitcher"
    ]
    return batters[:9]


def parse_game_lineups(game: dict) -> list[dict]:
    """
    Parse one game dict from the MLB schedule API into lineup records.

    Produces one record per team (home + away). Marks each record as confirmed
    if a batting order is present, otherwise falls back to depth chart.

    Args:
        game: A single game dict from the schedule API dates[].games[] array.

    Returns:
        List of lineup dicts (0, 1, or 2 records depending on data availability).
    """
    game_pk   = game.get("gamePk")
    game_date = game.get("gameDate", "")[:10]
    status    = game.get("status", {}).get("abstractGameState", "")

    teams = game.get("teams", {})
    records = []

    for side in ("home", "away"):
        team_data = teams.get(side, {})
        team_info = team_data.get("team", {})
        team_id   = team_info.get("id")
        team_abbr = team_info.get("abbreviation", "UNK")

        batting_order = _extract_batting_order(team_data)
        confirmed     = len(batting_order) > 0

        if not confirmed and team_id:
            logger.info(
                "No confirmed lineup for %s (game %s) -- falling back to depth chart",
                team_abbr, game_pk,
            )
            batting_order = _fetch_depth_chart_order(team_id)

        probable_pitcher_id = _extract_probable_pitcher(team_data)

        # Prepend probable pitcher to head of batting order list only if
        # it's not already included (pitchers don't bat in AL, but include for NL)
        if probable_pitcher_id and probable_pitcher_id not in batting_order:
            logger.debug("Probable pitcher %d not in batting order for %s", probable_pitcher_id, team_abbr)

        records.append(
            {
                "game_pk":            game_pk,
                "game_date":          game_date,
                "game_status":        status,
                "team_id":            team_id,
                "team_abbreviation":  team_abbr,
                "side":               side,
                "batting_order":      batting_order,          # list of MLBAM IDs
                "probable_pitcher_id": probable_pitcher_id,
                "confirmed":          confirmed,
                "lineup_size":        len(batting_order),
            }
        )

    return records


# ---------------------------------------------------------------------------
# Main fetch function
# ---------------------------------------------------------------------------
def fetch_lineups_for_date(target_date: str) -> list[dict]:
    """
    Fetch all lineup records for the given date string.

    Args:
        target_date: ISO date string (YYYY-MM-DD).

    Returns:
        List of lineup dicts for all games on that date.
    """
    params = {
        "date":    target_date,
        "sportId": 1,
        "hydrate": "lineups,probablePitchers,team",
    }

    logger.info("Fetching schedule for %s...", target_date)
    data = _get_with_retry(MLB_SCHEDULE_URL, params=params)

    if not data:
        logger.error("Failed to retrieve schedule from MLB Stats API.")
        return []

    total_games = data.get("totalGames", 0)
    logger.info("MLB schedule shows %d game(s) on %s", total_games, target_date)

    if total_games == 0:
        logger.info("No games scheduled for %s.", target_date)
        return []

    all_records: list[dict] = []
    for date_block in data.get("dates", []):
        for game in date_block.get("games", []):
            try:
                records = parse_game_lineups(game)
                all_records.extend(records)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Error parsing game %s: %s", game.get("gamePk"), exc)

    logger.info("Collected %d lineup records for %d games", len(all_records), total_games)
    return all_records


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def main() -> None:
    """CLI entry point: fetch lineups and optionally upsert to Supabase."""
    parser = argparse.ArgumentParser(
        description="Fetch MLB lineup data for BaselineMLB Monte Carlo simulator."
    )
    parser.add_argument(
        "--date",
        default=date.today().strftime("%Y-%m-%d"),
        help="Date to fetch lineups for (YYYY-MM-DD, default: today)",
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Upsert lineup records to Supabase lineups table",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Print lineup records to stdout (JSON-like)",
    )
    args = parser.parse_args()

    records = fetch_lineups_for_date(args.date)

    if not records:
        logger.warning("No lineup records retrieved for %s.", args.date)
        return

    if args.stdout:
        for rec in records:
            logger.info(
                "game_pk=%-6s  team=%-3s  side=%-4s  confirmed=%-5s  lineup_size=%d  probable_pitcher=%s",
                rec["game_pk"],
                rec["team_abbreviation"],
                rec["side"],
                rec["confirmed"],
                rec["lineup_size"],
                rec["probable_pitcher_id"],
            )

    if args.upload:
        if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
            logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY env vars must be set for --upload.")
            return
        upsert_lineups(records)
    elif not args.stdout:
        # Default: just print a summary
        confirmed_count = sum(1 for r in records if r["confirmed"])
        logger.info(
            "Fetched %d lineup records (%d confirmed). Use --upload to push to Supabase.",
            len(records),
            confirmed_count,
        )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
pipeline_health_check.py — FullCountProps
Verifies that today's projections were generated and are fresh.

Checks:
  1. SUPABASE_URL and SUPABASE_SERVICE_KEY are set
  2. The projections table has rows for today's date (ET)
  3. The most recently updated row is within the last 6 hours

Exit codes:
  0 — healthy
  1 — unhealthy (missing projections or stale data)
  2 — configuration error (missing env vars)

Dependencies: requests (standard in requirements.txt), standard library only.

Usage:
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python scripts/pipeline_health_check.py
"""

import logging
import os
import sys
from datetime import datetime, timedelta, timezone

import requests

# ---------------------------------------------------------------------------
# Config & logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("pipeline_health_check")

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
STALE_THRESHOLD_HOURS = 6


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def supabase_headers() -> dict:
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def get_today_et() -> str:
    """Return today's date in ET as YYYY-MM-DD (uses UTC-5 as a safe offset)."""
    now_et = datetime.now(timezone.utc) + timedelta(hours=-5)
    return now_et.strftime("%Y-%m-%d")


def check_projections(game_date: str) -> dict:
    """
    Query Supabase REST API for projections on the given date.
    Returns {'count': int, 'last_updated': str | None}.
    """
    url = f"{SUPABASE_URL}/rest/v1/projections"
    params = {
        "game_date": f"eq.{game_date}",
        "select": "updated_at",
        "order": "updated_at.desc",
        "limit": "1",
    }
    headers = {**supabase_headers(), "Prefer": "count=exact"}

    resp = requests.get(url, params=params, headers=headers, timeout=15)
    resp.raise_for_status()

    data = resp.json()

    # Total row count comes from the Content-Range header: "0-0/42" → 42
    total = 0
    content_range = resp.headers.get("Content-Range", "")
    if "/" in content_range:
        try:
            total = int(content_range.split("/")[1])
        except (ValueError, IndexError):
            total = len(data)
    else:
        total = len(data)

    last_updated = data[0]["updated_at"] if data else None
    return {"count": total, "last_updated": last_updated}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    # Validate env vars
    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_SERVICE_KEY", SUPABASE_SERVICE_KEY),
        ]
        if not val
    ]
    if missing:
        log.error("Missing required environment variables: %s", ", ".join(missing))
        return 2

    game_date = get_today_et()
    log.info("Running pipeline health check for %s", game_date)

    try:
        result = check_projections(game_date)
    except requests.RequestException as exc:
        log.error("Failed to query Supabase: %s", exc)
        return 1

    count = result["count"]
    last_updated = result["last_updated"]

    log.info("Projections found for %s: %d rows", game_date, count)

    if count == 0:
        log.error(
            "FAIL: No projections found for %s. Pipeline may not have run.",
            game_date,
        )
        return 1

    if last_updated is None:
        log.error("FAIL: Could not determine last update time.")
        return 1

    # Parse updated_at timestamp
    try:
        updated_at = datetime.fromisoformat(last_updated.replace("Z", "+00:00"))
    except ValueError as exc:
        log.error(
            "FAIL: Could not parse updated_at timestamp '%s': %s", last_updated, exc
        )
        return 1

    age_hours = (datetime.now(timezone.utc) - updated_at).total_seconds() / 3600

    if age_hours > STALE_THRESHOLD_HOURS:
        log.error(
            "FAIL: Projections are stale — last updated %.1f hours ago "
            "(threshold: %d hours). Last updated at: %s",
            age_hours,
            STALE_THRESHOLD_HOURS,
            last_updated,
        )
        return 1

    log.info(
        "OK: %d projections for %s, last updated %.1f hours ago.",
        count,
        game_date,
        age_hours,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

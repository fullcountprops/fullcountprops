"""
compute_rolling_stats.py — Compute 14-day weighted rolling K/9 for pitchers.

Reads recent Statcast pitch data from Supabase, computes recency-weighted
rolling K/9 rates, and saves results to data/rolling_stats.json.

Extracted from inline Python in morning_data_refresh.yml (Cycle #4).

Usage:
    python pipeline/compute_rolling_stats.py
"""

import json
import logging
import os
import sys
from collections import defaultdict
from datetime import date, timedelta

import requests

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("rolling_stats")


def _get_supabase_headers():
    """Build Supabase REST API headers from environment variables."""
    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get("SUPABASE_PROJECT_URL", "")
    sb_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if not sb_url or not sb_key:
        log.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
        sys.exit(1)
    headers = {
        "apikey": sb_key,
        "Authorization": f"Bearer {sb_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }
    return sb_url, headers


def compute_rolling_stats(lookback_days=14):
    """Compute pitcher rolling K/9 with recency weighting.

    Args:
        lookback_days: Number of days to look back for Statcast data.

    Returns:
        List of dicts with rolling stats for each pitcher.
    """
    sb_url, headers = _get_supabase_headers()
    today = date.today()
    cutoff = (today - timedelta(days=lookback_days)).isoformat()

    log.info("Computing pitcher rolling K/9 (%d-day weighted)...", lookback_days)
    resp = requests.get(
        f"{sb_url}/rest/v1/statcast_pitches",
        headers=headers,
        params={
            "game_date": f"gte.{cutoff}",
            "select": "pitcher_id,game_date,description",
            "limit": 100000,
        },
        timeout=60,
    )
    if not resp.ok:
        log.error("Failed to fetch Statcast: %s", resp.status_code)
        sys.exit(1)

    pitches = resp.json()
    log.info("Loaded %d pitches from last %d days", len(pitches), lookback_days)

    pitcher_data = defaultdict(
        lambda: defaultdict(lambda: {"pitches": 0, "ks": 0, "outs": 0})
    )
    for p in pitches:
        pid = p.get("pitcher_id")
        gdate = p.get("game_date")
        desc = p.get("description", "")
        if not pid or not gdate:
            continue
        pitcher_data[pid][gdate]["pitches"] += 1
        if "strikeout" in desc.lower() or "strike_three" in desc.lower():
            pitcher_data[pid][gdate]["ks"] += 1
        if any(
            x in desc.lower()
            for x in ["out", "strikeout", "field", "ground", "fly", "pop", "line"]
        ):
            pitcher_data[pid][gdate]["outs"] += 1

    rolling_rows = []
    for pid, games in pitcher_data.items():
        total_k = 0.0
        total_ip = 0.0
        for gdate, stats in sorted(games.items(), reverse=True):
            days_ago = (today - date.fromisoformat(gdate)).days
            weight = max(0.5, 1.0 - (days_ago / 28.0))
            total_k += stats["ks"] * weight
            total_ip += (stats["outs"] / 3.0) * weight
        if total_ip >= 3.0:
            rolling_rows.append(
                {
                    "mlbam_id": pid,
                    "stat_type": "rolling_k9_14d",
                    "value": round((total_k / total_ip) * 9, 2),
                    "sample_games": len(games),
                    "computed_date": today.isoformat(),
                }
            )

    log.info("Computed rolling K/9 for %d pitchers", len(rolling_rows))
    return rolling_rows


def main():
    """Run rolling stats computation and save to JSON."""
    rolling_rows = compute_rolling_stats()
    os.makedirs("data", exist_ok=True)
    with open("data/rolling_stats.json", "w") as f:
        json.dump(rolling_rows, f, indent=2, default=str)
    log.info("Rolling stats saved to data/rolling_stats.json")


if __name__ == "__main__":
    main()

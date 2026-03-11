#!/usr/bin/env python3
"""
fetch_players.py - Baseline MLB
Fetch active MLB players via BallDontLie licensed API.
Replaces previous statsapi.mlb.com roster scraping for legal compliance.

Data source: https://api.balldontlie.io/mlb/v1/players/active
Requires: BDL_API_KEY environment variable
"""
import os

import requests
from supabase import Client, create_client

# -- Clients --
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

if not all([SUPABASE_URL, SUPABASE_KEY]):
    raise EnvironmentError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -- BallDontLie API Config --
BDL_BASE = "https://api.balldontlie.io/mlb/v1"
BDL_API_KEY = os.getenv("BDL_API_KEY", "").strip()
if not BDL_API_KEY:
    raise EnvironmentError("Missing BDL_API_KEY in environment")

BDL_HEADERS = {"Authorization": BDL_API_KEY}

# Positions we care about for prop betting
PROP_POSITIONS = {
    "Starting Pitcher", "Relief Pitcher", "Pitcher",
    "Catcher",
    "First Baseman", "Second Baseman", "Third Baseman", "Shortstop",
    "Left Fielder", "Center Fielder", "Right Fielder",
    "Designated Hitter", "Outfielder", "Infielder",
}

# Short-code mapping for Supabase schema compatibility
POSITION_ABBREV = {
    "Starting Pitcher": "SP", "Relief Pitcher": "RP", "Pitcher": "P",
    "Catcher": "C",
    "First Baseman": "1B", "Second Baseman": "2B",
    "Third Baseman": "3B", "Shortstop": "SS",
    "Left Fielder": "LF", "Center Fielder": "CF",
    "Right Fielder": "RF", "Designated Hitter": "DH",
    "Outfielder": "OF", "Infielder": "IF",
}


def fetch_active_players() -> list[dict]:
    """
    Pull all active MLB players from BallDontLie API.
    Handles pagination automatically.
    """
    all_players = []
    cursor = None

    while True:
        params = {"per_page": 100}
        if cursor:
            params["cursor"] = cursor

        r = requests.get(
            f"{BDL_BASE}/players/active",
            params=params,
            headers=BDL_HEADERS,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        all_players.extend(data.get("data", []))

        next_cursor = data.get("meta", {}).get("next_cursor")
        if not next_cursor:
            break
        cursor = next_cursor

    return all_players


def parse_player(player: dict) -> dict | None:
    """
    Map a BallDontLie player object to our players table schema.
    Returns None if id is missing or position is not prop-relevant.
    """
    player_id = player.get("id")
    if not player_id:
        return None

    full_name = player.get("full_name", "Unknown")
    position = player.get("position", "")
    team_obj = player.get("team", {})
    team_name = team_obj.get("display_name", "") if team_obj else ""

    # Filter to prop-relevant positions
    if position and position not in PROP_POSITIONS:
        return None

    pos_abbrev = POSITION_ABBREV.get(position, position)

    # BDL provides bats_throws as "Right/Right" format
    bats_throws = player.get("bats_throws", "")
    parts = bats_throws.split("/") if bats_throws else []
    bat_side = parts[0][0] if len(parts) >= 1 and parts[0] else None  # R, L, S
    pitch_hand = parts[1][0] if len(parts) >= 2 and parts[1] else None

    return {
        "mlbam_id": player_id,
        "full_name": full_name,
        "team": team_name,
        "position": pos_abbrev or None,
        "bats": bat_side,
        "throws": pitch_hand,
        "active": True,
    }


def upsert_players(rows: list[dict]) -> None:
    """Upsert player rows; conflict key is mlbam_id."""
    if not rows:
        print("  No player rows to upsert.")
        return
    for i in range(0, len(rows), 200):
        batch = rows[i : i + 200]
        supabase.table("players").upsert(batch, on_conflict="mlbam_id").execute()
    print(f"  Upserted {len(rows)} player rows.")


def main():
    print("Fetching MLB active players via BallDontLie ...")
    raw = fetch_active_players()
    print(f"  Total players returned: {len(raw)}")

    rows = [r for p in raw if (r := parse_player(p)) is not None]
    print(f"  Parsed {len(rows)} prop-relevant players.")

    upsert_players(rows)
    print("Done.")


if __name__ == "__main__":
    main()

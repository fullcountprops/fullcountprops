#!/usr/bin/env python3
"""
fetch_games.py - FullCountProps
Fetch MLB game schedule via BallDontLie licensed API.
Replaces previous statsapi.mlb.com integration for legal compliance.

Data source: https://api.balldontlie.io/mlb/v1/games
Requires: BDL_API_KEY environment variable
"""
import os
from datetime import date, timedelta

import requests
from supabase import Client, create_client

# -- Clients --
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

if not SUPABASE_URL.startswith("https://") or not SUPABASE_URL.endswith(".supabase.co"):
    raise RuntimeError(f"Invalid SUPABASE_URL (length={len(SUPABASE_URL)}, repr={repr(SUPABASE_URL[:30])})")

if not all([SUPABASE_URL, SUPABASE_KEY]):
    raise EnvironmentError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# -- BallDontLie API Config --
BDL_BASE = "https://api.balldontlie.io/mlb/v1"
BDL_API_KEY = os.getenv("BDL_API_KEY", "").strip()
if not BDL_API_KEY:
    raise EnvironmentError("Missing BDL_API_KEY in environment")

BDL_HEADERS = {"Authorization": BDL_API_KEY}


def fetch_schedule(target_date: date, days_ahead: int = 6) -> list[dict]:
    """
    Pull the game schedule from BallDontLie for a date window.
    Default: today through the next 6 days (a full week).
    Returns a flat list of game dicts.
    """
    all_games = []
    dates = []
    for i in range(days_ahead + 1):
        d = target_date + timedelta(days=i)
        dates.append(d.strftime("%Y-%m-%d"))

    # BDL games endpoint accepts dates[] array
    params = [("dates[]", d) for d in dates]
    params.append(("per_page", "100"))

    cursor = None
    while True:
        page_params = list(params)
        if cursor:
            page_params.append(("cursor", str(cursor)))

        r = requests.get(
            f"{BDL_BASE}/games",
            params=page_params,
            headers=BDL_HEADERS,
            timeout=15,
        )
        r.raise_for_status()
        data = r.json()
        all_games.extend(data.get("data", []))

        next_cursor = data.get("meta", {}).get("next_cursor")
        if not next_cursor:
            break
        cursor = next_cursor

    return all_games


def parse_game(game: dict) -> dict | None:
    """
    Map a BallDontLie game object to our games table schema.
    Returns None if the game is missing essential fields.
    """
    game_id = game.get("id")
    if not game_id:
        return None

    game_date_str = game.get("date", "")[:10]
    home_team_obj = game.get("home_team", {})
    away_team_obj = game.get("away_team", {})

    home_team = home_team_obj.get("display_name", "Unknown")
    away_team = away_team_obj.get("display_name", "Unknown")

    # BDL game data fields
    home_data = game.get("home_team_data", {})
    away_data = game.get("away_team_data", {})
    venue = game.get("venue", {}).get("name") if isinstance(game.get("venue"), dict) else game.get("venue")
    status = game.get("status")

    home_score = home_data.get("runs") if home_data else None
    away_score = away_data.get("runs") if away_data else None

    # Probable pitchers from BDL
    home_pp = game.get("home_pitcher", {})
    away_pp = game.get("away_pitcher", {})

    home_probable_pitcher_id = home_pp.get("id") if home_pp else None
    home_probable_pitcher_name = home_pp.get("full_name") if home_pp else None
    away_probable_pitcher_id = away_pp.get("id") if away_pp else None
    away_probable_pitcher_name = away_pp.get("full_name") if away_pp else None

    # Game time
    game_time_raw = game.get("date", "")
    game_time = game_time_raw[11:16] if len(game_time_raw) >= 16 else None

    return {
        "game_pk": game_id,
        "game_date": game_date_str,
        "home_team": home_team,
        "away_team": away_team,
        "venue": venue,
        "status": status,
        "home_score": home_score,
        "away_score": away_score,
        "home_probable_pitcher_id": home_probable_pitcher_id,
        "home_probable_pitcher": home_probable_pitcher_name,
        "away_probable_pitcher_id": away_probable_pitcher_id,
        "away_probable_pitcher": away_probable_pitcher_name,
        "game_time": game_time,
    }


def upsert_games(rows: list[dict]) -> None:
    """Upsert game rows into Supabase; conflict key is game_pk."""
    if not rows:
        print("  No game rows to upsert.")
        return
    for i in range(0, len(rows), 200):
        batch = rows[i : i + 200]
        supabase.table("games").upsert(batch, on_conflict="game_pk").execute()
    print(f"  Upserted {len(rows)} game rows.")


def main(days_ahead: int = 6):
    today = date.today()
    print(f"Fetching MLB schedule via BallDontLie: {today} through {today + timedelta(days=days_ahead)} ...")
    raw_games = fetch_schedule(today, days_ahead=days_ahead)
    print(f"  API returned {len(raw_games)} raw games.")

    rows = [r for g in raw_games if (r := parse_game(g)) is not None]
    print(f"  Parsed {len(rows)} valid game rows.")

    with_pitchers = sum(
        1 for r in rows
        if r.get("home_probable_pitcher_id") or r.get("away_probable_pitcher_id")
    )
    print(f"  {with_pitchers} games have at least one probable pitcher announced.")

    upsert_games(rows)
    print("Done.")


if __name__ == "__main__":
    main()

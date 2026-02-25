import os
import requests
from datetime import date
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# ── Clients ──────────────────────────────────────────────────────────────────
ODDS_API_KEY = os.getenv("ODDS_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Config ────────────────────────────────────────────────────────────────────
SPORT     = "baseball_mlb"
REGIONS   = "us"
MARKETS   = "batter_hits,batter_home_runs,batter_rbis,batter_strikeouts,pitcher_strikeouts,pitcher_hits_allowed"
ODDS_FMT  = "american"
BASE_URL  = "https://api.the-odds-api.com/v4"


def fetch_events() -> list[dict]:
    """Return today's MLB event IDs from The Odds API."""
    url = f"{BASE_URL}/sports/{SPORT}/events"
    r = requests.get(url, params={"apiKey": ODDS_API_KEY, "dateFormat": "iso"})
    r.raise_for_status()
    return r.json()


def fetch_player_props(event_id: str) -> list[dict]:
    """Fetch all player prop markets for a single event."""
    url = f"{BASE_URL}/sports/{SPORT}/events/{event_id}/odds"
    r = requests.get(
        url,
        params={
            "apiKey":  ODDS_API_KEY,
            "regions": REGIONS,
            "markets": MARKETS,
            "oddsFormat": ODDS_FMT,
        },
    )
    r.raise_for_status()
    return r.json()


def parse_props(event_data: dict) -> list[dict]:
    """Flatten bookmaker/market/outcome structure into rows."""
    rows = []
    event_id   = event_data.get("id")
    home_team  = event_data.get("home_team")
    away_team  = event_data.get("away_team")
    commence   = event_data.get("commence_time")

    for bm in event_data.get("bookmakers", []):
        book = bm["key"]
        for market in bm.get("markets", []):
            market_key = market["key"]
            for outcome in market.get("outcomes", []):
                rows.append(
                    {
                        "event_id":    event_id,
                        "game_date":   str(date.today()),
                        "home_team":   home_team,
                        "away_team":   away_team,
                        "commence_time": commence,
                        "bookmaker":   book,
                        "market":      market_key,
                        "player_name": outcome.get("description"),
                        "label":       outcome["name"],   # Over / Under
                        "line":        outcome.get("point"),
                        "odds":        outcome["price"],
                    }
                )
    return rows


def upsert_props(rows: list[dict]) -> None:
    """Insert prop rows into Supabase, ignore duplicates."""
    if not rows:
        return
    # Upsert in batches of 500
    for i in range(0, len(rows), 500):
        batch = rows[i : i + 500]
        supabase.table("props").upsert(batch).execute()
    print(f"  Upserted {len(rows)} prop rows.")


def main():
    print(f"Fetching MLB props for {date.today()} ...")
    events = fetch_events()
    print(f"  Found {len(events)} games.")

    all_rows = []
    for event in events:
        try:
            data = fetch_player_props(event["id"])
            rows = parse_props(data)
            all_rows.extend(rows)
            print(f"  {event['home_team']} vs {event['away_team']}: {len(rows)} prop rows")
        except Exception as e:
            print(f"  ERROR on event {event['id']}: {e}")

    upsert_props(all_rows)
    print("Done.")


if __name__ == "__main__":
    main()
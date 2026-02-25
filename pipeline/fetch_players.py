import os
import requests
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

# ── Clients ───────────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not all([SUPABASE_URL, SUPABASE_KEY]):
    raise EnvironmentError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ── Config ───────────────────────────────────────────────────────────────────
BASE_URL = "https://statsapi.mlb.com/api/v1"
SPORT_ID = 1   # MLB

# Positions we care about for prop betting
PROP_POSITIONS = {
    "P", "SP", "RP",        # pitchers
    "C",                    # catchers (framing)
    "1B", "2B", "3B", "SS", # infield
    "LF", "CF", "RF",       # outfield
    "DH",                   # designated hitter
    "OF", "IF",             # generic
}


def fetch_active_rosters() -> list[dict]:
    """
    Pull the active 40-man roster for every MLB team.
    Returns a flat list of player dicts from the Stats API.
    """
    # Get all MLB teams first
    teams_url = f"{BASE_URL}/teams"
    r = requests.get(teams_url, params={"sportId": SPORT_ID}, timeout=15)
    r.raise_for_status()
    teams = r.json().get("teams", [])
    print(f"  Found {len(teams)} MLB teams.")

    all_players = []
    for team in teams:
        team_id   = team["id"]
        team_name = team["name"]
        roster_url = f"{BASE_URL}/teams/{team_id}/roster"
        try:
            rr = requests.get(
                roster_url,
                params={"rosterType": "40Man"},
                timeout=15,
            )
            rr.raise_for_status()
            roster = rr.json().get("roster", [])
            for entry in roster:
                entry["_team_name"] = team_name
            all_players.extend(roster)
        except Exception as e:
            print(f"  WARNING: Could not fetch roster for {team_name}: {e}")

    return all_players


def parse_player(entry: dict) -> dict | None:
    """
    Map a roster entry to our players table schema.
    Returns None if mlbam_id is missing.
    """
    person = entry.get("person", {})
    mlbam_id = person.get("id")
    if not mlbam_id:
        return None

    full_name = person.get("fullName", "Unknown")
    team      = entry.get("_team_name", "")
    pos_obj   = entry.get("position", {})
    position  = pos_obj.get("abbreviation", pos_obj.get("name", ""))

    # Skip non-prop-relevant positions (e.g. two-way, coach rows)
    # Allow through if position is blank (Stats API sometimes omits it)
    if position and position not in PROP_POSITIONS:
        return None

    # Bat/throw hand — available on deeper hydration, gracefully default
    bat_side   = person.get("batSide",   {}).get("code")
    pitch_hand = person.get("pitchHand", {}).get("code")

    return {
        "mlbam_id":  mlbam_id,
        "full_name": full_name,
        "team":      team,
        "position":  position or None,
        "bats":      bat_side,
        "throws":    pitch_hand,
        "active":    True,
    }


def fetch_player_detail(mlbam_id: int) -> dict:
    """
    Fetch full bio for a single player to get bat/throw hand.
    Only called if the roster entry lacks that data.
    """
    url = f"{BASE_URL}/people/{mlbam_id}"
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    people = r.json().get("people", [])
    return people[0] if people else {}


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
    print("Fetching MLB active rosters ...")
    raw = fetch_active_rosters()
    print(f"  Total roster entries: {len(raw)}")

    rows = [r for entry in raw if (r := parse_player(entry)) is not None]
    print(f"  Parsed {len(rows)} prop-relevant players.")

    upsert_players(rows)
    print("Done.")


if __name__ == "__main__":
    main()

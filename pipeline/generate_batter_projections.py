#!/usr/bin/env python3
"""
generate_batter_projections.py -- FullCountProps
Glass-box multi-stat batter projection engine v3.0.

Model factors (v3.0):
  1. Career per-PA rates, blended with league average (early-season ramp-up)
  2. Platoon split adjustments (L/R matchups)
  3. Park factors (stat-specific)
  4. Likely starter filtering (position players only, no bench/bullpen)

Supported stat types (v3.0):
  - batter_total_bases: TB = 1B + 2x2B + 3x3B + 4xHR
  - batter_hits: H per game
  - batter_home_runs: HR per game
  - batter_rbis: RBI per game
  - batter_walks: BB per game
  - batter_strikeouts: K per game
  - batter_runs: R per game
"""
import json
import logging
import os
from datetime import date

import requests

# from dotenv import load_dotenv  # DISABLED - GitHub Actions provides env vars

# load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("generate_batter_projections")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()

# Fail fast with a clear error instead of cryptic HTTP 400
if not SUPABASE_URL.startswith("https://") or not SUPABASE_URL.endswith(".supabase.co"):
    raise RuntimeError(f"Invalid SUPABASE_URL (length={len(SUPABASE_URL)}, repr={repr(SUPABASE_URL[:30])})")

SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
MODEL_VERSION = "v3.0-glass-box-multi"

# Early-season ramp-up constants
MLB_AVG_TB_PA = 0.135  # League average (~.400 SLG / 3 PA per AB)
RAMP_UP_GAMES = 30     # Games until full career rate is trusted

# MLB average per-PA rates for each stat type (2024 MLB averages)
MLB_AVG_RATES = {
    "tb_per_pa": 0.135,
    "h_per_pa": 0.230,    # ~.250 BA * ~0.92 AB/PA
    "hr_per_pa": 0.030,   # ~3% HR/PA
    "rbi_per_pa": 0.095,  # ~0.095 RBI/PA
    "bb_per_pa": 0.085,   # ~8.5% BB rate
    "k_per_pa": 0.224,    # ~22.4% K rate
    "r_per_pa": 0.090,    # ~0.09 R/PA
}

# Platoon split multipliers (based on MLB historical splits)
# These represent the TB/PA boost or penalty for same/opposite hand matchups
PLATOON_SPLITS = {
    # Batter vs Pitcher hand -> TB/PA multiplier
    ("L", "R"): 1.06,   # LHB vs RHP: slight advantage (see more RHP, comfortable)
    ("L", "L"): 0.88,   # LHB vs LHP: significant disadvantage (same-side)
    ("R", "L"): 1.08,   # RHB vs LHP: significant advantage (opposite-side)
    ("R", "R"): 0.96,   # RHB vs RHP: slight disadvantage (same-side, but more familiar)
    ("S", "R"): 1.03,   # Switch-hitter vs RHP: slight advantage (bats left)
    ("S", "L"): 1.05,   # Switch-hitter vs LHP: advantage (bats right vs lefty)
}

# Positions that are likely starters (excludes pure relievers and some utility)
STARTER_POSITIONS = {"C", "1B", "2B", "3B", "SS", "LF", "CF", "RF", "DH", "OF", "IF"}

# Park TB factors (% adjustment for total bases)
PARK_TB_FACTORS = {
    "Coors Field": 12,
    "Great American Ball Park": 8,
    "Yankee Stadium": 5,
    "Fenway Park": 4,
    "Citizens Bank Park": 3,
    "Chase Field": 2,
    "Globe Life Field": 2,
    "Minute Maid Park": 1,
    "Truist Park": 0,
    "Guaranteed Rate Field": 0,
    "Angel Stadium": 0,
    "Wrigley Field": -1,
    "PNC Park": -2,
    "loanDepot park": -3,
    "Oracle Park": -5,
    "T-Mobile Park": -5,
    "Petco Park": -6,
    "Dodger Stadium": -2,
    "Busch Stadium": -1,
}

# Park HR factors (% adjustment for home runs)
PARK_HR_FACTORS = {
    "Coors Field": 15,
    "Great American Ball Park": 12,
    "Yankee Stadium": 10,
    "Citizens Bank Park": 8,
    "Fenway Park": 5,
    "Wrigley Field": 3,
    "Chase Field": 2,
    "Globe Life Field": 2,
    "Minute Maid Park": 1,
    "Truist Park": 0,
    "Guaranteed Rate Field": 0,
    "Angel Stadium": -1,
    "Dodger Stadium": -2,
    "PNC Park": -3,
    "Busch Stadium": -3,
    "loanDepot park": -5,
    "T-Mobile Park": -6,
    "Oracle Park": -8,
    "Petco Park": -8,
}

# Park K factors for batters (% adjustment — positive = more Ks, negative = fewer)
PARK_BATTER_K_FACTORS = {
    "Oracle Park": 3,
    "T-Mobile Park": 2,
    "Petco Park": 2,
    "Coors Field": -5,       # Coors thinner air = fewer Ks
    "Fenway Park": -2,
    "Yankee Stadium": -1,
    "Great American Ball Park": -2,
}


def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def sb_get(table, params):
    r = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=sb_headers(), params=params)
    r.raise_for_status()
    return r.json()


def sb_upsert(table, rows):
    if not rows:
        log.info(f"  No rows to upsert into {table}")
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    for i in range(0, len(rows), 500):
        batch = rows[i : i + 500]
        r = requests.post(url, headers=sb_headers(), json=batch)
        if not r.ok:
            log.warning(f"  Upsert failed: {r.status_code} {r.text[:200]}")
        else:
            log.info(f"  Upserted {len(batch)} rows into {table}")


def fetch_batter_career_rates(mlbam_id):
    """
    Fetch career per-PA rates for all stat types from MLB Stats API.
    Returns dict with keys: tb_per_pa, h_per_pa, hr_per_pa, rbi_per_pa,
    bb_per_pa, k_per_pa, r_per_pa, career_pa.
    Falls back to MLB averages for missing data.
    """
    rates = dict(MLB_AVG_RATES)
    rates["career_pa"] = 0
    try:
        url = f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}/stats"
        r = requests.get(url, params={"stats": "career", "group": "hitting", "sportId": 1}, timeout=10)
        r.raise_for_status()
        splits = r.json().get("stats", [{}])[0].get("splits", [])
        if splits:
            stat = splits[0].get("stat", {})
            pa = int(stat.get("plateAppearances", 0))
            if pa > 0:
                hits = int(stat.get("hits", 0))
                doubles = int(stat.get("doubles", 0))
                triples = int(stat.get("triples", 0))
                hrs = int(stat.get("homeRuns", 0))
                singles = hits - doubles - triples - hrs
                rbi = int(stat.get("rbi", 0))
                bb = int(stat.get("baseOnBalls", 0))
                k = int(stat.get("strikeOuts", 0))
                runs = int(stat.get("runs", 0))
                tb = singles + (doubles * 2) + (triples * 3) + (hrs * 4)

                rates["tb_per_pa"] = round(tb / pa, 4)
                rates["h_per_pa"] = round(hits / pa, 4)
                rates["hr_per_pa"] = round(hrs / pa, 4)
                rates["rbi_per_pa"] = round(rbi / pa, 4)
                rates["bb_per_pa"] = round(bb / pa, 4)
                rates["k_per_pa"] = round(k / pa, 4)
                rates["r_per_pa"] = round(runs / pa, 4)
                rates["career_pa"] = pa
    except Exception as e:
        log.debug(f"Career rates fetch failed for {mlbam_id}: {e}")
    return rates


def fetch_batter_tb_rate(mlbam_id):
    """Fetch career total bases per plate appearance from MLB Stats API."""
    rates = fetch_batter_career_rates(mlbam_id)
    return rates["tb_per_pa"]


def get_platoon_factor(batter_hand, pitcher_hand):
    """
    Return platoon split multiplier for a batter/pitcher handedness matchup.
    If handedness data is missing, returns 1.0 (no adjustment).
    """
    if not batter_hand or not pitcher_hand:
        return 1.0, "unknown"
    key = (batter_hand, pitcher_hand)
    factor = PLATOON_SPLITS.get(key, 1.0)
    matchup = f"{batter_hand}HB vs {pitcher_hand}HP"
    return factor, matchup


def fetch_pitcher_hand(mlbam_id):
    """Fetch a pitcher's throwing hand from MLB Stats API."""
    try:
        url = f"https://statsapi.mlb.com/api/v1/people/{mlbam_id}"
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        people = r.json().get("people", [])
        if people:
            return people[0].get("pitchHand", {}).get("code")
    except Exception as e:
        log.debug(f"Pitcher hand fetch failed for {mlbam_id}: {e}")
    return None


def is_likely_starter(player):
    """
    Filter to likely starters only. Excludes:
    - Pitchers (P, SP, RP) — they have their own projection model
    - Players without a recognized position
    """
    pos = (player.get("position") or "").strip().upper()
    if not pos:
        return False
    if pos in ("P", "SP", "RP"):
        return False
    return pos in STARTER_POSITIONS


def project_batter(mlbam_id, player_name, opponent_pitcher, venue,
                   expected_pa=4.2, games_played=0,
                   batter_hand=None, pitcher_hand=None):
    """
    Project multiple stat types for a batter using the v3.0 multi-factor model.

    Returns a list of projection dicts (one per stat type):
      batter_total_bases, batter_hits, batter_home_runs,
      batter_rbis, batter_walks, batter_strikeouts, batter_runs.
    """
    career = fetch_batter_career_rates(mlbam_id)
    career_pa = career["career_pa"]

    # Early-season ramp-up
    weight = min(games_played / RAMP_UP_GAMES, 1.0) if games_played < RAMP_UP_GAMES else 1.0

    # Platoon split adjustment
    platoon_factor, matchup_desc = get_platoon_factor(batter_hand, pitcher_hand)

    # ------------------------------------------------------------------
    # Confidence scoring — multi-signal weighted model
    # ------------------------------------------------------------------
    confidence_factors = {}

    if career_pa >= 1500:
        sample_score = 1.0
    elif career_pa >= 600:
        sample_score = 0.6 + 0.4 * (career_pa - 600) / 900
    elif career_pa >= 150:
        sample_score = 0.2 + 0.4 * (career_pa - 150) / 450
    elif career_pa > 0:
        sample_score = 0.05 + 0.15 * (career_pa / 150)
    else:
        sample_score = 0.05
    confidence_factors["sample_size"] = round(sample_score, 3)

    if games_played >= 60:
        recency_score = 1.0
    elif games_played >= 30:
        recency_score = 0.6 + 0.4 * (games_played - 30) / 30
    elif games_played >= 10:
        recency_score = 0.3 + 0.3 * (games_played - 10) / 20
    elif games_played > 0:
        recency_score = 0.1 + 0.2 * (games_played / 10)
    else:
        recency_score = 0.1
    confidence_factors["data_recency"] = round(recency_score, 3)

    factor_count = 0
    factor_total = 4
    if career_pa > 0 and career["tb_per_pa"] != MLB_AVG_RATES["tb_per_pa"]:
        factor_count += 1
    if batter_hand and pitcher_hand:
        factor_count += 1
    if venue in PARK_TB_FACTORS:
        factor_count += 1
    if opponent_pitcher:
        factor_count += 1
    completeness_score = factor_count / factor_total
    confidence_factors["model_completeness"] = round(completeness_score, 3)

    stability_score = 0.2 + 0.8 * weight
    confidence_factors["projection_stability"] = round(stability_score, 3)

    conf = (
        0.40 * sample_score +
        0.25 * recency_score +
        0.20 * completeness_score +
        0.15 * stability_score
    )
    conf = round(max(0.15, min(conf, 0.95)), 3)
    confidence_factors["overall"] = conf

    # ------------------------------------------------------------------
    # Per-stat projections
    # ------------------------------------------------------------------
    STAT_CONFIGS = [
        {
            "stat_type": "batter_total_bases",
            "rate_key": "tb_per_pa",
            "park_factors": PARK_TB_FACTORS,
            "platoon_apply": True,
        },
        {
            "stat_type": "batter_hits",
            "rate_key": "h_per_pa",
            "park_factors": PARK_TB_FACTORS,   # hits correlate with TB park factors
            "park_scale": 0.5,                 # dampen: hits less affected than TB
            "platoon_apply": True,
        },
        {
            "stat_type": "batter_home_runs",
            "rate_key": "hr_per_pa",
            "park_factors": PARK_HR_FACTORS,
            "platoon_apply": True,
        },
        {
            "stat_type": "batter_rbis",
            "rate_key": "rbi_per_pa",
            "park_factors": PARK_TB_FACTORS,
            "park_scale": 0.4,
            "platoon_apply": True,
        },
        {
            "stat_type": "batter_walks",
            "rate_key": "bb_per_pa",
            "park_factors": {},                # walks not park-dependent
            "platoon_apply": False,            # walks not platoon-dependent
        },
        {
            "stat_type": "batter_strikeouts",
            "rate_key": "k_per_pa",
            "park_factors": PARK_BATTER_K_FACTORS,
            "platoon_apply": False,
        },
        {
            "stat_type": "batter_runs",
            "rate_key": "r_per_pa",
            "park_factors": PARK_TB_FACTORS,
            "park_scale": 0.5,
            "platoon_apply": False,
        },
    ]

    projections = []
    for cfg in STAT_CONFIGS:
        rate_key = cfg["rate_key"]
        career_rate = career[rate_key]
        mlb_avg = MLB_AVG_RATES[rate_key]

        # Blend with league average during ramp-up
        blended_rate = (1 - weight) * mlb_avg + weight * career_rate

        # Park factor
        park_map = cfg["park_factors"]
        park_scale = cfg.get("park_scale", 1.0)
        raw_park_adj = park_map.get(venue, 0)
        park_adj = raw_park_adj * park_scale
        park_factor = 1 + park_adj / 100

        # Platoon factor (only for stats where it applies)
        pf = platoon_factor if cfg["platoon_apply"] else 1.0

        # Final projection
        adjusted_rate = blended_rate * park_factor * pf
        projected_value = adjusted_rate * expected_pa

        # Stat-specific confidence discount for less predictable stats
        stat_conf = conf
        if cfg["stat_type"] in ("batter_home_runs", "batter_rbis", "batter_runs"):
            stat_conf = round(conf * 0.90, 3)  # more variance in counting stats

        features = {
            f"career_{rate_key}": round(career_rate, 4),
            "career_pa": career_pa,
            "games_played": games_played,
            "rampup_weight": round(weight, 3),
            f"blended_{rate_key}": round(blended_rate, 4),
            "park_adjustment": f"{park_adj:+.1f}%",
            "platoon_factor": round(pf, 3),
            "platoon_matchup": matchup_desc if cfg["platoon_apply"] else "n/a",
            "expected_pa": expected_pa,
            "opponent_pitcher": opponent_pitcher,
            "venue": venue,
            "confidence_factors": confidence_factors,
        }

        projections.append({
            "mlbam_id": mlbam_id,
            "player_name": player_name,
            "stat_type": cfg["stat_type"],
            "projection": round(projected_value, 2),
            "confidence": stat_conf,
            "model_version": MODEL_VERSION,
            "features": json.dumps(features),
        })

    return projections


def run_projections(game_date=None):
    if game_date is None:
        game_date = date.today().isoformat()
    log.info(f"=== Generating v3.0 multi-stat batter projections for {game_date} ===")

    games = sb_get("games", {
        "game_date": f"eq.{game_date}",
        "select": "game_pk,game_date,home_team,away_team,venue,status,"
                  "home_probable_pitcher_id,home_probable_pitcher,"
                  "away_probable_pitcher_id,away_probable_pitcher",
    })
    log.info(f"Found {len(games)} games for {game_date}")
    if not games:
        log.info("No games found.")
        return

    # Fetch all players — filter to likely starters (Task 6)
    players = sb_get("players", {"select": "mlbam_id,full_name,team,position,bats,throws"})
    all_count = len(players)
    players = [p for p in players if is_likely_starter(p)]
    log.info(f"Filtered {all_count} players to {len(players)} likely starters")

    # Cache pitcher handedness lookups
    pitcher_hands = {}

    projection_rows = []
    projected = set()

    for game in games:
        game_pk = game["game_pk"]
        venue = game.get("venue") or "Unknown"
        home_team = game.get("home_team", "")
        away_team = game.get("away_team", "")
        home_pitcher_name = game.get("home_probable_pitcher", "Unknown")
        away_pitcher_name = game.get("away_probable_pitcher", "Unknown")
        home_pitcher_id = game.get("home_probable_pitcher_id")
        away_pitcher_id = game.get("away_probable_pitcher_id")

        # Fetch pitcher handedness for platoon splits
        for pid in [home_pitcher_id, away_pitcher_id]:
            if pid and pid not in pitcher_hands:
                pitcher_hands[pid] = fetch_pitcher_hand(pid)

        home_pitcher_hand = pitcher_hands.get(home_pitcher_id)
        away_pitcher_hand = pitcher_hands.get(away_pitcher_id)

        # Home team batters face away pitcher
        home_batters = [p for p in players if p.get("team") == home_team]
        for batter in home_batters:
            b_id = batter["mlbam_id"]
            b_name = batter["full_name"]
            b_games = batter.get("games_played") or 0
            b_hand = batter.get("bats")
            if b_id in projected:
                continue
            projected.add(b_id)
            log.info(f"  Projecting {b_name} ({home_team}, {b_hand or '?'}HB) vs {away_pitcher_name} ({away_pitcher_hand or '?'}HP) @ {venue}")
            try:
                projs = project_batter(
                    b_id, b_name, away_pitcher_name, venue,
                    games_played=b_games,
                    batter_hand=b_hand,
                    pitcher_hand=away_pitcher_hand,
                )
                for proj in projs:
                    proj["game_pk"] = game_pk
                    proj["game_date"] = game_date
                    projection_rows.append(proj)
            except Exception as e:
                log.warning(f"  Failed to project {b_name}: {e}")

        # Away team batters face home pitcher
        away_batters = [p for p in players if p.get("team") == away_team]
        for batter in away_batters:
            b_id = batter["mlbam_id"]
            b_name = batter["full_name"]
            b_games = batter.get("games_played") or 0
            b_hand = batter.get("bats")
            if b_id in projected:
                continue
            projected.add(b_id)
            log.info(f"  Projecting {b_name} ({away_team}, {b_hand or '?'}HB) vs {home_pitcher_name} ({home_pitcher_hand or '?'}HP) @ {venue}")
            try:
                projs = project_batter(
                    b_id, b_name, home_pitcher_name, venue,
                    games_played=b_games,
                    batter_hand=b_hand,
                    pitcher_hand=home_pitcher_hand,
                )
                for proj in projs:
                    proj["game_pk"] = game_pk
                    proj["game_date"] = game_date
                    projection_rows.append(proj)
            except Exception as e:
                log.warning(f"  Failed to project {b_name}: {e}")

    log.info(f"Generated {len(projection_rows)} batter multi-stat projections")
    sb_upsert("projections", projection_rows)
    log.info("=== Done ===")


if __name__ == "__main__":
    import sys
    run_projections(sys.argv[1] if len(sys.argv) > 1 else None)

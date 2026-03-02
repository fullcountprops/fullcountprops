#!/usr/bin/env python3
"""
backtest_simulator.py — Baseline MLB
Monte Carlo simulation backtest engine v1.0.

Replays every game day in a date range as if running the simulator in
real-time. For each day it:

  1. Fetches the MLB schedule (Final games only).
  2. Fetches box scores to identify actual starting pitchers AND batters.
  3. Fetches pitcher/batter career stats that *were available* at that
     historical moment (career stats + season game logs up to that date).
  4. Runs configurable Monte Carlo simulations (default 3 000 per player
     per game) for four prop types:
       K  — pitcher strikeouts
       TB — batter total bases
       H  — batter hits
       HR — batter home runs
  5. Computes over/under probabilities for common prop lines, confidence
     tiers, and compares against actual box-score outcomes.
  6. Aggregates calibration, P/L (Kelly criterion), Brier scores, and
     MAE metrics into three output JSON files.

Output files (in --output-dir):
  backtest_predictions_{start}_{end}.json  — every prediction with full detail
  backtest_summary_{start}_{end}.json      — aggregated metrics
  backtest_daily_{start}_{end}.json        — day-by-day summary

Usage:
  python scripts/backtest_simulator.py \\
      --start 2025-07-01 --end 2025-07-31 \\
      --sims 3000 --prop-types K,TB,H,HR \\
      --output-dir output/backtest --upload

  # Quick smoke-test on 5 evenly-spaced sample days:
  python scripts/backtest_simulator.py \\
      --start 2025-07-01 --end 2025-07-31 \\
      --sims 500 --sample-days 5 -v

Model factors:
  Pitcher K:
    - Blended K/PA (career 70% + recent-14d 30%)
    - Opponent team K% (relative to MLB avg)
    - Park K factor
    - Umpire factor (default 1.0; disable with --no-umpire)
    - IP drawn from Normal(avg_ip, 1.0) clamped [1, 9]

  Batter TB / H / HR:
    - Career hit-type rates (1B/2B/3B/HR per PA)
    - Park TB factor
    - Platoon split (batter hand × pitcher hand)
    - PA count drawn from Uniform(3, 6)

IP parsing note:
  "5.2" in the MLB Stats API means 5 innings + 2 outs = 5⅔ innings.
  The fractional part counts *outs*, NOT tenths of an inning.
  parse_ip("5.2") → 5 + 2/3 = 5.667
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import numpy as np
import requests

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("backtest_simulator")

# ---------------------------------------------------------------------------
# Constants — kept in sync with generate_projections.py / generate_batter_projections.py
# ---------------------------------------------------------------------------

MLB_STATS_BASE = "https://statsapi.mlb.com/api/v1"
MODEL_VERSION = "v1.0-monte-carlo-backtest"

# 2024 MLB averages
MLB_AVG_K9: float = 8.5
MLB_AVG_K_PCT: float = 0.224     # league K/PA
MLB_AVG_IP: float = 5.5
MLB_AVG_TB_PA: float = 0.135     # ~.400 SLG / 3
MLB_AVG_PA_PER_GAME: float = 4.2

# Blending weights (mirrors generate_projections.py)
RECENT_FORM_WEIGHT: float = 0.30
CAREER_WEIGHT: float = 0.70
RAMP_UP_GAMES: int = 30

# Park K factors (mirrors generate_projections.py)
PARK_K_FACTORS: dict[str, int] = {
    "Coors Field": -8,
    "Yankee Stadium": 3,
    "Oracle Park": 5,
    "Petco Park": 4,
    "Truist Park": 2,
    "Globe Life Field": 2,
    "Chase Field": 1,
    "T-Mobile Park": 3,
    "Guaranteed Rate Field": 0,
    "loanDepot park": 1,
    "Great American Ball Park": -2,
    "PNC Park": 1,
    "Minute Maid Park": 2,
    "Dodger Stadium": 4,
    "Angel Stadium": 0,
    "Fenway Park": -1,
    "Wrigley Field": -3,
    "Busch Stadium": 1,
    "Citizens Bank Park": -2,
}

# Park TB factors (mirrors generate_batter_projections.py)
PARK_TB_FACTORS: dict[str, int] = {
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

# Platoon split multipliers (mirrors generate_batter_projections.py)
PLATOON_SPLITS: dict[tuple[str, str], float] = {
    ("L", "R"): 1.06,
    ("L", "L"): 0.88,
    ("R", "L"): 1.08,
    ("R", "R"): 0.96,
    ("S", "R"): 1.03,
    ("S", "L"): 1.05,
}

# Standard prop lines tested for each type
STANDARD_LINES: dict[str, list[float]] = {
    "K":  [3.5, 4.5, 5.5, 6.5, 7.5],
    "TB": [0.5, 1.5, 2.5, 3.5],
    "H":  [0.5, 1.5, 2.5],
    "HR": [0.5],
}

# Rate-limiting: seconds to sleep between outbound API calls
API_SLEEP: float = 0.5

# ---------------------------------------------------------------------------
# IP parsing helper
# ---------------------------------------------------------------------------

def parse_ip(ip_str: str) -> float:
    """
    Convert MLB Stats API inningsPitched string to decimal innings.

    The API uses a quirky format where the decimal part represents *outs*,
    not fractional innings:
      "5.0" → 5.0 (5 full innings, 0 outs)
      "5.1" → 5.333… (5 innings + 1 out)
      "5.2" → 5.667  (5 innings + 2 outs)
      "6"   → 6.0

    Args:
        ip_str: Innings-pitched string from MLB Stats API.

    Returns:
        Decimal innings as a float.
    """
    try:
        parts = str(ip_str).split(".")
        whole = int(parts[0])
        outs = int(parts[1]) if len(parts) > 1 and parts[1] else 0
        return whole + outs / 3.0
    except (ValueError, IndexError):
        return 0.0


# ---------------------------------------------------------------------------
# API cache + rate-limited fetch
# ---------------------------------------------------------------------------

class APICache:
    """
    Simple in-memory cache for MLB Stats API responses.

    All API calls in this module go through ``cached_get`` to avoid
    hammering the endpoint when the same pitcher appears on multiple dates.
    """

    def __init__(self) -> None:
        self._cache: dict[str, Any] = {}
        self._hit_count: int = 0
        self._miss_count: int = 0

    def cached_get(
        self,
        url: str,
        params: Optional[dict] = None,
        timeout: int = 15,
    ) -> Optional[dict]:
        """
        Fetch a URL, returning cached JSON if available.

        Args:
            url:     Full URL to fetch.
            params:  Query-string parameters.
            timeout: Request timeout in seconds.

        Returns:
            Parsed JSON response dict, or None on failure.
        """
        cache_key = url + json.dumps(params or {}, sort_keys=True)
        if cache_key in self._cache:
            self._hit_count += 1
            return self._cache[cache_key]

        self._miss_count += 1
        time.sleep(API_SLEEP)
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            data = resp.json()
            self._cache[cache_key] = data
            return data
        except Exception as exc:
            log.debug("API fetch failed: %s %s → %s", url, params, exc)
            return None

    @property
    def stats(self) -> dict[str, int]:
        return {"hits": self._hit_count, "misses": self._miss_count}


# Module-level shared cache instance
_cache = APICache()


# ---------------------------------------------------------------------------
# MLB Stats API helpers
# ---------------------------------------------------------------------------

def fetch_schedule(date_str: str) -> list[dict]:
    """
    Fetch completed (Final) games for a given date.

    Args:
        date_str: Date in YYYY-MM-DD format.

    Returns:
        List of game dicts from the schedule endpoint.
    """
    data = _cache.cached_get(
        f"{MLB_STATS_BASE}/schedule",
        params={"sportId": 1, "date": date_str, "hydrate": "linescore,venue"},
    )
    if not data:
        return []

    games: list[dict] = []
    for date_entry in data.get("dates", []):
        for game in date_entry.get("games", []):
            state = game.get("status", {}).get("abstractGameState", "")
            if state == "Final":
                games.append(game)
    return games


def fetch_boxscore(game_pk: int) -> dict:
    """
    Fetch the full box score for a game.

    Args:
        game_pk: MLB game primary key.

    Returns:
        Box score dict, or empty dict on failure.
    """
    data = _cache.cached_get(f"{MLB_STATS_BASE}/game/{game_pk}/boxscore")
    return data or {}


def fetch_pitcher_career_stats(mlbam_id: int) -> dict:
    """
    Fetch a pitcher's career pitching stats from MLB Stats API.

    Returns:
        Dict with keys: k_per_pa, k9, ip_total, strikeouts, pa_total.
        Falls back to league averages on error.
    """
    data = _cache.cached_get(
        f"{MLB_STATS_BASE}/people/{mlbam_id}/stats",
        params={"stats": "career", "group": "pitching", "sportId": 1},
    )
    if data:
        splits = data.get("stats", [{}])[0].get("splits", [])
        if splits:
            stat = splits[0].get("stat", {})
            k = float(stat.get("strikeOuts", 0))
            ip = parse_ip(stat.get("inningsPitched", "0.0"))
            # Approximate PA = IP * (MLB avg ~4.3 BF/IP)
            bf = float(stat.get("battersFaced", 0)) or (ip * 4.3)
            if ip > 0:
                k9 = (k / ip) * 9
                k_per_pa = k / bf if bf > 0 else MLB_AVG_K_PCT
                return {
                    "k9": round(k9, 3),
                    "k_per_pa": round(k_per_pa, 4),
                    "ip_total": ip,
                    "strikeouts": k,
                    "bf_total": bf,
                }
    return {
        "k9": MLB_AVG_K9,
        "k_per_pa": MLB_AVG_K_PCT,
        "ip_total": 0.0,
        "strikeouts": 0.0,
        "bf_total": 0.0,
    }


def fetch_pitcher_season_gamelog(
    mlbam_id: int,
    season: int,
    cutoff_date: str,
) -> dict:
    """
    Fetch a pitcher's season game log *up to* cutoff_date (historical sim).

    Used to compute:
      - Recent 14-day K/9 for blending
      - Season average IP per start

    Args:
        mlbam_id:    MLB player ID.
        season:      Season year (e.g. 2025).
        cutoff_date: Only include games on or before this date (YYYY-MM-DD).

    Returns:
        Dict with: recent_k9 (or None), recent_starts, avg_ip, games_started.
    """
    data = _cache.cached_get(
        f"{MLB_STATS_BASE}/people/{mlbam_id}/stats",
        params={"stats": "gameLog", "group": "pitching", "season": season, "sportId": 1},
    )

    result: dict[str, Any] = {
        "recent_k9": None,
        "recent_starts": 0,
        "avg_ip": MLB_AVG_IP,
        "games_started": 0,
        "season_ip": 0.0,
    }

    if not data:
        return result

    splits = data.get("stats", [{}])[0].get("splits", [])
    if not splits:
        return result

    cutoff_dt = datetime.strptime(cutoff_date, "%Y-%m-%d")
    recent_cutoff = cutoff_dt - timedelta(days=14)

    total_k = 0
    total_ip = 0.0
    total_gs = 0
    recent_k = 0
    recent_ip = 0.0
    recent_starts = 0

    for split in splits:
        game_date_str = split.get("date", "")
        try:
            game_dt = datetime.strptime(game_date_str, "%Y-%m-%d")
        except ValueError:
            continue

        if game_dt > cutoff_dt:
            continue  # Skip future games (crucial for realistic simulation)

        stat = split.get("stat", {})
        k = int(stat.get("strikeOuts", 0))
        ip = parse_ip(stat.get("inningsPitched", "0.0"))
        gs = int(stat.get("gamesStarted", 0))

        total_k += k
        total_ip += ip
        total_gs += gs if gs else (1 if ip >= 2.0 else 0)

        if game_dt > recent_cutoff:
            recent_k += k
            recent_ip += ip
            recent_starts += 1

    if total_gs >= 3 and total_ip > 0:
        result["avg_ip"] = round(total_ip / total_gs, 2)
        result["games_started"] = total_gs
        result["season_ip"] = round(total_ip, 1)

    if recent_ip >= 3.0:
        result["recent_k9"] = round((recent_k / recent_ip) * 9, 2)
        result["recent_starts"] = recent_starts

    return result


def fetch_team_k_pct(team_name: str, season: int) -> float:
    """
    Fetch a team's season K% (strikeouts per PA) from MLB Stats API.

    Args:
        team_name: Full team name as returned by the API (e.g. "New York Yankees").
        season:    Season year.

    Returns:
        K% as a decimal; falls back to MLB_AVG_K_PCT on error.
    """
    teams_data = _cache.cached_get(
        f"{MLB_STATS_BASE}/teams",
        params={"sportId": 1, "season": season},
    )
    if not teams_data:
        return MLB_AVG_K_PCT

    team_id: Optional[int] = None
    for team in teams_data.get("teams", []):
        if team.get("name") == team_name:
            team_id = team["id"]
            break

    if team_id is None:
        return MLB_AVG_K_PCT

    stats_data = _cache.cached_get(
        f"{MLB_STATS_BASE}/teams/{team_id}/stats",
        params={"stats": "season", "group": "hitting", "season": season, "sportId": 1},
    )
    if stats_data:
        splits = stats_data.get("stats", [{}])[0].get("splits", [])
        if splits:
            stat = splits[0].get("stat", {})
            k = int(stat.get("strikeOuts", 0))
            pa = int(stat.get("plateAppearances", 1))
            if pa > 0:
                return round(k / pa, 4)

    return MLB_AVG_K_PCT


def fetch_batter_career_stats(mlbam_id: int) -> dict:
    """
    Fetch a batter's career hitting stats.

    Returns rates per PA for each hit type plus career PA total.
    Falls back to MLB averages on error.
    """
    data = _cache.cached_get(
        f"{MLB_STATS_BASE}/people/{mlbam_id}/stats",
        params={"stats": "career", "group": "hitting", "sportId": 1},
    )
    if data:
        splits = data.get("stats", [{}])[0].get("splits", [])
        if splits:
            stat = splits[0].get("stat", {})
            hits = int(stat.get("hits", 0))
            doubles = int(stat.get("doubles", 0))
            triples = int(stat.get("triples", 0))
            hrs = int(stat.get("homeRuns", 0))
            singles = hits - doubles - triples - hrs
            pa = int(stat.get("plateAppearances", 1))
            if pa > 50:  # Need a meaningful sample
                return {
                    "single_rate": max(singles / pa, 0.0),
                    "double_rate": max(doubles / pa, 0.0),
                    "triple_rate": max(triples / pa, 0.0),
                    "hr_rate": max(hrs / pa, 0.0),
                    "hit_rate": max(hits / pa, 0.0),
                    "pa_career": pa,
                }
    # MLB average fallbacks (2024 baseline)
    return {
        "single_rate": 0.136,
        "double_rate": 0.045,
        "triple_rate": 0.004,
        "hr_rate": 0.029,
        "hit_rate": 0.214,
        "pa_career": 0,
    }


def fetch_player_handedness(mlbam_id: int) -> dict[str, Optional[str]]:
    """
    Fetch a player's batting and pitching handedness.

    Returns:
        Dict with keys 'bats' and 'throws', values 'L', 'R', 'S', or None.
    """
    data = _cache.cached_get(f"{MLB_STATS_BASE}/people/{mlbam_id}")
    if data:
        people = data.get("people", [])
        if people:
            p = people[0]
            return {
                "bats": p.get("batSide", {}).get("code"),
                "throws": p.get("pitchHand", {}).get("code"),
            }
    return {"bats": None, "throws": None}


# ---------------------------------------------------------------------------
# Box score extraction
# ---------------------------------------------------------------------------

def extract_starting_pitcher(box: dict, side: str) -> Optional[dict]:
    """
    Extract the starting pitcher info and actual stats from a box score.

    The first player in the ``pitchers`` list is the starter.

    Args:
        box:  Full box score dict from MLB Stats API.
        side: 'home' or 'away'.

    Returns:
        Dict with pitcher metadata and actual stats, or None if unavailable.
    """
    team_data = box.get("teams", {}).get(side, {})
    pitchers_order = team_data.get("pitchers", [])
    if not pitchers_order:
        return None

    starter_id = pitchers_order[0]
    players = team_data.get("players", {})
    player_data = players.get(f"ID{starter_id}", {})
    if not player_data:
        return None

    pstats = player_data.get("stats", {}).get("pitching", {})
    if not pstats:
        return None

    opp_side = "home" if side == "away" else "away"
    opp_name = box.get("teams", {}).get(opp_side, {}).get("team", {}).get("name", "Unknown")
    team_name = team_data.get("team", {}).get("name", "Unknown")

    return {
        "pitcher_id": starter_id,
        "pitcher_name": player_data.get("person", {}).get("fullName", "Unknown"),
        "team": team_name,
        "opponent": opp_name,
        "side": side,
        "actual_k": int(pstats.get("strikeOuts", 0)),
        "actual_ip": parse_ip(pstats.get("inningsPitched", "0.0")),
        "pitches_thrown": int(pstats.get("numberOfPitches", 0)),
    }


def extract_batting_starters(box: dict, side: str) -> list[dict]:
    """
    Extract the starting lineup (position players) and their actual stats.

    A player is considered a starter if they have a non-zero battingOrder.
    Pitchers (position code 'P', 'SP', 'RP') are excluded.

    Args:
        box:  Full box score dict.
        side: 'home' or 'away'.

    Returns:
        List of batter dicts with actual game stats.
    """
    team_data = box.get("teams", {}).get(side, {})
    batting_order = team_data.get("batters", [])  # ordered batter IDs
    players = team_data.get("players", {})

    opp_side = "home" if side == "away" else "away"
    opp_name = box.get("teams", {}).get(opp_side, {}).get("team", {}).get("name", "Unknown")

    # Identify the opposing starting pitcher from the pitchers list
    opp_team_data = box.get("teams", {}).get(opp_side, {})
    opp_pitchers = opp_team_data.get("pitchers", [])
    opp_starter_id = opp_pitchers[0] if opp_pitchers else None

    batters: list[dict] = []
    for batter_id in batting_order:
        player_data = players.get(f"ID{batter_id}", {})
        if not player_data:
            continue

        pos_code = player_data.get("position", {}).get("abbreviation", "")
        if pos_code in ("P", "SP", "RP"):
            continue  # Skip pitchers

        bstats = player_data.get("stats", {}).get("batting", {})
        if not bstats:
            continue

        hits = int(bstats.get("hits", 0))
        doubles = int(bstats.get("doubles", 0))
        triples = int(bstats.get("triples", 0))
        hrs = int(bstats.get("homeRuns", 0))
        singles = max(hits - doubles - triples - hrs, 0)
        tb = singles + 2 * doubles + 3 * triples + 4 * hrs
        pa = int(bstats.get("plateAppearances", 0))

        batters.append({
            "batter_id": batter_id,
            "batter_name": player_data.get("person", {}).get("fullName", "Unknown"),
            "team": team_data.get("team", {}).get("name", "Unknown"),
            "opponent": opp_name,
            "opp_pitcher_id": opp_starter_id,
            "side": side,
            "actual_pa": pa,
            "actual_h": hits,
            "actual_tb": tb,
            "actual_hr": hrs,
            "actual_singles": singles,
            "actual_doubles": doubles,
            "actual_triples": triples,
        })

    return batters


# ---------------------------------------------------------------------------
# Monte Carlo simulation engine
# ---------------------------------------------------------------------------

def simulate_pitcher_k(
    rng: np.random.Generator,
    n_sims: int,
    k_per_pa: float,
    expected_ip: float,
    ip_std: float = 1.0,
    opp_k_factor: float = 1.0,
    park_factor: float = 1.0,
    umpire_factor: float = 1.0,
    avg_bf_per_inning: float = 4.3,
) -> np.ndarray:
    """
    Monte Carlo simulation for pitcher strikeouts.

    Each simulation independently draws:
      - IP from Normal(expected_ip, ip_std), clamped to [1, 9]
      - For each inning: PA count ~ Poisson(avg_bf_per_inning)
      - Each PA is a Bernoulli trial: K probability = adjusted k_per_pa

    Args:
        rng:               NumPy random Generator for reproducibility.
        n_sims:            Number of simulations.
        k_per_pa:          Pitcher's blended K per plate appearance rate.
        expected_ip:       Mean innings pitched for this pitcher.
        ip_std:            Standard deviation for IP draw (default 1.0).
        opp_k_factor:      Opponent K% relative to MLB average (>1 = high-K).
        park_factor:       Park K adjustment multiplier.
        umpire_factor:     Umpire strike-tendency adjustment multiplier.
        avg_bf_per_inning: Average batters faced per inning (default 4.3).

    Returns:
        1-D array of simulated K totals, length n_sims.
    """
    # Adjusted K probability per PA after all factors
    adj_k_rate = k_per_pa * opp_k_factor * park_factor * umpire_factor
    adj_k_rate = float(np.clip(adj_k_rate, 0.0, 0.60))  # hard cap: 60% K rate

    # Draw innings for all sims at once (vectorized)
    sim_ip = rng.normal(loc=expected_ip, scale=ip_std, size=n_sims)
    sim_ip = np.clip(sim_ip, 1.0, 9.0)

    # Approximate: expected BF per sim = IP * avg_bf_per_inning
    # Use a Normal approximation for total BF (faster than per-inning loop)
    # BF_total ~ IP * avg_bf/inn; variance adds from both IP variance and per-inning Poisson
    expected_bf = sim_ip * avg_bf_per_inning
    bf_std = np.sqrt(sim_ip * avg_bf_per_inning)  # Poisson variance ≈ mean per inning, sum over innings

    sim_bf = np.round(
        np.clip(rng.normal(loc=expected_bf, scale=bf_std), sim_ip, sim_ip * 6.0)
    ).astype(int)

    # For each simulation, K count ~ Binomial(BF, adj_k_rate)
    # np.random.Generator.binomial supports array n
    sim_k = rng.binomial(n=sim_bf, p=adj_k_rate)

    return sim_k.astype(float)


def simulate_batter_outcomes(
    rng: np.random.Generator,
    n_sims: int,
    single_rate: float,
    double_rate: float,
    triple_rate: float,
    hr_rate: float,
    expected_pa: float = 4.2,
    park_tb_factor: float = 1.0,
    platoon_factor: float = 1.0,
) -> dict[str, np.ndarray]:
    """
    Monte Carlo simulation for batter outcomes (TB, H, HR).

    PA count is drawn uniformly from 3–6 per sim. Each PA is modeled as
    a multinomial trial with adjusted probabilities for each hit type.
    The park and platoon factors scale the overall hit-type rates.

    Args:
        rng:            NumPy random Generator.
        n_sims:         Number of simulations.
        single_rate:    Career singles per PA.
        double_rate:    Career doubles per PA.
        triple_rate:    Career triples per PA.
        hr_rate:        Career HR per PA.
        expected_pa:    Mean PA per game; PA drawn as Uniform(max(1, mean-1.5), mean+1.5).
        park_tb_factor: Park total-bases factor multiplier.
        platoon_factor: Platoon-split multiplier for this matchup.

    Returns:
        Dict with keys 'tb', 'h', 'hr' each a 1-D array of length n_sims.
    """
    # Adjust hit probabilities
    # The park/platoon factors are applied to total hitting rates
    # We scale all hit types proportionally then re-normalize against out rate
    combined_factor = park_tb_factor * platoon_factor
    adj_single = max(single_rate * combined_factor, 0.0)
    adj_double = max(double_rate * combined_factor, 0.0)
    adj_triple = max(triple_rate * combined_factor, 0.0)
    adj_hr = max(hr_rate * combined_factor, 0.0)

    # Probability of each outcome per PA (out absorbs residual)
    p_hit_total = adj_single + adj_double + adj_triple + adj_hr
    if p_hit_total > 0.95:
        # Renormalize to keep total probability under 1
        scale = 0.90 / p_hit_total
        adj_single *= scale
        adj_double *= scale
        adj_triple *= scale
        adj_hr *= scale
        p_hit_total = 0.90

    # Multinomial probabilities: [single, double, triple, hr, out]
    p_out = max(1.0 - p_hit_total, 0.05)
    probs = np.array([adj_single, adj_double, adj_triple, adj_hr, p_out])
    probs = probs / probs.sum()  # ensure exact sum to 1.0

    # Draw PA counts: Uniform integer from [pa_min, pa_max]
    pa_min = max(1, int(expected_pa - 1.5))
    pa_max = int(expected_pa + 1.5)
    pa_counts = rng.integers(pa_min, pa_max + 1, size=n_sims)

    # Simulate outcomes: for each sim, draw multinomial(pa, probs)
    # Vectorized: draw all PAs at once, then assign to sims
    # For efficiency, draw total PAs across all sims at once
    total_pa = int(pa_counts.sum())
    if total_pa == 0:
        zeros = np.zeros(n_sims)
        return {"tb": zeros, "h": zeros, "hr": zeros}

    # Draw outcome indices for every PA across all sims
    outcome_indices = rng.choice(5, size=total_pa, p=probs)

    # Split outcomes back to each simulation
    splits = np.split(outcome_indices, np.cumsum(pa_counts)[:-1])

    tb_arr = np.zeros(n_sims, dtype=float)
    h_arr = np.zeros(n_sims, dtype=float)
    hr_arr = np.zeros(n_sims, dtype=float)

    weights = np.array([1, 2, 3, 4, 0])  # TB weights: single=1, double=2, triple=3, hr=4, out=0
    hit_flag = np.array([1, 1, 1, 1, 0])

    for i, outcomes in enumerate(splits):
        if len(outcomes) == 0:
            continue
        counts = np.bincount(outcomes, minlength=5)
        tb_arr[i] = float((counts * weights).sum())
        h_arr[i] = float((counts * hit_flag).sum())
        hr_arr[i] = float(counts[3])  # index 3 = HR

    return {"tb": tb_arr, "h": h_arr, "hr": hr_arr}


# ---------------------------------------------------------------------------
# Distribution analytics
# ---------------------------------------------------------------------------

def compute_sim_metrics(
    sim_results: np.ndarray,
    prop_lines: list[float],
) -> dict[str, Any]:
    """
    Derive prediction metrics from a simulation result array.

    Args:
        sim_results: 1-D array of simulated values for one prop.
        prop_lines:  List of lines to test (e.g. [4.5, 5.5, 6.5] for K).

    Returns:
        Dict with mean, median, std, and per-line over/under probabilities.
    """
    n = len(sim_results)
    mean_val = float(np.mean(sim_results))
    median_val = float(np.median(sim_results))
    std_val = float(np.std(sim_results))

    lines_data: dict[str, dict[str, float]] = {}
    for line in prop_lines:
        p_over = float(np.mean(sim_results > line))
        p_under = float(np.mean(sim_results < line))
        p_push = float(np.mean(sim_results == line))
        lines_data[str(line)] = {
            "p_over": round(p_over, 4),
            "p_under": round(p_under, 4),
            "p_push": round(p_push, 4),
        }

    return {
        "mean": round(mean_val, 3),
        "median": round(median_val, 3),
        "std": round(std_val, 3),
        "lines": lines_data,
    }


def confidence_tier_from_p(p_best: float) -> str:
    """
    Assign a confidence tier based on the highest-probability side.

    Tiers:
      A — > 65% one side
      B — 60–65%
      C — 55–60%
      D — < 55% (low edge)

    Args:
        p_best: Probability of the favored side (0–1).

    Returns:
        Single character: 'A', 'B', 'C', or 'D'.
    """
    if p_best >= 0.65:
        return "A"
    elif p_best >= 0.60:
        return "B"
    elif p_best >= 0.55:
        return "C"
    else:
        return "D"


# ---------------------------------------------------------------------------
# Kelly criterion & P/L
# ---------------------------------------------------------------------------

def kelly_fraction_for_bet(
    p_win: float,
    decimal_odds: float = 100 / 110 + 1,  # -110 juice → ~1.909
    kelly_divisor: float = 4.0,            # Quarter Kelly
) -> float:
    """
    Compute fractional Kelly bet size as a fraction of bankroll.

    f* = (b * p - q) / b  (full Kelly)
    fractional = f* / kelly_divisor

    Args:
        p_win:        Model probability of winning the bet.
        decimal_odds: Decimal odds (default: -110 American = ~1.909).
        kelly_divisor: Divide full Kelly by this (default 4 = quarter Kelly).

    Returns:
        Fraction of bankroll to bet (0 to MAX_KELLY_CAP=0.05).
    """
    MAX_KELLY_CAP = 0.05
    b = decimal_odds - 1.0
    if b <= 0:
        return 0.0
    q = 1.0 - p_win
    f_full = (b * p_win - q) / b
    f_frac = f_full / kelly_divisor
    return float(np.clip(f_frac, 0.0, MAX_KELLY_CAP))


def compute_pl(
    p_over: float,
    p_under: float,
    actual: float,
    best_line: float,
    edge_threshold: float = 0.03,
    decimal_odds: float = 1.909,
) -> dict[str, Any]:
    """
    Calculate the P/L record for a single prediction.

    Only places a bet when the edge (p_favored - 0.5) exceeds edge_threshold.

    Args:
        p_over:          Model P(actual > line).
        p_under:         Model P(actual < line).
        actual:          Observed outcome.
        best_line:       The line associated with the highest-edge side.
        edge_threshold:  Minimum edge above 50% to place a bet (default 3%).
        decimal_odds:    Payout odds (default -110 juice).

    Returns:
        Dict with keys: direction, p_favored, edge, kelly_frac, bet_result,
        units_won, placed_bet.
    """
    if p_over >= p_under:
        direction = "over"
        p_favored = p_over
        wins = actual > best_line
        pushes = actual == best_line
    else:
        direction = "under"
        p_favored = p_under
        wins = actual < best_line
        pushes = actual == best_line

    edge = p_favored - 0.50
    placed_bet = edge > edge_threshold

    kelly_frac = kelly_fraction_for_bet(p_favored, decimal_odds) if placed_bet else 0.0

    if placed_bet:
        if wins:
            units_won = kelly_frac * (decimal_odds - 1.0)
            bet_result = "win"
        elif pushes:
            units_won = 0.0
            bet_result = "push"
        else:
            units_won = -kelly_frac
            bet_result = "loss"
    else:
        units_won = 0.0
        bet_result = "no_bet"

    return {
        "direction": direction,
        "p_favored": round(p_favored, 4),
        "edge": round(edge, 4),
        "kelly_frac": round(kelly_frac, 5),
        "bet_result": bet_result,
        "units_won": round(units_won, 5),
        "placed_bet": placed_bet,
    }


# ---------------------------------------------------------------------------
# Brier score
# ---------------------------------------------------------------------------

def brier_score(probs: list[float], outcomes: list[int]) -> float:
    """
    Compute the mean Brier score for a list of binary predictions.

    BS = (1/N) Σ (p_i - o_i)²

    Lower is better; a perfect forecaster scores 0.0, random scores 0.25.

    Args:
        probs:    List of predicted probabilities for the positive event.
        outcomes: List of 0/1 actual outcomes.

    Returns:
        Mean Brier score (float).
    """
    if not probs or not outcomes or len(probs) != len(outcomes):
        return float("nan")
    total = sum((p - o) ** 2 for p, o in zip(probs, outcomes))
    return round(total / len(probs), 6)


def naive_brier_baseline(outcomes: list[int]) -> float:
    """
    Brier score for a naive baseline that always predicts the base rate.

    Args:
        outcomes: List of 0/1 outcomes for the event.

    Returns:
        Brier score of the naive "predict mean" forecaster.
    """
    if not outcomes:
        return float("nan")
    mean = sum(outcomes) / len(outcomes)
    return brier_score([mean] * len(outcomes), outcomes)


# ---------------------------------------------------------------------------
# Prediction builder
# ---------------------------------------------------------------------------

def build_pitcher_prediction(
    *,
    rng: np.random.Generator,
    n_sims: int,
    game_pk: int,
    game_date: str,
    pitcher_id: int,
    pitcher_name: str,
    team: str,
    opponent: str,
    venue: str,
    season: int,
    config: dict,
) -> dict[str, Any]:
    """
    Build a full Monte Carlo prediction record for pitcher strikeouts.

    Fetches all required stats, runs the simulation, and returns a
    prediction dict ready for output and grading.

    Args:
        rng:          NumPy Generator (shared, seeded).
        n_sims:       Number of simulations.
        game_pk:      MLB game PK.
        game_date:    Date string YYYY-MM-DD.
        pitcher_id:   MLBAM pitcher ID.
        pitcher_name: Pitcher full name.
        team:         Pitcher's team name.
        opponent:     Opposing team name.
        venue:        Ballpark name.
        season:       Season year.
        config:       Model config dict (controls factor enable/disable).

    Returns:
        Prediction dict with simulation results, per-line probabilities,
        confidence tier, and model features.
    """
    # --- Fetch stats ---
    career = fetch_pitcher_career_stats(pitcher_id)
    gamelog = fetch_pitcher_season_gamelog(pitcher_id, season, game_date)

    career_k_per_pa = career["k_per_pa"]
    recent_k9 = gamelog.get("recent_k9")
    recent_starts = gamelog.get("recent_starts", 0)

    # Blended K/9 → K/PA
    career_k9 = career["k9"]
    if recent_k9 is not None and recent_starts >= 2:
        blended_k9 = CAREER_WEIGHT * career_k9 + RECENT_FORM_WEIGHT * recent_k9
    else:
        blended_k9 = career_k9
        recent_k9 = None

    # Convert K/9 → K/PA: K/9 / (9 innings * ~4.3 BF/inn) = K/9 / 38.7
    # More precisely: K/PA = blended_k9 / (9.0 * avg_BF_per_inning)
    blended_k_per_pa = blended_k9 / (9.0 * 4.3)

    # --- Factors ---
    park_adj = config["park_k_factors"].get(venue, 0)
    park_factor = 1.0 + park_adj / 100.0

    umpire_factor = config.get("umpire_factor_default", 1.0)

    opp_k_pct = fetch_team_k_pct(opponent, season) if config.get("use_opponent_k", True) else MLB_AVG_K_PCT
    opp_k_factor = opp_k_pct / MLB_AVG_K_PCT

    expected_ip = gamelog.get("avg_ip", MLB_AVG_IP)
    ip_std = config.get("ip_std", 1.0)

    # --- Simulate ---
    sim_k = simulate_pitcher_k(
        rng=rng,
        n_sims=n_sims,
        k_per_pa=blended_k_per_pa,
        expected_ip=expected_ip,
        ip_std=ip_std,
        opp_k_factor=opp_k_factor,
        park_factor=park_factor,
        umpire_factor=umpire_factor,
    )

    prop_lines = config.get("prop_lines_K", STANDARD_LINES["K"])
    metrics = compute_sim_metrics(sim_k, prop_lines)

    # Pick the line with highest edge for P/L tracking
    best_line = prop_lines[len(prop_lines) // 2]  # default: middle line
    best_edge = 0.0
    for ln_str, ln_data in metrics["lines"].items():
        edge = abs(max(ln_data["p_over"], ln_data["p_under"]) - 0.5)
        if edge > best_edge:
            best_edge = edge
            best_line = float(ln_str)

    best_line_data = metrics["lines"][str(best_line)]
    p_over_best = best_line_data["p_over"]
    p_under_best = best_line_data["p_under"]
    p_best = max(p_over_best, p_under_best)
    tier = confidence_tier_from_p(p_best)

    features = {
        "career_k9": round(career_k9, 2),
        "recent_k9": recent_k9,
        "recent_starts": recent_starts,
        "blended_k9": round(blended_k9, 2),
        "blended_k_per_pa": round(blended_k_per_pa, 4),
        "expected_ip": expected_ip,
        "ip_std": ip_std,
        "park_adj_pct": park_adj,
        "park_factor": round(park_factor, 4),
        "umpire_factor": umpire_factor,
        "opp_k_pct": round(opp_k_pct, 4),
        "opp_k_factor": round(opp_k_factor, 4),
        "venue": venue,
        "opponent": opponent,
    }

    return {
        "prediction_id": f"{game_date}_{game_pk}_K_{pitcher_id}",
        "prop_type": "K",
        "game_pk": game_pk,
        "game_date": game_date,
        "player_id": pitcher_id,
        "player_name": pitcher_name,
        "team": team,
        "opponent": opponent,
        "venue": venue,
        "n_sims": n_sims,
        "sim_mean": metrics["mean"],
        "sim_median": metrics["median"],
        "sim_std": metrics["std"],
        "lines": metrics["lines"],
        "best_line": best_line,
        "p_over_best": round(p_over_best, 4),
        "p_under_best": round(p_under_best, 4),
        "confidence_tier": tier,
        "model_version": MODEL_VERSION,
        "features": features,
        # actual_k will be filled in after box score is read
        "actual_value": None,
    }


def build_batter_predictions(
    *,
    rng: np.random.Generator,
    n_sims: int,
    game_pk: int,
    game_date: str,
    batter_id: int,
    batter_name: str,
    team: str,
    opponent: str,
    venue: str,
    opp_pitcher_id: Optional[int],
    prop_types: list[str],
    config: dict,
) -> list[dict[str, Any]]:
    """
    Build Monte Carlo prediction records for batter props (TB, H, HR).

    One simulation run covers all three prop types simultaneously.

    Args:
        rng:            NumPy Generator.
        n_sims:         Number of simulations.
        game_pk:        MLB game PK.
        game_date:      Date string YYYY-MM-DD.
        batter_id:      MLBAM batter ID.
        batter_name:    Batter full name.
        team:           Batter's team name.
        opponent:       Opposing team name.
        venue:          Ballpark name.
        opp_pitcher_id: MLBAM ID of opposing starting pitcher (for platoon).
        prop_types:     List of types to return, subset of ['TB', 'H', 'HR'].
        config:         Model config dict.

    Returns:
        List of prediction dicts (one per prop type in prop_types).
    """
    career = fetch_batter_career_stats(batter_id)

    # Platoon factor
    batter_hand_data = fetch_player_handedness(batter_id)
    batter_hand = batter_hand_data.get("bats")

    pitcher_hand: Optional[str] = None
    if opp_pitcher_id:
        pitcher_hand_data = fetch_player_handedness(opp_pitcher_id)
        pitcher_hand = pitcher_hand_data.get("throws")

    platoon_key = (batter_hand, pitcher_hand)
    platoon_factor = PLATOON_SPLITS.get(platoon_key, 1.0)

    # Park factor
    park_tb_adj = config["park_tb_factors"].get(venue, 0)
    park_tb_factor = 1.0 + park_tb_adj / 100.0

    expected_pa = config.get("expected_pa", MLB_AVG_PA_PER_GAME)

    # Run simulation
    sim_outcomes = simulate_batter_outcomes(
        rng=rng,
        n_sims=n_sims,
        single_rate=career["single_rate"],
        double_rate=career["double_rate"],
        triple_rate=career["triple_rate"],
        hr_rate=career["hr_rate"],
        expected_pa=expected_pa,
        park_tb_factor=park_tb_factor,
        platoon_factor=platoon_factor,
    )

    features = {
        "single_rate": round(career["single_rate"], 4),
        "double_rate": round(career["double_rate"], 4),
        "triple_rate": round(career["triple_rate"], 4),
        "hr_rate": round(career["hr_rate"], 4),
        "hit_rate": round(career["hit_rate"], 4),
        "career_pa": career["pa_career"],
        "batter_hand": batter_hand,
        "pitcher_hand": pitcher_hand,
        "platoon_factor": round(platoon_factor, 4),
        "park_tb_adj_pct": park_tb_adj,
        "park_tb_factor": round(park_tb_factor, 4),
        "expected_pa": expected_pa,
        "venue": venue,
        "opponent": opponent,
    }

    predictions: list[dict[str, Any]] = []

    for ptype in prop_types:
        if ptype not in ("TB", "H", "HR"):
            continue

        sim_vals = sim_outcomes[ptype.lower()]
        prop_lines = config.get(f"prop_lines_{ptype}", STANDARD_LINES[ptype])
        metrics = compute_sim_metrics(sim_vals, prop_lines)

        # Best line selection
        best_line = prop_lines[0]
        best_edge = 0.0
        for ln_str, ln_data in metrics["lines"].items():
            edge = abs(max(ln_data["p_over"], ln_data["p_under"]) - 0.5)
            if edge > best_edge:
                best_edge = edge
                best_line = float(ln_str)

        best_line_data = metrics["lines"][str(best_line)]
        p_over_best = best_line_data["p_over"]
        p_under_best = best_line_data["p_under"]
        p_best = max(p_over_best, p_under_best)
        tier = confidence_tier_from_p(p_best)

        predictions.append({
            "prediction_id": f"{game_date}_{game_pk}_{ptype}_{batter_id}",
            "prop_type": ptype,
            "game_pk": game_pk,
            "game_date": game_date,
            "player_id": batter_id,
            "player_name": batter_name,
            "team": team,
            "opponent": opponent,
            "venue": venue,
            "n_sims": n_sims,
            "sim_mean": metrics["mean"],
            "sim_median": metrics["median"],
            "sim_std": metrics["std"],
            "lines": metrics["lines"],
            "best_line": best_line,
            "p_over_best": round(p_over_best, 4),
            "p_under_best": round(p_under_best, 4),
            "confidence_tier": tier,
            "model_version": MODEL_VERSION,
            "features": features,
            "actual_value": None,
        })

    return predictions


# ---------------------------------------------------------------------------
# Grading
# ---------------------------------------------------------------------------

def grade_prediction(pred: dict, actual_value: float) -> dict:
    """
    Grade a prediction against the actual outcome.

    Attaches actual_value, error metrics, Brier score inputs, and P/L
    calculation to the prediction dict in place.

    Args:
        pred:         Prediction dict (mutated in place).
        actual_value: Observed value from box score.

    Returns:
        The updated prediction dict.
    """
    pred["actual_value"] = actual_value
    pred["absolute_error"] = round(abs(pred["sim_mean"] - actual_value), 3)
    pred["signed_error"] = round(pred["sim_mean"] - actual_value, 3)

    best_line = pred["best_line"]
    p_over = pred["p_over_best"]
    p_under = pred["p_under_best"]

    # Determine hit/miss for best line
    if actual_value > best_line:
        pred["best_line_result"] = "over"
        pred["best_line_correct"] = p_over > p_under
    elif actual_value < best_line:
        pred["best_line_result"] = "under"
        pred["best_line_correct"] = p_under > p_over
    else:
        pred["best_line_result"] = "push"
        pred["best_line_correct"] = None  # push — no score

    # P/L
    pl = compute_pl(p_over, p_under, actual_value, best_line)
    pred["pl"] = pl

    # Brier score component (for aggregation later)
    # We use the best-line over prediction as the binary event
    pred["brier_p_over"] = p_over
    pred["brier_outcome_over"] = 1 if actual_value > best_line else 0

    # Per-line grading
    line_grades: dict[str, dict] = {}
    for ln_str, ln_data in pred["lines"].items():
        ln = float(ln_str)
        lo = ln_data["p_over"]
        lu = ln_data["p_under"]
        if actual_value > ln:
            result = "over"
            correct = lo > lu
        elif actual_value < ln:
            result = "under"
            correct = lu > lo
        else:
            result = "push"
            correct = None
        line_grades[ln_str] = {
            "result": result,
            "model_favored": "over" if lo >= lu else "under",
            "correct": correct,
        }
    pred["line_grades"] = line_grades

    return pred


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------

def aggregate_predictions(
    all_predictions: list[dict],
    model_config: dict,
    start_date: str,
    end_date: str,
    n_sims: int,
) -> dict[str, Any]:
    """
    Produce the comprehensive summary JSON from all graded predictions.

    Includes:
      - Overall and per-prop-type accuracy
      - Calibration table (P(over) buckets → actual hit rate)
      - P/L and ROI by confidence tier
      - Brier scores with naive baseline
      - MAE by prop type
      - Best / worst 10 predictions by absolute error
      - Daily running P/L

    Args:
        all_predictions: Graded prediction dicts.
        model_config:    The config dict used for this run (recorded verbatim).
        start_date:      Backtest start date string.
        end_date:        Backtest end date string.
        n_sims:          Number of simulations used.

    Returns:
        Summary dict ready to serialise as JSON.
    """
    graded = [p for p in all_predictions if p.get("actual_value") is not None]
    total = len(graded)

    if total == 0:
        return {
            "start_date": start_date,
            "end_date": end_date,
            "n_sims": n_sims,
            "model_config": model_config,
            "total_predictions": 0,
            "note": "No graded predictions available.",
        }

    # ------------------------------------------------------------------ #
    # Per-prop-type accuracy & MAE
    # ------------------------------------------------------------------ #
    by_type: dict[str, Any] = {}
    prop_types_found = sorted({p["prop_type"] for p in graded})

    for pt in prop_types_found:
        subset = [p for p in graded if p["prop_type"] == pt]
        decided = [p for p in subset if p.get("best_line_correct") is not None]
        hits = sum(1 for p in decided if p["best_line_correct"])
        misses = sum(1 for p in decided if not p["best_line_correct"])
        hit_rate = hits / len(decided) if decided else float("nan")
        errors = [p["absolute_error"] for p in subset]
        mae = sum(errors) / len(errors) if errors else float("nan")

        # Brier score
        brier_probs = [p["brier_p_over"] for p in subset]
        brier_outcomes = [p["brier_outcome_over"] for p in subset]
        bs = brier_score(brier_probs, brier_outcomes)
        bs_naive = naive_brier_baseline(brier_outcomes)

        by_type[pt] = {
            "total": len(subset),
            "decided": len(decided),
            "hits": hits,
            "misses": misses,
            "hit_rate": round(hit_rate, 4) if not math.isnan(hit_rate) else None,
            "mae": round(mae, 3) if not math.isnan(mae) else None,
            "brier_score": bs,
            "brier_naive_baseline": bs_naive,
            "brier_skill_score": round(1.0 - bs / bs_naive, 4)
                if (bs_naive and not math.isnan(bs_naive) and bs_naive > 0) else None,
        }

    # ------------------------------------------------------------------ #
    # Calibration: P(over) buckets → actual hit rate
    # ------------------------------------------------------------------ #
    calibration_buckets: dict[str, dict[str, Any]] = {
        "50-55": {"label": "50–55%", "preds": [], "actuals": []},
        "55-60": {"label": "55–60%", "preds": [], "actuals": []},
        "60-65": {"label": "60–65%", "preds": [], "actuals": []},
        "65-70": {"label": "65–70%", "preds": [], "actuals": []},
        "70+":   {"label": "70%+",   "preds": [], "actuals": []},
    }
    for p in graded:
        po = p["p_over_best"]
        outcome = p["brier_outcome_over"]
        if po >= 0.70:
            calibration_buckets["70+"]["preds"].append(po)
            calibration_buckets["70+"]["actuals"].append(outcome)
        elif po >= 0.65:
            calibration_buckets["65-70"]["preds"].append(po)
            calibration_buckets["65-70"]["actuals"].append(outcome)
        elif po >= 0.60:
            calibration_buckets["60-65"]["preds"].append(po)
            calibration_buckets["60-65"]["actuals"].append(outcome)
        elif po >= 0.55:
            calibration_buckets["55-60"]["preds"].append(po)
            calibration_buckets["55-60"]["actuals"].append(outcome)
        elif po >= 0.50:
            calibration_buckets["50-55"]["preds"].append(po)
            calibration_buckets["50-55"]["actuals"].append(outcome)

    calibration: dict[str, Any] = {}
    for key, bucket in calibration_buckets.items():
        n = len(bucket["actuals"])
        if n == 0:
            calibration[key] = {"label": bucket["label"], "n": 0, "actual_hit_rate": None, "mean_predicted": None}
        else:
            actual_hr = sum(bucket["actuals"]) / n
            mean_pred = sum(bucket["preds"]) / n
            calibration[key] = {
                "label": bucket["label"],
                "n": n,
                "actual_hit_rate": round(actual_hr, 4),
                "mean_predicted": round(mean_pred, 4),
                "calibration_error": round(abs(actual_hr - mean_pred), 4),
            }

    # ------------------------------------------------------------------ #
    # P/L and ROI by confidence tier
    # ------------------------------------------------------------------ #
    tier_buckets: dict[str, list] = defaultdict(list)
    for p in graded:
        tier_buckets[p["confidence_tier"]].append(p)

    roi_by_tier: dict[str, Any] = {}
    for tier, preds in sorted(tier_buckets.items()):
        placed = [p for p in preds if p["pl"]["placed_bet"]]
        total_units_won = sum(p["pl"]["units_won"] for p in placed)
        total_staked = sum(p["pl"]["kelly_frac"] for p in placed)
        roi = total_units_won / total_staked if total_staked > 0 else float("nan")
        wins = sum(1 for p in placed if p["pl"]["bet_result"] == "win")
        losses = sum(1 for p in placed if p["pl"]["bet_result"] == "loss")
        decided_bets = wins + losses
        roi_by_tier[tier] = {
            "n_predictions": len(preds),
            "n_bets_placed": len(placed),
            "wins": wins,
            "losses": losses,
            "win_rate": round(wins / decided_bets, 4) if decided_bets > 0 else None,
            "total_units_won": round(total_units_won, 4),
            "total_staked_kelly": round(total_staked, 4),
            "roi": round(roi, 4) if not math.isnan(roi) else None,
        }

    # ------------------------------------------------------------------ #
    # Overall P/L
    # ------------------------------------------------------------------ #
    all_placed = [p for p in graded if p["pl"]["placed_bet"]]
    total_units_won = sum(p["pl"]["units_won"] for p in all_placed)
    total_staked = sum(p["pl"]["kelly_frac"] for p in all_placed)
    overall_roi = total_units_won / total_staked if total_staked > 0 else float("nan")

    overall = {
        "total_predictions": total,
        "bets_placed": len(all_placed),
        "total_units_won": round(total_units_won, 4),
        "total_staked_kelly": round(total_staked, 4),
        "roi": round(overall_roi, 4) if not math.isnan(overall_roi) else None,
    }

    # ------------------------------------------------------------------ #
    # Best / worst 10 by absolute error
    # ------------------------------------------------------------------ #
    sorted_by_error = sorted(graded, key=lambda p: p["absolute_error"])
    best_10 = [
        {
            "prediction_id": p["prediction_id"],
            "player_name": p["player_name"],
            "prop_type": p["prop_type"],
            "game_date": p["game_date"],
            "sim_mean": p["sim_mean"],
            "actual_value": p["actual_value"],
            "absolute_error": p["absolute_error"],
        }
        for p in sorted_by_error[:10]
    ]
    worst_10 = [
        {
            "prediction_id": p["prediction_id"],
            "player_name": p["player_name"],
            "prop_type": p["prop_type"],
            "game_date": p["game_date"],
            "sim_mean": p["sim_mean"],
            "actual_value": p["actual_value"],
            "absolute_error": p["absolute_error"],
        }
        for p in sorted_by_error[-10:][::-1]
    ]

    # ------------------------------------------------------------------ #
    # Daily running P/L (for charting)
    # ------------------------------------------------------------------ #
    daily_pl: dict[str, dict[str, Any]] = {}
    for p in graded:
        d = p["game_date"]
        if d not in daily_pl:
            daily_pl[d] = {"date": d, "n_bets": 0, "units_won": 0.0, "n_predictions": 0}
        daily_pl[d]["n_predictions"] += 1
        if p["pl"]["placed_bet"]:
            daily_pl[d]["n_bets"] += 1
            daily_pl[d]["units_won"] += p["pl"]["units_won"]

    # Add running cumulative
    running = 0.0
    for d in sorted(daily_pl):
        running += daily_pl[d]["units_won"]
        daily_pl[d]["units_won"] = round(daily_pl[d]["units_won"], 4)
        daily_pl[d]["cumulative_units"] = round(running, 4)

    return {
        "start_date": start_date,
        "end_date": end_date,
        "n_sims": n_sims,
        "model_config": model_config,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "model_version": MODEL_VERSION,
        "total_predictions": total,
        "by_prop_type": by_type,
        "calibration": calibration,
        "roi_by_confidence_tier": roi_by_tier,
        "overall_pl": overall,
        "best_10_predictions": best_10,
        "worst_10_predictions": worst_10,
        "daily_pl": list(daily_pl.values()),
    }


def aggregate_daily(
    all_predictions: list[dict],
) -> list[dict[str, Any]]:
    """
    Produce the day-by-day summary list.

    Args:
        all_predictions: All graded prediction dicts.

    Returns:
        List of daily summary dicts sorted by date.
    """
    daily: dict[str, dict[str, Any]] = {}

    for p in all_predictions:
        if p.get("actual_value") is None:
            continue
        d = p["game_date"]
        if d not in daily:
            daily[d] = {
                "date": d,
                "n_predictions": 0,
                "n_bets": 0,
                "units_won": 0.0,
                "by_prop": defaultdict(lambda: {"n": 0, "hits": 0, "mae_sum": 0.0}),
            }
        daily[d]["n_predictions"] += 1
        if p["pl"]["placed_bet"]:
            daily[d]["n_bets"] += 1
            daily[d]["units_won"] += p["pl"]["units_won"]

        pt = p["prop_type"]
        daily[d]["by_prop"][pt]["n"] += 1
        if p.get("best_line_correct"):
            daily[d]["by_prop"][pt]["hits"] += 1
        daily[d]["by_prop"][pt]["mae_sum"] += p["absolute_error"]

    result = []
    for d in sorted(daily):
        entry = daily[d]
        by_prop = {}
        for pt, stats in entry["by_prop"].items():
            n = stats["n"]
            by_prop[pt] = {
                "n": n,
                "hits": stats["hits"],
                "mae": round(stats["mae_sum"] / n, 3) if n else None,
            }
        result.append({
            "date": d,
            "n_predictions": entry["n_predictions"],
            "n_bets": entry["n_bets"],
            "units_won": round(entry["units_won"], 4),
            "by_prop_type": by_prop,
        })

    return result


# ---------------------------------------------------------------------------
# Supabase upload
# ---------------------------------------------------------------------------

def sb_headers(supabase_key: str) -> dict[str, str]:
    return {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def sb_upsert(
    supabase_url: str,
    supabase_key: str,
    table: str,
    rows: list[dict],
) -> None:
    """
    Upsert rows to a Supabase table in batches of 500.

    Args:
        supabase_url: Supabase project URL.
        supabase_key: Supabase service key.
        table:        Target table name.
        rows:         List of row dicts to upsert.
    """
    if not rows:
        log.info("  No rows to upsert into %s", table)
        return
    url = f"{supabase_url}/rest/v1/{table}"
    hdrs = sb_headers(supabase_key)
    for i in range(0, len(rows), 500):
        batch = rows[i : i + 500]
        try:
            resp = requests.post(url, headers=hdrs, json=batch, timeout=30)
            if resp.ok:
                log.info("  Upserted %d rows into %s", len(batch), table)
            else:
                log.warning("  Upsert failed: %s %s", resp.status_code, resp.text[:200])
        except Exception as exc:
            log.warning("  Upsert exception for %s: %s", table, exc)


# ---------------------------------------------------------------------------
# Default model config
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: dict[str, Any] = {
    # Park factors
    "park_k_factors": PARK_K_FACTORS,
    "park_tb_factors": PARK_TB_FACTORS,
    # Simulation parameters
    "ip_std": 1.0,
    "expected_pa": MLB_AVG_PA_PER_GAME,
    # Factor toggles
    "use_park_k": True,
    "use_park_tb": True,
    "use_opponent_k": True,
    "use_umpire": True,
    "use_platoon": True,
    # Factor defaults (used when toggled off)
    "umpire_factor_default": 1.0,
    # Blending
    "recent_form_weight": RECENT_FORM_WEIGHT,
    "career_weight": CAREER_WEIGHT,
    # Prop lines to test
    "prop_lines_K": STANDARD_LINES["K"],
    "prop_lines_TB": STANDARD_LINES["TB"],
    "prop_lines_H": STANDARD_LINES["H"],
    "prop_lines_HR": STANDARD_LINES["HR"],
}


def build_model_config(args: argparse.Namespace, override_path: Optional[str] = None) -> dict:
    """
    Build the model config dict from defaults and CLI flags.

    An optional JSON file (--config) can override any key. CLI flags
    (--no-umpire, --no-weather) are applied on top.

    Args:
        args:          Parsed CLI args.
        override_path: Path to JSON config file (optional).

    Returns:
        Final model config dict.
    """
    config = dict(DEFAULT_CONFIG)  # shallow copy

    # Deep-copy the nested dicts to avoid mutation
    config["park_k_factors"] = dict(PARK_K_FACTORS)
    config["park_tb_factors"] = dict(PARK_TB_FACTORS)
    config["prop_lines_K"] = list(STANDARD_LINES["K"])
    config["prop_lines_TB"] = list(STANDARD_LINES["TB"])
    config["prop_lines_H"] = list(STANDARD_LINES["H"])
    config["prop_lines_HR"] = list(STANDARD_LINES["HR"])

    if override_path:
        try:
            with open(override_path) as fh:
                overrides = json.load(fh)
            config.update(overrides)
            log.info("Loaded config overrides from %s", override_path)
        except Exception as exc:
            log.warning("Could not load --config file %s: %s", override_path, exc)

    if getattr(args, "no_umpire", False):
        config["use_umpire"] = False
        config["umpire_factor_default"] = 1.0
        log.info("Umpire factor disabled (--no-umpire)")

    if getattr(args, "no_weather", False):
        config["use_weather"] = False
        log.info("Weather factor disabled (--no-weather) [placeholder — no effect yet]")

    # Record which factors are active (for compare_models.py)
    config["_active_factors"] = {
        "park_k": config.get("use_park_k", True),
        "park_tb": config.get("use_park_tb", True),
        "opponent_k": config.get("use_opponent_k", True),
        "umpire": config.get("use_umpire", True),
        "platoon": config.get("use_platoon", True),
        "recent_form_blend": config.get("recent_form_weight", RECENT_FORM_WEIGHT),
        "weather": config.get("use_weather", False),
    }

    return config


# ---------------------------------------------------------------------------
# Date utilities
# ---------------------------------------------------------------------------

def date_range(start: str, end: str) -> list[str]:
    """Return a list of ISO date strings from start to end inclusive."""
    start_dt = datetime.strptime(start, "%Y-%m-%d")
    end_dt = datetime.strptime(end, "%Y-%m-%d")
    result = []
    cur = start_dt
    while cur <= end_dt:
        result.append(cur.strftime("%Y-%m-%d"))
        cur += timedelta(days=1)
    return result


def sample_dates(dates: list[str], n: int) -> list[str]:
    """Return n evenly-spaced dates from the list."""
    if n >= len(dates):
        return dates
    step = len(dates) / n
    return [dates[int(i * step)] for i in range(n)]


# ---------------------------------------------------------------------------
# Main backtest loop
# ---------------------------------------------------------------------------

def run_backtest(
    start_date: str,
    end_date: str,
    n_sims: int,
    prop_types: list[str],
    output_dir: Path,
    upload: bool,
    sample_days: Optional[int],
    config: dict,
    seed: int = 42,
    verbose: bool = False,
) -> dict[str, Any]:
    """
    Run the full Monte Carlo backtest from start_date to end_date.

    This is the core orchestration loop. For each date it:
      1. Fetches the schedule.
      2. Fetches box scores.
      3. Generates predictions (pitcher K and/or batter TB/H/HR).
      4. Grades each prediction against actual box-score outcomes.
      5. Writes output files.

    Args:
        start_date:  Backtest start date (YYYY-MM-DD).
        end_date:    Backtest end date (YYYY-MM-DD).
        n_sims:      Number of Monte Carlo simulations per player per game.
        prop_types:  List of prop types to simulate: K, TB, H, HR.
        output_dir:  Path to directory where output files are written.
        upload:      If True, upload summary to Supabase.
        sample_days: If set, simulate only this many evenly-spaced days.
        config:      Model configuration dict.
        seed:        RNG seed for reproducibility.
        verbose:     Enable verbose logging.

    Returns:
        Summary dict (also written to disk).
    """
    if verbose:
        log.setLevel(logging.DEBUG)

    rng = np.random.default_rng(seed)
    log.info("=== BACKTEST SIMULATOR: %s → %s | %d sims | %s ===",
             start_date, end_date, n_sims, ",".join(prop_types))

    all_dates = date_range(start_date, end_date)
    if sample_days:
        all_dates = sample_dates(all_dates, sample_days)
        log.info("Sampling %d days from %d-day range", len(all_dates), len(date_range(start_date, end_date)))

    total_days = len(all_dates)
    all_predictions: list[dict] = []
    days_processed = 0
    days_with_games = 0

    for day_idx, date_str in enumerate(all_dates):
        season = int(date_str[:4])

        if day_idx % 5 == 0 or verbose:
            log.info("Progress: %d/%d days | %d predictions so far | cache: %s",
                     day_idx, total_days, len(all_predictions), _cache.stats)

        # ---- 1. Schedule ----
        games = fetch_schedule(date_str)
        if not games:
            log.debug("No completed games on %s", date_str)
            days_processed += 1
            continue

        days_with_games += 1
        log.debug("%s: %d games", date_str, len(games))

        for game in games:
            game_pk = game["gamePk"]
            venue_name = game.get("venue", {}).get("name", "Unknown")

            # ---- 2. Box score ----
            box = fetch_boxscore(game_pk)
            if not box:
                log.warning("Could not fetch box score for game %d on %s", game_pk, date_str)
                continue

            # ---- 3 & 4. Pitcher K ----
            if "K" in prop_types:
                for side in ("away", "home"):
                    sp = extract_starting_pitcher(box, side)
                    if not sp:
                        continue

                    try:
                        pred = build_pitcher_prediction(
                            rng=rng,
                            n_sims=n_sims,
                            game_pk=game_pk,
                            game_date=date_str,
                            pitcher_id=sp["pitcher_id"],
                            pitcher_name=sp["pitcher_name"],
                            team=sp["team"],
                            opponent=sp["opponent"],
                            venue=venue_name,
                            season=season,
                            config=config,
                        )
                        grade_prediction(pred, float(sp["actual_k"]))
                        all_predictions.append(pred)

                        if verbose:
                            log.debug(
                                "  K | %s | mean=%.1f actual=%d tier=%s",
                                sp["pitcher_name"],
                                pred["sim_mean"],
                                sp["actual_k"],
                                pred["confidence_tier"],
                            )
                    except Exception as exc:
                        log.warning("K prediction failed for %s game %d: %s",
                                    sp.get("pitcher_name", "?"), game_pk, exc)

            # ---- 3 & 4. Batter props ----
            batter_prop_types = [pt for pt in prop_types if pt in ("TB", "H", "HR")]
            if batter_prop_types:
                for side in ("away", "home"):
                    batters = extract_batting_starters(box, side)
                    for batter in batters:
                        try:
                            preds = build_batter_predictions(
                                rng=rng,
                                n_sims=n_sims,
                                game_pk=game_pk,
                                game_date=date_str,
                                batter_id=batter["batter_id"],
                                batter_name=batter["batter_name"],
                                team=batter["team"],
                                opponent=batter["opponent"],
                                venue=venue_name,
                                opp_pitcher_id=batter.get("opp_pitcher_id"),
                                prop_types=batter_prop_types,
                                config=config,
                            )
                            for pred in preds:
                                pt = pred["prop_type"]
                                actual_map = {"TB": batter["actual_tb"],
                                              "H":  batter["actual_h"],
                                              "HR": batter["actual_hr"]}
                                grade_prediction(pred, float(actual_map[pt]))
                                all_predictions.append(pred)

                            if verbose and preds:
                                log.debug(
                                    "  Batter | %s | TB mean=%.2f actual=%d",
                                    batter["batter_name"],
                                    next((p["sim_mean"] for p in preds if p["prop_type"] == "TB"), 0),
                                    batter["actual_tb"],
                                )
                        except Exception as exc:
                            log.warning("Batter prediction failed for %s game %d: %s",
                                        batter.get("batter_name", "?"), game_pk, exc)

        days_processed += 1

    log.info("Backtest complete: %d days processed, %d with games, %d predictions",
             days_processed, days_with_games, len(all_predictions))
    log.info("API cache stats: %s", _cache.stats)

    # ------------------------------------------------------------------ #
    # Write output files
    # ------------------------------------------------------------------ #
    output_dir.mkdir(parents=True, exist_ok=True)
    slug = f"{start_date}_{end_date}"

    # 1. Full predictions JSON
    predictions_path = output_dir / f"backtest_predictions_{slug}.json"
    with open(predictions_path, "w") as fh:
        json.dump(all_predictions, fh, indent=2, default=str)
    log.info("Wrote %d predictions → %s", len(all_predictions), predictions_path)

    # 2. Summary JSON
    summary = aggregate_predictions(
        all_predictions=all_predictions,
        model_config={k: v for k, v in config.items() if not k.startswith("park_")},
        start_date=start_date,
        end_date=end_date,
        n_sims=n_sims,
    )
    # Also record park factors in a compact form
    summary["model_config"]["park_k_factors_used"] = config.get("park_k_factors", {})
    summary["model_config"]["park_tb_factors_used"] = config.get("park_tb_factors", {})

    summary_path = output_dir / f"backtest_summary_{slug}.json"
    with open(summary_path, "w") as fh:
        json.dump(summary, fh, indent=2, default=str)
    log.info("Wrote summary → %s", summary_path)

    # 3. Daily summary JSON
    daily = aggregate_daily(all_predictions)
    daily_path = output_dir / f"backtest_daily_{slug}.json"
    with open(daily_path, "w") as fh:
        json.dump(daily, fh, indent=2, default=str)
    log.info("Wrote daily summary → %s", daily_path)

    # ------------------------------------------------------------------ #
    # Optional Supabase upload
    # ------------------------------------------------------------------ #
    if upload:
        supabase_url = os.environ.get("SUPABASE_URL", "").strip()
        supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
        if not supabase_url or not supabase_key:
            log.warning("--upload requested but SUPABASE_URL / SUPABASE_SERVICE_KEY not set; skipping")
        elif not supabase_url.startswith("https://") or ".supabase.co" not in supabase_url:
            log.warning("Invalid SUPABASE_URL; skipping upload")
        else:
            log.info("Uploading backtest summary to Supabase…")
            now = datetime.utcnow().isoformat()

            # Build flat rows suitable for an accuracy_summary table
            upload_rows: list[dict] = []
            for pt, stats in summary.get("by_prop_type", {}).items():
                upload_rows.append({
                    "stat_type": f"mc_{pt.lower()}",
                    "period": f"backtest_{slug}",
                    "model_version": MODEL_VERSION,
                    "total_picks": stats.get("total"),
                    "hits": stats.get("hits"),
                    "misses": stats.get("misses"),
                    "hit_rate": stats.get("hit_rate"),
                    "avg_proj_error": stats.get("mae"),
                    "brier_score": stats.get("brier_score"),
                    "brier_naive": stats.get("brier_naive_baseline"),
                    "brier_skill": stats.get("brier_skill_score"),
                    "n_sims": n_sims,
                    "updated_at": now,
                })

            sb_upsert(supabase_url, supabase_key, "accuracy_summary", upload_rows)
            log.info("Upload complete")

    # ------------------------------------------------------------------ #
    # Print a quick report to stdout
    # ------------------------------------------------------------------ #
    _print_summary(summary)
    return summary


def _print_summary(summary: dict) -> None:
    """Print a formatted summary table to stdout."""
    print("\n" + "=" * 65)
    print("  BASELINE MLB — MONTE CARLO BACKTEST RESULTS")
    print(f"  {summary.get('start_date')} → {summary.get('end_date')}")
    print(f"  Simulations per player: {summary.get('n_sims', '?')}")
    print("=" * 65)

    total = summary.get("total_predictions", 0)
    print(f"\n  Total predictions: {total}")

    by_type = summary.get("by_prop_type", {})
    if by_type:
        print(f"\n  {'Prop':<6}  {'N':>5}  {'HitRate':>8}  {'MAE':>6}  {'Brier':>7}  {'Skill':>7}")
        print("  " + "-" * 52)
        for pt in sorted(by_type):
            s = by_type[pt]
            hr = f"{s['hit_rate']:.3f}" if s.get("hit_rate") is not None else "  N/A "
            mae = f"{s['mae']:.3f}" if s.get("mae") is not None else "  N/A"
            bs = f"{s['brier_score']:.4f}" if s.get("brier_score") is not None else "  N/A "
            sk = f"{s['brier_skill_score']:.3f}" if s.get("brier_skill_score") is not None else "  N/A "
            print(f"  {pt:<6}  {s['total']:>5}  {hr:>8}  {mae:>6}  {bs:>7}  {sk:>7}")

    pl = summary.get("overall_pl", {})
    if pl:
        print(f"\n  --- KELLY P/L (quarter Kelly, -110 juice) ---")
        print(f"  Bets placed:       {pl.get('bets_placed', 0)}")
        print(f"  Units won (net):   {pl.get('total_units_won', 0):+.3f}")
        print(f"  ROI:               {(pl.get('roi') or 0):+.1%}")

    tiers = summary.get("roi_by_confidence_tier", {})
    if tiers:
        print(f"\n  --- ROI BY CONFIDENCE TIER ---")
        for tier in ("A", "B", "C", "D"):
            if tier in tiers:
                t = tiers[tier]
                roi_str = f"{(t['roi'] or 0):+.1%}" if t.get("roi") is not None else "  N/A"
                print(f"  Tier {tier}  n={t['n_predictions']:4d}  bets={t['n_bets_placed']:4d}"
                      f"  win={t.get('win_rate') or 0:.1%}  ROI={roi_str}")

    print("\n" + "=" * 65)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Baseline MLB — Monte Carlo Simulation Backtest Engine",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--start", required=True, metavar="YYYY-MM-DD",
        help="Backtest start date (inclusive)",
    )
    parser.add_argument(
        "--end", required=True, metavar="YYYY-MM-DD",
        help="Backtest end date (inclusive)",
    )
    parser.add_argument(
        "--sims", type=int, default=3000,
        help="Number of Monte Carlo simulations per player per game (default: 3000)",
    )
    parser.add_argument(
        "--prop-types", default="K,TB,H,HR",
        help="Comma-separated prop types to simulate: K,TB,H,HR (default: all)",
    )
    parser.add_argument(
        "--output-dir", default="output/backtest",
        help="Directory for output files (default: output/backtest)",
    )
    parser.add_argument(
        "--upload", action="store_true",
        help="Upload summary to Supabase accuracy_summary table",
    )
    parser.add_argument(
        "--sample-days", type=int, default=None, metavar="N",
        help="Simulate only N evenly-spaced days (for faster testing)",
    )
    parser.add_argument(
        "--config", default=None, metavar="FILE",
        help="Path to JSON config file overriding model parameters",
    )
    parser.add_argument(
        "--no-umpire", action="store_true",
        help="Disable umpire factor (use neutral 1.0)",
    )
    parser.add_argument(
        "--no-weather", action="store_true",
        help="Disable weather factor (placeholder; no effect yet)",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for reproducibility (default: 42)",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Verbose logging (DEBUG level)",
    )
    return parser.parse_args()


def main() -> int:
    """Entry point for command-line use."""
    args = parse_args()

    # Validate dates
    try:
        start_dt = datetime.strptime(args.start, "%Y-%m-%d")
        end_dt = datetime.strptime(args.end, "%Y-%m-%d")
    except ValueError as exc:
        log.error("Invalid date format: %s", exc)
        return 1

    if end_dt < start_dt:
        log.error("--end must be >= --start")
        return 1

    # Parse prop types
    prop_types = [pt.strip().upper() for pt in args.prop_types.split(",")]
    valid = {"K", "TB", "H", "HR"}
    invalid = set(prop_types) - valid
    if invalid:
        log.error("Unknown prop types: %s (valid: K,TB,H,HR)", ",".join(invalid))
        return 1

    if args.sims < 100:
        log.warning("--sims=%d is very low; results may be noisy", args.sims)

    config = build_model_config(args, override_path=args.config)

    run_backtest(
        start_date=args.start,
        end_date=args.end,
        n_sims=args.sims,
        prop_types=prop_types,
        output_dir=Path(args.output_dir),
        upload=args.upload,
        sample_days=args.sample_days,
        config=config,
        seed=args.seed,
        verbose=args.verbose,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
fetch_statcast_historical.py — Full Count Props
Download full Statcast pitch-by-pitch data from Baseball Savant for
seasons 2020–2025. Aggregate pitch-level rows into plate-appearance
features suitable for training the Monte Carlo matchup model.

Data source: baseballsavant.mlb.com/statcast_search (public CSV endpoint)
Requests are chunked into weekly windows to avoid server timeouts and
rate-limited to ~1 request per 3 seconds.

Usage:
    # Full historical backfill (2020-2025)
    python pipeline/fetch_statcast_historical.py

    # Single season
    python pipeline/fetch_statcast_historical.py --start-year 2024 --end-year 2024

    # Custom date range
    python pipeline/fetch_statcast_historical.py --start-date 2024-06-01 --end-date 2024-06-30

    # Upload aggregated season stats to Supabase
    python pipeline/fetch_statcast_historical.py --upload-supabase

Output:
    data/statcast_pa_features_<start>_<end>.parquet
"""

import argparse
import logging
import sys
import time
from datetime import date, timedelta
from io import StringIO
from pathlib import Path

import numpy as np
import pandas as pd
import requests

# ── Project imports ─────────────────────────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from lib.supabase import sb_upsert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("fetch_statcast_historical")

# ── Constants ───────────────────────────────────────────────
SAVANT_URL = "https://baseballsavant.mlb.com/statcast_search/csv"
RATE_LIMIT_SECONDS = 3
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CHUNK_DAYS = 6  # 7-day window (start + 6)

# MLB season date ranges (approximate; Spring Training excluded)
SEASON_DATES = {
    2020: ("2020-07-23", "2020-10-27"),  # COVID shortened season
    2021: ("2021-04-01", "2021-11-02"),
    2022: ("2022-04-07", "2022-11-05"),
    2023: ("2023-03-30", "2023-11-01"),
    2024: ("2024-03-20", "2024-11-02"),
    2025: ("2025-03-18", "2025-10-31"),
}

# Pitch type groupings for feature engineering
PITCH_GROUPS = {
    "fastball": {"FF", "SI", "FC", "FA"},  # FC moved to cutter below
    "slider":   {"SL", "ST", "SV"},
    "curve":    {"CU", "KC", "CS"},
    "change":   {"CH", "FS", "FO", "SC"},
    "cutter":   {"FC"},
}
# Override: cutter is its own group; remove FC from fastball
PITCH_GROUPS["fastball"] = {"FF", "SI", "FA"}

# PA outcome mapping from Statcast 'events' column
PA_OUTCOME_MAP = {
    "strikeout":            "K",
    "strikeout_double_play": "K",
    "walk":                 "BB",
    "hit_by_pitch":         "HBP",
    "single":               "1B",
    "double":               "2B",
    "triple":               "3B",
    "home_run":             "HR",
    "field_out":            "out",
    "grounded_into_double_play": "out",
    "double_play":          "out",
    "force_out":            "out",
    "fielders_choice":      "out",
    "fielders_choice_out":  "out",
    "sac_fly":              "out",
    "sac_fly_double_play":  "out",
    "sac_bunt":             "out",
    "sac_bunt_double_play": "out",
    "field_error":          "out",  # Reached on error → treat as out for model
    "catcher_interf":       "other",
    "intent_walk":          "BB",
    "triple_play":          "out",
}

# Batted-ball type mapping from Statcast 'bb_type' column
BB_TYPE_MAP = {
    "ground_ball": "GB",
    "fly_ball":    "FB",
    "line_drive":  "LD",
    "popup":       "PU",
}


# ── Download helpers ─────────────────────────────────────────────

def _build_savant_params(start_dt: str, end_dt: str) -> dict:
    """Build query params for Baseball Savant CSV endpoint."""
    return {
        "all":             "true",
        "hfPT":            "",
        "hfAB":            "",
        "hfGT":            "R|",       # Regular season only
        "hfPR":            "",
        "hfZ":             "",
        "stadium":         "",
        "hfBBL":           "",
        "hfNewZones":      "",
        "hfPull":          "",
        "hfC":             "",
        "hfSea":           "",
        "hfSit":           "",
        "player_type":     "pitcher",
        "hfOuts":          "",
        "opponent":        "",
        "pitcher_throws":  "",
        "batter_stands":   "",
        "hfSA":            "",
        "game_date_gt":    start_dt,
        "game_date_lt":    end_dt,
        "hfInfield":       "",
        "team":            "",
        "position":        "",
        "hfOutfield":      "",
        "hfRO":            "",
        "home_road":       "",
        "hfFlag":          "",
        "hfBBT":           "",
        "metric_1":        "",
        "hfInn":           "",
        "min_pitches":     "0",
        "min_results":     "0",
        "group_by":        "name",
        "sort_col":        "pitches",
        "player_event_sort": "api_p_release_speed",
        "sort_order":      "desc",
        "min_pas":         "0",
        "type":            "details",
    }


def download_week(start_dt: str, end_dt: str, session: requests.Session) -> pd.DataFrame:
    """
    Download one week's worth of Statcast data from Baseball Savant.
    Returns a DataFrame or empty DataFrame on failure.
    """
    params = _build_savant_params(start_dt, end_dt)

    for attempt in range(3):
        try:
            log.debug(f"  Requesting {start_dt} → {end_dt} (attempt {attempt + 1})")
            resp = session.get(SAVANT_URL, params=params, timeout=90)

            if resp.status_code == 403:
                log.warning("  Rate limited (403). Waiting 30s ...")
                time.sleep(30)
                continue

            resp.raise_for_status()

            text = resp.text.strip()
            if not text or len(text) < 100:
                log.debug(f"  Empty response for {start_dt} → {end_dt}")
                return pd.DataFrame()

            df = pd.read_csv(StringIO(text), low_memory=False)
            if df.empty:
                return pd.DataFrame()

            log.info(f"  {start_dt} → {end_dt}: {len(df):,} pitches")
            return df

        except requests.exceptions.Timeout:
            log.warning(f"  Timeout on {start_dt} → {end_dt}, attempt {attempt + 1}")
            time.sleep(10)
        except Exception as e:
            log.warning(f"  Error on {start_dt} → {end_dt}: {e}")
            time.sleep(5)

    log.error(f"  Failed after 3 attempts: {start_dt} → {end_dt}")
    return pd.DataFrame()


def download_date_range(start: date, end: date) -> pd.DataFrame:
    """
    Download Statcast data for an entire date range, chunked into weekly
    windows with rate limiting.
    """
    session = requests.Session()
    session.headers.update({
        "User-Agent": "FullCountProps/1.0 (research; statcast backfill)"
    })

    chunks = []
    cursor = start

    total_weeks = ((end - start).days // (CHUNK_DAYS + 1)) + 1
    week_num = 0

    while cursor <= end:
        chunk_end = min(cursor + timedelta(days=CHUNK_DAYS), end)
        week_num += 1

        log.info(f"Week {week_num}/{total_weeks}: {cursor} → {chunk_end}")
        df = download_week(str(cursor), str(chunk_end), session)
        if not df.empty:
            chunks.append(df)

        cursor = chunk_end + timedelta(days=1)
        time.sleep(RATE_LIMIT_SECONDS)

    if not chunks:
        log.warning("No data downloaded.")
        return pd.DataFrame()

    combined = pd.concat(chunks, ignore_index=True)
    log.info(f"Total pitches downloaded: {len(combined):,}")
    return combined


# ── Feature engineering ─────────────────────────────────────────────

def _safe_div(num, denom, default=0.0):
    """Safe division, returning default when denominator is 0."""
    return num / denom if denom > 0 else default


def classify_pitch_group(pitch_type: str) -> str:
    """Map a Statcast pitch_type code to a simplified group."""
    if pd.isna(pitch_type):
        return "unknown"
    pt = str(pitch_type).strip().upper()
    for group, codes in PITCH_GROUPS.items():
        if pt in codes:
            return group
    return "other"


def _is_whiff(desc: str) -> bool:
    """Check if a pitch description is a swinging strike."""
    if pd.isna(desc):
        return False
    d = str(desc).lower()
    return "swinging_strike" in d or "foul_tip" in d


def _is_called_strike_or_whiff(desc: str) -> bool:
    """CSW: called strike or whiff."""
    if pd.isna(desc):
        return False
    d = str(desc).lower()
    return ("called_strike" in d or "swinging_strike" in d or "foul_tip" in d)


def _is_in_zone(zone) -> bool:
    """Zones 1-9 are in the strike zone per Statcast."""
    try:
        z = int(zone)
        return 1 <= z <= 9
    except (ValueError, TypeError):
        return False


def _is_swing(desc: str) -> bool:
    """Check if the batter swung."""
    if pd.isna(desc):
        return False
    d = str(desc).lower()
    swing_descs = {
        "swinging_strike", "swinging_strike_blocked", "foul", "foul_tip",
        "foul_bunt", "hit_into_play", "hit_into_play_no_out",
        "hit_into_play_score", "missed_bunt", "bunt_foul_tip",
    }
    return d in swing_descs


def _is_chase(desc: str, zone) -> bool:
    """Chase = swing at pitch outside the zone."""
    return _is_swing(desc) and not _is_in_zone(zone)


def compute_pitcher_features(group: pd.DataFrame) -> dict:
    """
    Compute aggregated pitcher features from pitch-level data for one PA's
    pitcher context. Called on the pitcher's full-season or rolling data.
    """
    n = len(group)
    if n == 0:
        return {}

    # Pitch mix
    groups = group["pitch_group"].value_counts(normalize=True)
    pitch_mix = {f"p_pct_{g}": round(groups.get(g, 0), 4)
                 for g in ["fastball", "slider", "curve", "change", "cutter"]}

    # Velocity
    velo = group["release_speed"].dropna()
    avg_velo = round(velo.mean(), 1) if len(velo) > 0 else None

    # SwStr%, CSW%, Zone%
    swstr_pct = round(_safe_div(group["is_whiff"].sum(), n), 4)
    csw_pct = round(_safe_div(group["is_csw"].sum(), n), 4)
    zone_pct = round(_safe_div(group["is_in_zone"].sum(), n), 4)

    # K%, BB% (need PA-level, approximate from events)
    events = group["events"].dropna()
    pa_events = events[events != ""]
    n_pa = len(pa_events)
    k_count = pa_events.isin(["strikeout", "strikeout_double_play"]).sum()
    bb_count = pa_events.isin(["walk", "intent_walk"]).sum()
    k_pct = round(_safe_div(k_count, n_pa), 4)
    bb_pct = round(_safe_div(bb_count, n_pa), 4)

    # Whiff rate by pitch type
    whiff_by_type = {}
    for pg in ["fastball", "slider", "curve", "change", "cutter"]:
        sub = group[group["pitch_group"] == pg]
        swings = sub["is_swing"].sum()
        whiffs = sub["is_whiff"].sum()
        whiff_by_type[f"p_whiff_{pg}"] = round(_safe_div(whiffs, swings), 4)

    # GB/FB/LD ratios
    bb_types = group["bb_type_code"].dropna()
    bb_total = len(bb_types[bb_types != ""])
    gb_rate = round(_safe_div((bb_types == "GB").sum(), bb_total), 4)
    fb_rate = round(_safe_div((bb_types == "FB").sum(), bb_total), 4)
    ld_rate = round(_safe_div((bb_types == "LD").sum(), bb_total), 4)

    features = {
        "p_avg_velo": avg_velo,
        "p_swstr_pct": swstr_pct,
        "p_csw_pct": csw_pct,
        "p_zone_pct": zone_pct,
        "p_k_pct": k_pct,
        "p_bb_pct": bb_pct,
        "p_gb_rate": gb_rate,
        "p_fb_rate": fb_rate,
        "p_ld_rate": ld_rate,
    }
    features.update(pitch_mix)
    features.update(whiff_by_type)
    return features


def compute_batter_features(group: pd.DataFrame) -> dict:
    """
    Compute aggregated batter features from pitch-level data.
    """
    n = len(group)
    if n == 0:
        return {}

    events = group["events"].dropna()
    pa_events = events[events != ""]
    n_pa = len(pa_events)

    k_count = pa_events.isin(["strikeout", "strikeout_double_play"]).sum()
    bb_count = pa_events.isin(["walk", "intent_walk"]).sum()
    k_pct = round(_safe_div(k_count, n_pa), 4)
    bb_pct = round(_safe_div(bb_count, n_pa), 4)

    # xBA, xSLG from Statcast expected stats
    xba = group["estimated_ba_using_speedangle"].dropna()
    xslg = group["estimated_slg_using_speedangle"].dropna()
    avg_xba = round(xba.mean(), 3) if len(xba) > 0 else None
    avg_xslg = round(xslg.mean(), 3) if len(xslg) > 0 else None

    # Barrel%
    barrels = group["launch_speed_angle"].dropna()
    n_bbe = len(group["launch_speed"].dropna())
    barrel_count = (barrels == 6).sum()  # 6 = barrel in Statcast
    barrel_pct = round(_safe_div(barrel_count, n_bbe), 4)

    # Chase rate, whiff%
    swings = group["is_swing"].sum()
    chases = group["is_chase"].sum()
    whiffs = group["is_whiff"].sum()
    chase_rate = round(_safe_div(chases, n - group["is_in_zone"].sum()), 4)
    whiff_pct = round(_safe_div(whiffs, swings), 4) if swings > 0 else 0.0

    # Exit velocity, hard hit%
    ev = group["launch_speed"].dropna()
    avg_ev = round(ev.mean(), 1) if len(ev) > 0 else None
    hard_hit_pct = round(_safe_div((ev >= 95).sum(), len(ev)), 4) if len(ev) > 0 else None

    return {
        "b_k_pct": k_pct,
        "b_bb_pct": bb_pct,
        "b_xba": avg_xba,
        "b_xslg": avg_xslg,
        "b_barrel_pct": barrel_pct,
        "b_chase_rate": chase_rate,
        "b_whiff_pct": whiff_pct,
        "b_avg_ev": avg_ev,
        "b_hard_hit_pct": hard_hit_pct,
    }


def build_pa_features(raw_df: pd.DataFrame) -> pd.DataFrame:
    """
    Transform raw pitch-level Statcast data into plate-appearance-level
    features. Each row = one PA with pitcher features, batter features,
    matchup context, and the PA outcome.
    """
    log.info("Engineering PA-level features ...")
    df = raw_df.copy()

    # ── Pre-compute pitch-level flags ────────────────────────────────────
    df["pitch_group"] = df["pitch_type"].apply(classify_pitch_group)
    df["is_whiff"] = df["description"].apply(_is_whiff)
    df["is_csw"] = df["description"].apply(_is_called_strike_or_whiff)
    df["is_in_zone"] = df["zone"].apply(_is_in_zone)
    df["is_swing"] = df["description"].apply(_is_swing)
    df["is_chase"] = df.apply(lambda r: _is_chase(r["description"], r["zone"]), axis=1)
    df["bb_type_code"] = df["bb_type"].map(BB_TYPE_MAP).fillna("")

    # Rename estimated stat columns if present with different names
    col_renames = {}
    if "estimated_ba_using_speedangle" not in df.columns and "xba" in df.columns:
        col_renames["xba"] = "estimated_ba_using_speedangle"
    if "estimated_slg_using_speedangle" not in df.columns and "xslg" in df.columns:
        col_renames["xslg"] = "estimated_slg_using_speedangle"
    if col_renames:
        df.rename(columns=col_renames, inplace=True)

    # Ensure expected stat columns exist
    for col in ["estimated_ba_using_speedangle", "estimated_slg_using_speedangle",
                 "launch_speed_angle"]:
        if col not in df.columns:
            df[col] = np.nan

    # ── Identify plate appearances ─────────────────────────────────────
    # A PA ends when 'events' is not null
    pa_mask = df["events"].notna() & (df["events"] != "")
    pa_pitches = df[pa_mask].copy()

    if pa_pitches.empty:
        log.warning("No completed plate appearances found in data.")
        return pd.DataFrame()

    log.info(f"Found {len(pa_pitches):,} completed plate appearances")

    # ── Map PA outcomes ──────────────────────────────────────────
    pa_pitches["pa_outcome"] = pa_pitches["events"].map(PA_OUTCOME_MAP).fillna("other")

    # Drop outcomes we can't model
    pa_pitches = pa_pitches[pa_pitches["pa_outcome"] != "other"].copy()

    # ── Build rolling pitcher features (season-to-date for each pitcher) ─
    log.info("Computing pitcher rolling stats ...")
    pitcher_season_groups = df.groupby(["pitcher", "game_year"])
    pitcher_cache = {}
    for (pid, year), grp in pitcher_season_groups:
        pitcher_cache[(pid, year)] = compute_pitcher_features(grp)

    # ── Build rolling batter features ────────────────────────────────
    log.info("Computing batter rolling stats ...")
    batter_season_groups = df.groupby(["batter", "game_year"])
    batter_cache = {}
    for (bid, year), grp in batter_season_groups:
        batter_cache[(bid, year)] = compute_batter_features(grp)

    # ── Assemble PA feature rows ───────────────────────────────────
    log.info("Assembling feature rows ...")
    rows = []
    for _, pa in pa_pitches.iterrows():
        pid = pa.get("pitcher")
        bid = pa.get("batter")
        year = pa.get("game_year")

        p_feats = pitcher_cache.get((pid, year), {})
        b_feats = batter_cache.get((bid, year), {})

        # Handedness
        p_throws = pa.get("p_throws", "R")
        b_stands = pa.get("stand", "R")
        platoon = "same" if p_throws == b_stands else "opposite"

        # Context
        score_diff = None
        try:
            home_score = pa.get("home_score", 0) or 0
            away_score = pa.get("away_score", 0) or 0
            # Score diff from batter's perspective
            if pa.get("inning_topbot") == "Top":
                score_diff = int(away_score) - int(home_score)
            else:
                score_diff = int(home_score) - int(away_score)
        except (ValueError, TypeError):
            pass

        # Men on base encoding
        on_1b = 1 if pd.notna(pa.get("on_1b")) else 0
        on_2b = 1 if pd.notna(pa.get("on_2b")) else 0
        on_3b = 1 if pd.notna(pa.get("on_3b")) else 0
        base_state = on_1b + on_2b * 2 + on_3b * 4  # Bitfield: 0-7

        row = {
            # IDs
            "game_pk":       pa.get("game_pk"),
            "game_date":     pa.get("game_date"),
            "game_year":     year,
            "pitcher_id":    pid,
            "batter_id":     bid,

            # Handedness
            "p_throws":      p_throws,
            "b_stands":      b_stands,
            "platoon":       platoon,

            # Context
            "park_id":       pa.get("home_team"),  # Use home_team as park proxy
            "inning":        pa.get("inning"),
            "score_diff":    score_diff,
            "base_state":    base_state,
            "outs":          pa.get("outs_when_up"),

            # Outcome
            "pa_outcome":    pa["pa_outcome"],

            # Batted ball (for outcomes that are BIP)
            "launch_speed":  pa.get("launch_speed"),
            "launch_angle":  pa.get("launch_angle"),
        }

        # Merge pitcher + batter features
        row.update(p_feats)
        row.update(b_feats)
        rows.append(row)

    result = pd.DataFrame(rows)
    log.info(f"Built {len(result):,} PA feature rows")
    return result


def aggregate_player_season_stats(pa_df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate PA-level features into player-season stats for Supabase upload.
    One row per (player_id, season, role).
    """
    if pa_df.empty:
        return pd.DataFrame()

    # Pitcher stats
    pitcher_stats = []
    for (pid, year), grp in pa_df.groupby(["pitcher_id", "game_year"]):
        n_pa = len(grp)
        outcomes = grp["pa_outcome"].value_counts()
        row = {
            "mlbam_id": int(pid),
            "season": int(year),
            "role": "pitcher",
            "pa_faced": n_pa,
            "k_pct": round(_safe_div(outcomes.get("K", 0), n_pa), 4),
            "bb_pct": round(_safe_div(outcomes.get("BB", 0), n_pa), 4),
            "hr_pct": round(_safe_div(outcomes.get("HR", 0), n_pa), 4),
            "avg_velo": grp["p_avg_velo"].dropna().iloc[0] if "p_avg_velo" in grp.columns and not grp["p_avg_velo"].dropna().empty else None,
            "swstr_pct": grp["p_swstr_pct"].dropna().iloc[0] if "p_swstr_pct" in grp.columns and not grp["p_swstr_pct"].dropna().empty else None,
            "csw_pct": grp["p_csw_pct"].dropna().iloc[0] if "p_csw_pct" in grp.columns and not grp["p_csw_pct"].dropna().empty else None,
            "zone_pct": grp["p_zone_pct"].dropna().iloc[0] if "p_zone_pct" in grp.columns and not grp["p_zone_pct"].dropna().empty else None,
            "gb_rate": grp["p_gb_rate"].dropna().iloc[0] if "p_gb_rate" in grp.columns and not grp["p_gb_rate"].dropna().empty else None,
            "fb_rate": grp["p_fb_rate"].dropna().iloc[0] if "p_fb_rate" in grp.columns and not grp["p_fb_rate"].dropna().empty else None,
            "updated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        }
        pitcher_stats.append(row)

    # Batter stats
    batter_stats = []
    for (bid, year), grp in pa_df.groupby(["batter_id", "game_year"]):
        n_pa = len(grp)
        outcomes = grp["pa_outcome"].value_counts()
        row = {
            "mlbam_id": int(bid),
            "season": int(year),
            "role": "batter",
            "pa_faced": n_pa,
            "k_pct": round(_safe_div(outcomes.get("K", 0), n_pa), 4),
            "bb_pct": round(_safe_div(outcomes.get("BB", 0), n_pa), 4),
            "hr_pct": round(_safe_div(outcomes.get("HR", 0), n_pa), 4),
            "avg_ev": grp["b_avg_ev"].dropna().iloc[0] if "b_avg_ev" in grp.columns and not grp["b_avg_ev"].dropna().empty else None,
            "barrel_pct": grp["b_barrel_pct"].dropna().iloc[0] if "b_barrel_pct" in grp.columns and not grp["b_barrel_pct"].dropna().empty else None,
            "chase_rate": grp["b_chase_rate"].dropna().iloc[0] if "b_chase_rate" in grp.columns and not grp["b_chase_rate"].dropna().empty else None,
            "whiff_pct": grp["b_whiff_pct"].dropna().iloc[0] if "b_whiff_pct" in grp.columns and not grp["b_whiff_pct"].dropna().empty else None,
            "xba": grp["b_xba"].dropna().iloc[0] if "b_xba" in grp.columns and not grp["b_xba"].dropna().empty else None,
            "xslg": grp["b_xslg"].dropna().iloc[0] if "b_xslg" in grp.columns and not grp["b_xslg"].dropna().empty else None,
            "hard_hit_pct": grp["b_hard_hit_pct"].dropna().iloc[0] if "b_hard_hit_pct" in grp.columns and not grp["b_hard_hit_pct"].dropna().empty else None,
            "updated_at": pd.Timestamp.now(tz="UTC").isoformat(),
        }
        batter_stats.append(row)

    all_stats = pitcher_stats + batter_stats
    return pd.DataFrame(all_stats)


# ── CLI ───────────────────────────────────────────────

def parse_args():
    parser = argparse.ArgumentParser(
        description="Download Statcast historical data and build PA features."
    )
    parser.add_argument(
        "--start-year", type=int, default=2020,
        help="First season to download (default: 2020)"
    )
    parser.add_argument(
        "--end-year", type=int, default=2025,
        help="Last season to download (default: 2025)"
    )
    parser.add_argument(
        "--start-date", type=str, default=None,
        help="Override start date (YYYY-MM-DD). Ignores --start-year."
    )
    parser.add_argument(
        "--end-date", type=str, default=None,
        help="Override end date (YYYY-MM-DD). Ignores --end-year."
    )
    parser.add_argument(
        "--upload-supabase", action="store_true",
        help="Upload aggregated season stats to Supabase."
    )
    parser.add_argument(
        "--raw-only", action="store_true",
        help="Save raw pitches without PA feature engineering."
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Override output parquet filename."
    )
    return parser.parse_args()


def main():
    args = parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    # Determine date range
    if args.start_date and args.end_date:
        start = date.fromisoformat(args.start_date)
        end = date.fromisoformat(args.end_date)
        label = f"{args.start_date}_{args.end_date}"
    else:
        # Build from season ranges
        start_year = args.start_year
        end_year = min(args.end_year, date.today().year)
        start = date.fromisoformat(SEASON_DATES.get(start_year, (f"{start_year}-03-20",))[0])
        end_str = SEASON_DATES.get(end_year, (None, f"{end_year}-10-31"))[1]
        end = min(date.fromisoformat(end_str), date.today())
        label = f"{start_year}_{end_year}"

    log.info(f"=== Statcast Historical Download: {start} → {end} ===")

    # Download
    raw_df = download_date_range(start, end)
    if raw_df.empty:
        log.error("No data downloaded. Exiting.")
        sys.exit(1)

    # Optionally save raw data
    if args.raw_only:
        out_path = DATA_DIR / (args.output or f"statcast_raw_{label}.parquet")
        raw_df.to_parquet(out_path, index=False, engine="pyarrow")
        log.info(f"Saved raw data: {out_path} ({len(raw_df):,} rows)")
        return

    # Feature engineering
    pa_df = build_pa_features(raw_df)
    if pa_df.empty:
        log.error("No PA features built. Exiting.")
        sys.exit(1)

    # Save parquet
    out_path = DATA_DIR / (args.output or f"statcast_pa_features_{label}.parquet")
    pa_df.to_parquet(out_path, index=False, engine="pyarrow")
    log.info(f"Saved PA features: {out_path} ({len(pa_df):,} rows)")

    # Optionally upload aggregated stats to Supabase
    if args.upload_supabase:
        log.info("Aggregating player season stats for Supabase ...")
        agg_df = aggregate_player_season_stats(pa_df)
        if not agg_df.empty:
            rows = agg_df.to_dict(orient="records")
            # Replace NaN with None for JSON serialization
            for row in rows:
                for k, v in row.items():
                    if pd.isna(v):
                        row[k] = None
            sb_upsert("player_season_stats", rows)
            log.info(f"Uploaded {len(rows)} player-season stat rows to Supabase.")

    # Print summary
    log.info("=== Summary ===")
    log.info(f"  Total PAs:     {len(pa_df):,}")
    log.info(f"  Seasons:       {pa_df['game_year'].nunique()}")
    log.info(f"  Pitchers:      {pa_df['pitcher_id'].nunique():,}")
    log.info(f"  Batters:       {pa_df['batter_id'].nunique():,}")
    log.info("  Outcome dist:")
    for outcome, count in pa_df["pa_outcome"].value_counts().items():
        log.info(f"    {outcome:>5s}: {count:>8,} ({count/len(pa_df)*100:.1f}%)")


if __name__ == "__main__":
    main()

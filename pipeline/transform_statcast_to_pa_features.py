#!/usr/bin/env python3
"""
transform_statcast_to_pa_features.py
=====================================
Transform raw pitch-by-pitch Statcast data (from pybaseball) into the
PA-level feature matrix expected by pipeline/build_training_dataset.py.

Raw Statcast has one row per pitch. This script:
  1. Computes per-pitcher and per-batter season-aggregate stats
  2. Identifies one row per plate appearance (PA-ending pitches)
  3. Joins player stats onto each PA
  4. Maps Statcast 'events' to our 8-class outcome labels
  5. Writes the result to a parquet file

Usage:
    python pipeline/transform_statcast_to_pa_features.py \
        --input  data/statcast/statcast_2024.parquet \
        --output data/statcast_pa_features_2024_2024.parquet
"""

import argparse
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("transform_statcast")

# ── Pitch type groups ────────────────────────────────────────────────────────
FASTBALL_TYPES = {"FF", "FT", "SI", "FA"}
SLIDER_TYPES   = {"SL", "ST"}
CURVE_TYPES    = {"CU", "KC", "CS"}
CHANGE_TYPES   = {"CH", "FS", "FO", "SC"}
CUTTER_TYPES   = {"FC"}

# ── Pitch description flags ──────────────────────────────────────────────────
SWSTR_DESCS = {"swinging_strike", "swinging_strike_blocked", "foul_tip"}
SWING_DESCS = {
    "swinging_strike", "swinging_strike_blocked", "foul_tip",
    "foul", "foul_bunt", "missed_bunt", "hit_into_play",
}

# ── Outcome mapping ──────────────────────────────────────────────────────────
# Statcast 'events' → our 8 classes
OUTCOME_MAP = {
    "strikeout":                "K",
    "strikeout_double_play":    "K",
    "walk":                     "BB",
    "intent_walk":              "BB",
    "hit_by_pitch":             "HBP",
    "single":                   "1B",
    "double":                   "2B",
    "triple":                   "3B",
    "home_run":                 "HR",
    # everything else → "out" (handled by .fillna("out") below)
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _add_pitch_flags(df: pd.DataFrame) -> pd.DataFrame:
    """Add boolean indicator columns used for stat aggregation."""
    df = df.copy()
    df["_is_swstr"]     = df["description"].isin(SWSTR_DESCS)
    df["_is_called_str"]= df["description"] == "called_strike"
    df["_in_zone"]      = df["zone"].between(1, 9, inclusive="both")
    df["_oozone"]       = df["zone"].between(11, 14, inclusive="both")
    df["_is_swing"]     = df["description"].isin(SWING_DESCS)
    df["_is_bip"]       = df["description"] == "hit_into_play"
    df["_is_gb"]        = df["bb_type"] == "ground_ball"
    df["_is_fb_bip"]    = df["bb_type"].isin(["fly_ball", "popup"])
    df["_is_ld"]        = df["bb_type"] == "line_drive"
    df["_is_fastball"]  = df["pitch_type"].isin(FASTBALL_TYPES)
    df["_is_slider"]    = df["pitch_type"].isin(SLIDER_TYPES)
    df["_is_curve"]     = df["pitch_type"].isin(CURVE_TYPES)
    df["_is_change"]    = df["pitch_type"].isin(CHANGE_TYPES)
    df["_is_cutter"]    = df["pitch_type"].isin(CUTTER_TYPES)
    df["_hard_hit"]     = df["launch_speed"].fillna(0) >= 95
    df["_chase"]        = df["_oozone"] & df["_is_swing"]
    # Barrel: Statcast encodes barrel as launch_speed_angle == 6
    # (1=Weak, 2=Topped, 3=Under, 4=Flare/Burner, 5=Solid Contact, 6=Barrel)
    if "barrel" in df.columns:
        df["_barrel"] = df["barrel"].fillna(0).astype(bool)
    elif "launch_speed_angle" in df.columns:
        df["_barrel"] = df["launch_speed_angle"] == 6
    else:
        df["_barrel"] = False
    return df


def _safe_rate(num: pd.Series, den: pd.Series) -> np.ndarray:
    """Element-wise division; returns NaN where denominator == 0."""
    return np.where(den.values > 0, num.values / den.values, np.nan)


# ── Pitcher season stats ─────────────────────────────────────────────────────

def pitcher_season_stats(pitches: pd.DataFrame) -> pd.DataFrame:
    """Return one row per pitcher with season-aggregate features."""
    log.info("  Computing pitcher season stats ...")

    g = pitches.groupby("pitcher")

    s = pd.DataFrame({
        "n_pitches":    g.size(),
        "n_swstr":      g["_is_swstr"].sum(),
        "n_called_str": g["_is_called_str"].sum(),
        "n_zone":       g["_in_zone"].sum(),
        "n_bip":        g["_is_bip"].sum(),
        "n_gb":         g["_is_gb"].sum(),
        "n_fb_bip":     g["_is_fb_bip"].sum(),
        "n_ld":         g["_is_ld"].sum(),
        "n_fastball":   g["_is_fastball"].sum(),
        "n_slider":     g["_is_slider"].sum(),
        "n_curve":      g["_is_curve"].sum(),
        "n_change":     g["_is_change"].sum(),
        "n_cutter":     g["_is_cutter"].sum(),
    })

    # Fastball velocity (only on fastball pitches)
    fb = pitches[pitches["_is_fastball"]]
    s["avg_velo_fb"] = (
        fb.groupby("pitcher")["release_speed"].mean()
        .reindex(s.index)
    )

    # Per-pitch-type swing / whiff counts
    for flag_col, suffix in [
        ("_is_fastball", "fb"), ("_is_slider", "sl"), ("_is_curve", "cu"),
        ("_is_change", "ch"), ("_is_cutter", "fc"),
    ]:
        subset = pitches[pitches[flag_col]]
        if len(subset) > 0:
            sg = subset.groupby("pitcher")
            s[f"n_swing_{suffix}"] = sg["_is_swing"].sum().reindex(s.index, fill_value=0)
            s[f"n_swstr_{suffix}"] = sg["_is_swstr"].sum().reindex(s.index, fill_value=0)
        else:
            s[f"n_swing_{suffix}"] = 0
            s[f"n_swstr_{suffix}"] = 0

    # PA-level K% / BB%
    pa = pitches[pitches["events"].notna()].copy()
    pa["_is_k"]  = pa["events"].isin(["strikeout", "strikeout_double_play"])
    pa["_is_bb"] = pa["events"].isin(["walk", "intent_walk"])
    pg = pa.groupby("pitcher")
    s["n_pa"] = pg.size().reindex(s.index, fill_value=0)
    s["n_k"]  = pg["_is_k"].sum().reindex(s.index, fill_value=0)
    s["n_bb"] = pg["_is_bb"].sum().reindex(s.index, fill_value=0)

    # Fill count NaNs with 0 (rate columns keep NaN for players w/ insufficient data)
    count_cols = [c for c in s.columns if c.startswith("n_")]
    s[count_cols] = s[count_cols].fillna(0)

    # Build output feature columns
    out = pd.DataFrame(index=s.index)
    out.index.name = "pitcher_id"
    out["p_avg_velo"]       = s["avg_velo_fb"]
    out["p_swstr_pct"]      = _safe_rate(s["n_swstr"], s["n_pitches"])
    out["p_csw_pct"]        = _safe_rate(s["n_swstr"] + s["n_called_str"], s["n_pitches"])
    out["p_zone_pct"]       = _safe_rate(s["n_zone"], s["n_pitches"])
    out["p_k_pct"]          = _safe_rate(s["n_k"], s["n_pa"])
    out["p_bb_pct"]         = _safe_rate(s["n_bb"], s["n_pa"])
    out["p_gb_rate"]        = _safe_rate(s["n_gb"], s["n_bip"])
    out["p_fb_rate"]        = _safe_rate(s["n_fb_bip"], s["n_bip"])
    out["p_ld_rate"]        = _safe_rate(s["n_ld"], s["n_bip"])
    out["p_pct_fastball"]   = _safe_rate(s["n_fastball"], s["n_pitches"])
    out["p_pct_slider"]     = _safe_rate(s["n_slider"], s["n_pitches"])
    out["p_pct_curve"]      = _safe_rate(s["n_curve"], s["n_pitches"])
    out["p_pct_change"]     = _safe_rate(s["n_change"], s["n_pitches"])
    out["p_pct_cutter"]     = _safe_rate(s["n_cutter"], s["n_pitches"])
    out["p_whiff_fastball"] = _safe_rate(s["n_swstr_fb"], s["n_swing_fb"])
    out["p_whiff_slider"]   = _safe_rate(s["n_swstr_sl"], s["n_swing_sl"])
    out["p_whiff_curve"]    = _safe_rate(s["n_swstr_cu"], s["n_swing_cu"])
    out["p_whiff_change"]   = _safe_rate(s["n_swstr_ch"], s["n_swing_ch"])
    out["p_whiff_cutter"]   = _safe_rate(s["n_swstr_fc"], s["n_swing_fc"])

    result = out.reset_index()
    log.info("    → stats for %d pitchers", len(result))
    return result


# ── Batter season stats ──────────────────────────────────────────────────────

def batter_season_stats(pitches: pd.DataFrame) -> pd.DataFrame:
    """Return one row per batter with season-aggregate features."""
    log.info("  Computing batter season stats ...")

    g = pitches.groupby("batter")

    s = pd.DataFrame({
        "n_pitches": g.size(),
        "n_swstr":   g["_is_swstr"].sum(),
        "n_swing":   g["_is_swing"].sum(),
        "n_oozone":  g["_oozone"].sum(),
        "n_chase":   g["_chase"].sum(),
    })

    bip = pitches[pitches["_is_bip"]]
    bip_g = bip.groupby("batter")
    s["n_bip"]   = bip_g.size().reindex(s.index, fill_value=0)
    s["n_hard"]  = bip_g["_hard_hit"].sum().reindex(s.index, fill_value=0)
    s["n_barrel"]= bip_g["_barrel"].sum().reindex(s.index, fill_value=0)
    s["avg_ev"]  = bip_g["launch_speed"].mean().reindex(s.index)

    # xBA / xSLG: mean over all pitches (mostly NaN except on BIP)
    s["b_xba"]  = g["estimated_ba_using_speedangle"].mean()
    s["b_xslg"] = g["estimated_slg_using_speedangle"].mean()

    # PA-level K% / BB%
    pa = pitches[pitches["events"].notna()].copy()
    pa["_is_k"]  = pa["events"].isin(["strikeout", "strikeout_double_play"])
    pa["_is_bb"] = pa["events"].isin(["walk", "intent_walk"])
    bg = pa.groupby("batter")
    s["n_pa"] = bg.size().reindex(s.index, fill_value=0)
    s["n_k"]  = bg["_is_k"].sum().reindex(s.index, fill_value=0)
    s["n_bb"] = bg["_is_bb"].sum().reindex(s.index, fill_value=0)

    count_cols = [c for c in s.columns if c.startswith("n_")]
    s[count_cols] = s[count_cols].fillna(0)

    out = pd.DataFrame(index=s.index)
    out.index.name = "batter_id"
    out["b_k_pct"]       = _safe_rate(s["n_k"],    s["n_pa"])
    out["b_bb_pct"]      = _safe_rate(s["n_bb"],   s["n_pa"])
    out["b_xba"]         = s["b_xba"]
    out["b_xslg"]        = s["b_xslg"]
    out["b_barrel_pct"]  = _safe_rate(s["n_barrel"], s["n_bip"])
    out["b_chase_rate"]  = _safe_rate(s["n_chase"],  s["n_oozone"])
    out["b_whiff_pct"]   = _safe_rate(s["n_swstr"], s["n_swing"])
    out["b_avg_ev"]      = s["avg_ev"]
    out["b_hard_hit_pct"]= _safe_rate(s["n_hard"],  s["n_bip"])

    result = out.reset_index()
    log.info("    → stats for %d batters", len(result))
    return result


# ── PA-level rows ─────────────────────────────────────────────────────────────

def build_pa_rows(df: pd.DataFrame) -> pd.DataFrame:
    """Extract one row per PA from pitch-by-pitch data."""
    log.info("  Extracting PA-ending rows ...")

    pa_df = df[df["events"].notna()].copy()
    pa_df["pa_outcome"] = pa_df["events"].map(OUTCOME_MAP).fillna("out")

    # Score differential from batting team's perspective
    if {"bat_score", "fld_score"}.issubset(pa_df.columns):
        pa_df["score_diff"] = (pa_df["bat_score"] - pa_df["fld_score"]).fillna(0).astype(int)
    else:
        pa_df["score_diff"] = 0

    pa_df = pa_df.rename(columns={
        "pitcher": "pitcher_id",
        "batter":  "batter_id",
        "stand":   "b_stands",
    })

    keep = ["pitcher_id", "batter_id", "p_throws", "b_stands",
            "pa_outcome", "game_year", "inning", "score_diff"]
    result = pa_df[[c for c in keep if c in pa_df.columns]].copy()

    # Context features we can't derive from pitch data alone
    # (filled with league-average / neutral placeholders;
    #  build_training_dataset.py will fill any remaining NaNs with medians)
    result["park_factor_hr"]   = 1.0
    result["park_factor_hit"]  = 1.0
    result["temp_f"]           = 72.0   # ~league average game-time temp
    result["wind_mph"]         = 5.0
    result["wind_out"]         = 0
    result["umpire_k_delta"]   = 0.0
    result["umpire_bb_delta"]  = 0.0

    log.info("    → %d PA rows", len(result))
    return result.reset_index(drop=True)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Transform raw Statcast pitch data into PA-level feature rows."
    )
    parser.add_argument(
        "--input", required=True,
        help="Path to raw Statcast parquet (pitch-by-pitch, from pybaseball)."
    )
    parser.add_argument(
        "--output", required=True,
        help="Output path for the PA-level features parquet."
    )
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        log.error("Input not found: %s", input_path)
        sys.exit(1)

    log.info("Loading %s ...", input_path)
    df = pd.read_parquet(input_path)
    log.info("  %d pitches, %d columns", len(df), df.shape[1])

    # Ensure game_year exists
    if "game_year" not in df.columns:
        if "game_date" in df.columns:
            df["game_year"] = pd.to_datetime(df["game_date"]).dt.year
        else:
            log.error("Cannot determine game_year — 'game_year' and 'game_date' both absent.")
            sys.exit(1)

    df = _add_pitch_flags(df)

    p_stats = pitcher_season_stats(df)
    b_stats = batter_season_stats(df)
    pa_rows = build_pa_rows(df)

    # Join player stats onto each PA
    pa_rows = pa_rows.merge(p_stats, on="pitcher_id", how="left")
    pa_rows = pa_rows.merge(b_stats, on="batter_id", how="left")

    # Drop rows with no outcome (shouldn't occur, but defensive)
    pa_rows = pa_rows[pa_rows["pa_outcome"].notna()].reset_index(drop=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    pa_rows.to_parquet(output_path, index=False)

    log.info("Saved %d PA feature rows to %s", len(pa_rows), output_path)
    log.info("Outcome distribution:\n%s", pa_rows["pa_outcome"].value_counts().to_string())
    log.info("Columns: %s", sorted(pa_rows.columns.tolist()))


if __name__ == "__main__":
    main()

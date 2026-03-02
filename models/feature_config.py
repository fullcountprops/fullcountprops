#!/usr/bin/env python3
"""
feature_config.py — BaselineMLB Matchup Model

Centralized definitions for:
  - Feature column names and groupings
  - Plate appearance outcome labels
  - Default / fallback values for missing data
  - Feature metadata (descriptions, expected ranges)

Every module in models/ imports from here so column names are never
hard-coded in multiple places.
"""

from collections import OrderedDict

# ── Plate Appearance Outcome Classes ─────────────────────────────────────
# These are the 11 mutually exclusive outcomes the model predicts.
# Order matters: this is the label encoding used by LightGBM.

PA_OUTCOMES = [
    "strikeout",
    "walk",
    "hit_by_pitch",
    "single",
    "double",
    "triple",
    "home_run",
    "flyout",
    "groundout",
    "lineout",
    "popup",
]

OUTCOME_TO_IDX = {label: i for i, label in enumerate(PA_OUTCOMES)}
IDX_TO_OUTCOME = {i: label for i, label in enumerate(PA_OUTCOMES)}
NUM_CLASSES = len(PA_OUTCOMES)

# Short display names for charts / SHAP plots
OUTCOME_SHORT = {
    "strikeout": "K",
    "walk": "BB",
    "hit_by_pitch": "HBP",
    "single": "1B",
    "double": "2B",
    "triple": "3B",
    "home_run": "HR",
    "flyout": "FO",
    "groundout": "GO",
    "lineout": "LO",
    "popup": "PU",
}


# ── Feature Groups ───────────────────────────────────────────────────────
# Organized by source / meaning.  Each tuple: (column_name, description, dtype)

PITCHER_FEATURES = OrderedDict([
    ("p_k_pct",           ("Pitcher K%",                                "float")),
    ("p_bb_pct",          ("Pitcher BB%",                               "float")),
    ("p_swstr_pct",       ("Pitcher SwStr% (swinging-strike rate)",     "float")),
    ("p_csw_pct",         ("Pitcher CSW% (called + swinging strikes)",  "float")),
    ("p_zone_pct",        ("Pitcher zone% (pitches in zone)",           "float")),
    ("p_whiff_fastball",  ("Whiff rate on fastballs",                   "float")),
    ("p_whiff_breaking",  ("Whiff rate on breaking balls",              "float")),
    ("p_whiff_offspeed",  ("Whiff rate on offspeed pitches",            "float")),
    ("p_ff_pct",          ("4-seam fastball usage %",                   "float")),
    ("p_si_pct",          ("Sinker usage %",                            "float")),
    ("p_sl_pct",          ("Slider usage %",                            "float")),
    ("p_cu_pct",          ("Curveball usage %",                         "float")),
    ("p_ch_pct",          ("Changeup usage %",                          "float")),
    ("p_fc_pct",          ("Cutter usage %",                            "float")),
    ("p_ff_velo",         ("4-seam fastball avg velocity",              "float")),
    ("p_stuff_plus",      ("Pitcher Stuff+ (if available)",             "float")),
])

BATTER_FEATURES = OrderedDict([
    ("b_k_pct",           ("Batter K%",                                 "float")),
    ("b_bb_pct",          ("Batter BB%",                                "float")),
    ("b_xba",             ("Batter expected batting avg (xBA)",         "float")),
    ("b_xslg",            ("Batter expected slugging (xSLG)",           "float")),
    ("b_barrel_pct",      ("Batter barrel%",                            "float")),
    ("b_chase_pct",       ("Batter chase rate (O-Swing%)",              "float")),
    ("b_avg_exit_velo",   ("Batter avg exit velocity",                  "float")),
    ("b_hard_hit_pct",    ("Batter hard-hit% (95+ mph)",                "float")),
    ("b_gb_pct",          ("Batter ground ball%",                       "float")),
    ("b_fb_pct",          ("Batter fly ball%",                          "float")),
    ("b_pull_pct",        ("Batter pull%",                              "float")),
])

MATCHUP_FEATURES = OrderedDict([
    ("platoon",           ("Platoon indicator: 1=same hand, 0=diff",    "int")),
    ("platoon_advantage", ("1=pitcher has platoon adv, -1=batter, 0=neutral", "int")),
])

PARK_FEATURES = OrderedDict([
    ("park_factor_r",     ("Park factor for runs (100 = neutral)",      "float")),
    ("park_factor_hr",    ("Park factor for HR (100 = neutral)",        "float")),
    ("park_factor_k",     ("Park factor for strikeouts",                "float")),
    ("park_factor_h",     ("Park factor for hits",                      "float")),
])

UMPIRE_FEATURES = OrderedDict([
    ("ump_ez_rate",       ("Umpire expanded zone rate",                 "float")),
    ("ump_k_boost",       ("Umpire K% above/below average",            "float")),
])

CATCHER_FEATURES = OrderedDict([
    ("c_framing_runs",    ("Catcher framing runs above average",        "float")),
    ("c_strike_rate",     ("Catcher called-strike rate",                "float")),
])

CONTEXT_FEATURES = OrderedDict([
    ("temp_f",            ("Game temperature (Fahrenheit)",              "float")),
    ("wind_mph",          ("Wind speed (mph)",                          "float")),
    ("wind_in",           ("1=wind blowing in, 0=out/cross/dome",       "int")),
    ("game_total",        ("Vegas game total (O/U line)",                "float")),
])


# ── Combined Feature List (training order) ───────────────────────────────

def get_all_feature_defs():
    """Return ordered dict of ALL features used in training."""
    combined = OrderedDict()
    combined.update(PITCHER_FEATURES)
    combined.update(BATTER_FEATURES)
    combined.update(MATCHUP_FEATURES)
    combined.update(PARK_FEATURES)
    combined.update(UMPIRE_FEATURES)
    combined.update(CATCHER_FEATURES)
    combined.update(CONTEXT_FEATURES)
    return combined


def get_feature_names():
    """Return ordered list of all feature column names."""
    return list(get_all_feature_defs().keys())


FEATURE_NAMES = get_feature_names()
NUM_FEATURES = len(FEATURE_NAMES)


# ── Default / Fallback Values ────────────────────────────────────────────
# Used when a feature is missing in the parquet (e.g., no umpire data
# assigned yet, no weather data). LightGBM can handle NaN natively,
# but explicit defaults help during feature engineering.

FEATURE_DEFAULTS = {
    # Pitcher — MLB 2024 averages
    "p_k_pct":           0.224,
    "p_bb_pct":          0.082,
    "p_swstr_pct":       0.112,
    "p_csw_pct":         0.293,
    "p_zone_pct":        0.445,
    "p_whiff_fastball":  0.22,
    "p_whiff_breaking":  0.33,
    "p_whiff_offspeed":  0.30,
    "p_ff_pct":          0.33,
    "p_si_pct":          0.15,
    "p_sl_pct":          0.20,
    "p_cu_pct":          0.10,
    "p_ch_pct":          0.12,
    "p_fc_pct":          0.10,
    "p_ff_velo":         93.5,
    "p_stuff_plus":      100.0,
    # Batter — MLB 2024 averages
    "b_k_pct":           0.224,
    "b_bb_pct":          0.082,
    "b_xba":             0.248,
    "b_xslg":            0.397,
    "b_barrel_pct":      0.068,
    "b_chase_pct":       0.295,
    "b_avg_exit_velo":   88.3,
    "b_hard_hit_pct":    0.364,
    "b_gb_pct":          0.43,
    "b_fb_pct":          0.35,
    "b_pull_pct":        0.40,
    # Matchup
    "platoon":           0,
    "platoon_advantage": 0,
    # Park factors (100 = neutral)
    "park_factor_r":     100.0,
    "park_factor_hr":    100.0,
    "park_factor_k":     100.0,
    "park_factor_h":     100.0,
    # Umpire
    "ump_ez_rate":       0.0,
    "ump_k_boost":       0.0,
    # Catcher
    "c_framing_runs":    0.0,
    "c_strike_rate":     0.32,
    # Context
    "temp_f":            72.0,
    "wind_mph":          6.0,
    "wind_in":           0,
    "game_total":        8.5,
}


# ── Target Column ────────────────────────────────────────────────────────

TARGET_COL = "pa_outcome"

# Column that holds the raw event string before encoding
RAW_EVENT_COL = "events"

# Date column for temporal splitting
DATE_COL = "game_date"


# ── League-Average Outcome Distribution ──────────────────────────────────
# 2020-2024 approximate MLB averages (used as naive baseline).

LEAGUE_AVG_PROBS = {
    "strikeout":    0.224,
    "walk":         0.082,
    "hit_by_pitch": 0.012,
    "single":       0.152,
    "double":       0.044,
    "triple":       0.004,
    "home_run":     0.031,
    "flyout":       0.170,
    "groundout":    0.183,
    "lineout":      0.065,
    "popup":        0.033,
}

# Sanity check
assert abs(sum(LEAGUE_AVG_PROBS.values()) - 1.0) < 0.01, \
    f"League avg probs should sum to ~1.0, got {sum(LEAGUE_AVG_PROBS.values()):.3f}"


# ── Statcast Event-Name Mapping ──────────────────────────────────────────
# Maps the raw Statcast `events` column values → our 11-class labels.

EVENT_MAP = {
    # Strikeouts
    "strikeout":             "strikeout",
    "strikeout_double_play": "strikeout",
    # Walks
    "walk":                  "walk",
    "intent_walk":           "walk",
    # HBP
    "hit_by_pitch":          "hit_by_pitch",
    # Hits
    "single":                "single",
    "double":                "double",
    "triple":                "triple",
    "home_run":              "home_run",
    # Outs — map by bb_type (batted ball type) or default
    "field_out":             "_by_bb_type",   # resolved dynamically
    "force_out":             "groundout",
    "grounded_into_double_play": "groundout",
    "double_play":           "groundout",
    "fielders_choice":       "groundout",
    "fielders_choice_out":   "groundout",
    "sac_fly":               "flyout",
    "sac_fly_double_play":   "flyout",
    "sac_bunt":              "groundout",
    "sac_bunt_double_play":  "groundout",
    "triple_play":           "groundout",
}

# For "field_out" events, use bb_type to classify
BB_TYPE_MAP = {
    "fly_ball":    "flyout",
    "ground_ball": "groundout",
    "line_drive":  "lineout",
    "popup":       "popup",
}


def map_event(event: str, bb_type: str = None) -> str:
    """
    Map a raw Statcast event string to one of our 11 PA outcome classes.

    Args:
        event:   Value from the Statcast `events` column
        bb_type: Value from the Statcast `bb_type` column (for field outs)

    Returns:
        One of PA_OUTCOMES, or None if the event should be excluded
        (e.g., caught_stealing, pickoff — not a PA outcome).
    """
    if not event:
        return None

    mapped = EVENT_MAP.get(event)

    if mapped is None:
        return None   # event not a PA outcome (e.g., caught_stealing)

    if mapped == "_by_bb_type":
        return BB_TYPE_MAP.get(bb_type, "flyout")  # default field_out → flyout

    return mapped

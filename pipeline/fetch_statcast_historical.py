"""
pipeline/fetch_statcast_historical.py

Fetch historical Statcast pitch-level data for training the matchup model.
Pulls pitch-by-pitch data via pybaseball, aggregates to plate-appearance level,
and optionally upserts pitcher-batter matchup summaries to Supabase.
"""

import argparse
import logging
import os
import time
from datetime import date, datetime, timedelta
from typing import Optional

import pandas as pd
import requests

# pybaseball may not be installed in all envs; imported at call-time to surface errors early
try:
    from pybaseball import statcast
except ImportError as exc:
    raise ImportError("pybaseball is required: pip install pybaseball") from exc

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
OUTPUT_PATH = "data/statcast_historical.csv"
SUPABASE_TABLE = "statcast_pitches"

# Maps raw event strings to canonical outcome categories
OUTCOME_MAP = {
    "strikeout": "K",
    "strikeout_double_play": "K",
    "walk": "BB",
    "intent_walk": "BB",
    "hit_by_pitch": "HBP",
    "single": "1B",
    "double": "2B",
    "triple": "3B",
    "home_run": "HR",
    "field_out": "OUT",
    "force_out": "OUT",
    "grounded_into_double_play": "OUT",
    "double_play": "OUT",
    "triple_play": "OUT",
    "field_error": "OUT",
    "fielders_choice": "OUT",
    "fielders_choice_out": "OUT",
    "sac_fly": "OUT",
    "sac_fly_double_play": "OUT",
    "sac_bunt": "OUT",
    "sac_bunt_double_play": "OUT",
    "caught_stealing_2b": "OUT",
    "caught_stealing_3b": "OUT",
    "caught_stealing_home": "OUT",
    "pickoff_caught_stealing_2b": "OUT",
    "pickoff_caught_stealing_3b": "OUT",
    "other_out": "OUT",
}

# Pitch-level feature columns to keep from raw Statcast
PITCH_COLS = [
    "game_pk",
    "at_bat_number",
    "batter",
    "pitcher",
    "stand",          # batter handedness
    "p_throws",       # pitcher handedness
    "home_team",
    "away_team",
    "inning",
    "inning_topbot",
    "outs_when_up",
    "on_1b",
    "on_2b",
    "on_3b",
    "bat_score",
    "fld_score",
    "pitch_type",
    "release_speed",
    "pfx_x",
    "pfx_z",
    "plate_x",
    "plate_z",
    "launch_speed",
    "launch_angle",
    "events",
    "description",
    "estimated_ba_using_speedangle",
    "estimated_woba_using_speedangle",
    "game_date",
]

# Per-PA columns derived from aggregation
PA_OUTCOME_COL = "outcome"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def _supabase_headers() -> dict:
    """Return standard Supabase REST API headers."""
    key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def _supabase_url() -> str:
    """Return the Supabase REST API base URL."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    return f"{base}/rest/v1"


def upsert_to_supabase(records: list[dict], table: str = SUPABASE_TABLE) -> None:
    """
    Upsert a list of record dicts to a Supabase table via REST API.

    Args:
        records: List of dicts representing rows to upsert.
        table:   Target Supabase table name.
    """
    if not records:
        logger.warning("upsert_to_supabase called with empty records list; skipping.")
        return

    url = f"{_supabase_url()}/{table}"
    headers = _supabase_headers()
    batch_size = 500

    for i in range(0, len(records), batch_size):
        batch = records[i : i + batch_size]
        resp = requests.post(url, headers=headers, json=batch, timeout=30)
        if resp.status_code not in (200, 201):
            logger.error(
                "Supabase upsert error %s for batch %d: %s",
                resp.status_code,
                i // batch_size,
                resp.text[:400],
            )
        else:
            logger.info("Upserted batch %d (%d rows) to %s", i // batch_size, len(batch), table)


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------
def _default_date_range() -> tuple[str, str]:
    """Return (start_date, end_date) covering approximately the last 3 seasons."""
    today = date.today()
    # MLB season typically starts April; pull last 3 full calendar years
    start = date(today.year - 3, 3, 1)
    end = today
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _week_chunks(start: str, end: str) -> list[tuple[str, str]]:
    """
    Split a date range into weekly chunks to avoid pybaseball / MLB API timeouts.

    Args:
        start: ISO date string (YYYY-MM-DD).
        end:   ISO date string (YYYY-MM-DD).

    Returns:
        List of (chunk_start, chunk_end) ISO date string tuples.
    """
    chunks = []
    cur = datetime.strptime(start, "%Y-%m-%d").date()
    end_dt = datetime.strptime(end, "%Y-%m-%d").date()

    while cur <= end_dt:
        chunk_end = min(cur + timedelta(days=6), end_dt)
        chunks.append((cur.strftime("%Y-%m-%d"), chunk_end.strftime("%Y-%m-%d")))
        cur = chunk_end + timedelta(days=1)

    return chunks


# ---------------------------------------------------------------------------
# Core fetch logic
# ---------------------------------------------------------------------------
def fetch_statcast_chunk(start: str, end: str, retries: int = 3) -> Optional[pd.DataFrame]:
    """
    Fetch one week of Statcast data via pybaseball with retry logic.

    Args:
        start:   ISO start date string.
        end:     ISO end date string.
        retries: Number of retry attempts on failure.

    Returns:
        DataFrame of raw pitch data, or None on persistent failure.
    """
    for attempt in range(1, retries + 1):
        try:
            logger.info("Fetching Statcast %s -> %s (attempt %d)", start, end, attempt)
            df = statcast(start_dt=start, end_dt=end, verbose=False)
            if df is None or df.empty:
                logger.warning("Empty result for %s -> %s", start, end)
                return None
            logger.info("  Retrieved %d pitches for %s -> %s", len(df), start, end)
            return df
        except Exception as exc:  # noqa: BLE001
            logger.warning("Attempt %d failed for %s -> %s: %s", attempt, start, end, exc)
            if attempt < retries:
                backoff = 5 * attempt
                logger.info("  Backing off %ds before retry...", backoff)
                time.sleep(backoff)
    logger.error("All retries exhausted for %s -> %s", start, end)
    return None


def _runners_encoded(row: pd.Series) -> int:
    """
    Encode base-runner state as an integer 0-7 (bitmask: 1B=bit0, 2B=bit1, 3B=bit2).

    Args:
        row: A pandas Series from the pitch DataFrame.

    Returns:
        Integer bitmask representing occupied bases.
    """
    return (
        (1 if pd.notna(row.get("on_1b")) else 0)
        | (2 if pd.notna(row.get("on_2b")) else 0)
        | (4 if pd.notna(row.get("on_3b")) else 0)
    )


def aggregate_to_pa(df: pd.DataFrame) -> pd.DataFrame:
    """
    Aggregate pitch-level DataFrame to one row per plate appearance.

    Keeps final pitch context for each PA, maps the event to a canonical
    outcome category, and computes numeric pitch-level aggregates.

    Args:
        df: Raw pitch-by-pitch DataFrame from pybaseball.

    Returns:
        DataFrame with one row per plate appearance.
    """
    # Filter to available columns only
    keep = [c for c in PITCH_COLS if c in df.columns]
    df = df[keep].copy()

    # Normalise outcome event strings
    df["events"] = df["events"].astype(str).str.lower().str.strip()
    df[PA_OUTCOME_COL] = df["events"].map(OUTCOME_MAP)

    # Per-PA numeric aggregates across all pitches in the AB
    pa_group = ["game_pk", "at_bat_number", "batter", "pitcher"]

    # The final pitch in an AB carries the event; keep full context row for that pitch
    # Sort so last pitch is last within each PA
    df = df.sort_values(["game_pk", "at_bat_number", "pitch_number"] if "pitch_number" in df.columns else pa_group)

    # Aggregate numeric pitch-level features (mean across AB)
    num_cols = [c for c in ["release_speed", "pfx_x", "pfx_z", "plate_x", "plate_z",
                             "launch_speed", "launch_angle",
                             "estimated_ba_using_speedangle",
                             "estimated_woba_using_speedangle"] if c in df.columns]

    agg_num = df.groupby(pa_group)[num_cols].mean().reset_index()

    # Keep last-pitch context for categorical / outcome fields
    ctx_cols = [c for c in [
        "game_pk", "at_bat_number", "batter", "pitcher",
        "stand", "p_throws", "home_team", "away_team",
        "inning", "inning_topbot", "outs_when_up",
        "on_1b", "on_2b", "on_3b", "bat_score", "fld_score",
        "events", PA_OUTCOME_COL, "game_date",
    ] if c in df.columns]

    ctx = (
        df[df[PA_OUTCOME_COL].notna()][ctx_cols]
        .drop_duplicates(subset=pa_group, keep="last")
    )

    # Merge
    pa_df = ctx.merge(agg_num, on=pa_group, how="left")

    # Encode runners
    pa_df["runners_on_base"] = pa_df.apply(_runners_encoded, axis=1)

    # Score differential from batter perspective
    if "bat_score" in pa_df.columns and "fld_score" in pa_df.columns:
        pa_df["score_diff"] = pa_df["bat_score"].fillna(0) - pa_df["fld_score"].fillna(0)

    # Drop rows where we couldn't resolve an outcome (e.g. intentional balls mid-AB)
    pa_df = pa_df[pa_df[PA_OUTCOME_COL].notna()].reset_index(drop=True)

    logger.info("Aggregated to %d plate appearances", len(pa_df))
    return pa_df


def build_matchup_summary(pa_df: pd.DataFrame) -> list[dict]:
    """
    Build pitcher-batter matchup summary stats for Supabase upload.

    Args:
        pa_df: Plate-appearance level DataFrame.

    Returns:
        List of dicts suitable for upsert into statcast_pitches table.
    """
    outcomes = ["K", "BB", "1B", "2B", "3B", "HR", "HBP", "OUT"]
    key_cols = ["pitcher", "batter"]

    records = []
    for (pitcher, batter), grp in pa_df.groupby(key_cols):
        total = len(grp)
        rec: dict = {
            "pitcher_id": int(pitcher) if pd.notna(pitcher) else None,
            "batter_id": int(batter) if pd.notna(batter) else None,
            "total_pa": total,
        }
        for oc in outcomes:
            rec[f"pct_{oc.lower()}"] = round(len(grp[grp[PA_OUTCOME_COL] == oc]) / total, 4)
        records.append(rec)

    logger.info("Built %d pitcher-batter matchup summary rows", len(records))
    return records


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------
def main() -> None:
    """CLI entry point: fetch historical Statcast data and save/upload results."""
    parser = argparse.ArgumentParser(
        description="Fetch historical Statcast data for BaselineMLB matchup model training."
    )
    default_start, default_end = _default_date_range()
    parser.add_argument("--start-date", default=default_start, help="ISO start date (YYYY-MM-DD)")
    parser.add_argument("--end-date", default=default_end, help="ISO end date (YYYY-MM-DD)")
    parser.add_argument(
        "--upload",
        action="store_true",
        help="Upsert pitcher-batter matchup summaries to Supabase statcast_pitches table",
    )
    parser.add_argument(
        "--output",
        default=OUTPUT_PATH,
        help=f"Output CSV path (default: {OUTPUT_PATH})",
    )
    args = parser.parse_args()

    os.makedirs(os.path.dirname(args.output) if os.path.dirname(args.output) else ".", exist_ok=True)

    chunks = _week_chunks(args.start_date, args.end_date)
    logger.info("Fetching %d weekly chunks from %s -> %s", len(chunks), args.start_date, args.end_date)

    all_pa_frames: list[pd.DataFrame] = []

    for chunk_start, chunk_end in chunks:
        raw = fetch_statcast_chunk(chunk_start, chunk_end)
        if raw is None or raw.empty:
            continue
        pa = aggregate_to_pa(raw)
        if not pa.empty:
            all_pa_frames.append(pa)
        # Small courteous pause between API calls
        time.sleep(1)

    if not all_pa_frames:
        logger.error("No data retrieved for the specified date range. Exiting.")
        return

    combined = pd.concat(all_pa_frames, ignore_index=True)
    logger.info("Total plate appearances collected: %d", len(combined))

    combined.to_csv(args.output, index=False)
    logger.info("Saved plate-appearance data to %s", args.output)

    if args.upload:
        if not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_SERVICE_KEY"):
            logger.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set for --upload.")
            return
        records = build_matchup_summary(combined)
        upsert_to_supabase(records)


if __name__ == "__main__":
    main()

"""
pipeline/fetch_statcast.py

Fetch Statcast pitch-level data and catcher framing stats via pybaseball.
Computes per-umpire edge-zone strike rates and upserts to Supabase.

Usage:
    python pipeline/fetch_statcast.py
"""

import logging
import os
from datetime import date, timedelta

import pandas as pd
import pybaseball as pb
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)

# Cache pybaseball requests to disk so we don't hammer the server
pb.cache.enable()


def _get_supabase_client():
    """Lazy Supabase client — only created when upserts are needed."""
    from supabase import create_client

    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise EnvironmentError(
            "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment"
        )
    return create_client(url, key)


# ── Catcher Framing ──────────────────────────────────────────────────
def fetch_catcher_framing(season: int) -> pd.DataFrame:
    """
    Pull catcher framing stats from Baseball Savant via pybaseball.
    Returns a DataFrame with columns: player_id, player_name, framing_runs
    Returns empty DataFrame if data is not available (pre-season).
    """
    try:
        df = pb.statcast_catcher_framing(season)
        if df is None or df.empty:
            log.info(
                "No catcher framing data for %d season (pre-season or no games).",
                season,
            )
            return pd.DataFrame()
        df = df.rename(
            columns={
                "last_name, first_name": "player_name",
                "fielding_runs_above_average": "framing_runs",
            }
        )
        df["season"] = season
        available_cols = [
            c
            for c in ["player_id", "player_name", "framing_runs", "season"]
            if c in df.columns
        ]
        return df[available_cols]
    except Exception as e:
        log.warning("Could not fetch catcher framing for %d: %s", season, e)
        log.info("This is expected before the season starts. Skipping.")
        return pd.DataFrame()


# ── Umpire Edge-Zone Tendencies ──────────────────────────────────────
def fetch_umpire_data(start_date: str, end_date: str) -> pd.DataFrame:
    """
    Pull Statcast pitch-level data and compute per-umpire strike-call accuracy.
    start_date / end_date: 'YYYY-MM-DD'
    Returns empty DataFrame if no games in the date range (pre-season).
    """
    try:
        log.info("Pulling Statcast data %s -> %s ...", start_date, end_date)
        df = pb.statcast(start_dt=start_date, end_dt=end_date)
        if df is None or df.empty:
            log.info(
                "No Statcast data for %s to %s (no games played).",
                start_date,
                end_date,
            )
            return pd.DataFrame()

        df = df.dropna(subset=["umpire", "zone", "type"])
        if df.empty:
            log.info("No valid pitch data found. Skipping umpire analysis.")
            return pd.DataFrame()

        # Edge zone calls: zones 11-14 are borderline
        edge_zones = {11, 12, 13, 14}
        df["is_edge"] = df["zone"].isin(edge_zones)
        df["called_strike"] = (df["type"] == "S") & (
            df["description"] == "called_strike"
        )

        ump_stats = (
            df.groupby("umpire")
            .agg(
                total_pitches=("type", "count"),
                edge_called_strikes=(
                    "called_strike",
                    lambda x: x[df.loc[x.index, "is_edge"]].sum(),
                ),
                edge_pitches=("is_edge", "sum"),
            )
            .reset_index()
        )
        ump_stats["edge_strike_pct"] = (
            ump_stats["edge_called_strikes"] / ump_stats["edge_pitches"]
        ).round(4)
        ump_stats["as_of"] = end_date
        return ump_stats
    except Exception as e:
        log.warning("Could not fetch Statcast umpire data: %s", e)
        log.info("This is expected before the season starts. Skipping.")
        return pd.DataFrame()


# ── Supabase Upsert ──────────────────────────────────────────────────
def upsert_framing(df: pd.DataFrame) -> None:
    if df.empty:
        log.info("No framing data to upsert.")
        return
    sb = _get_supabase_client()
    rows = df.to_dict(orient="records")
    for i in range(0, len(rows), 500):
        sb.table("catcher_framing").upsert(rows[i : i + 500]).execute()
    log.info("Upserted %d catcher framing rows.", len(rows))


def upsert_umpires(df: pd.DataFrame) -> None:
    if df.empty:
        log.info("No umpire data to upsert.")
        return
    sb = _get_supabase_client()
    rows = df.to_dict(orient="records")
    for i in range(0, len(rows), 500):
        sb.table("umpire_tendencies").upsert(rows[i : i + 500]).execute()
    log.info("Upserted %d umpire rows.", len(rows))


# ── Main ─────────────────────────────────────────────────────────────
def main():
    season = date.today().year
    end = str(date.today())
    start = str(date.today() - timedelta(days=30))

    log.info("Fetching catcher framing ...")
    framing_df = fetch_catcher_framing(season)
    upsert_framing(framing_df)

    log.info("Fetching umpire tendencies ...")
    ump_df = fetch_umpire_data(start, end)
    upsert_umpires(ump_df)

    log.info("Done. (Pre-season: data will populate once games begin.)")


if __name__ == "__main__":
    main()

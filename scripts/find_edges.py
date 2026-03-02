#!/usr/bin/env python3
"""
BaselineMLB Edge Finder
=======================
Identifies profitable betting edges by comparing model projections against
sportsbook prop lines. Calculates Kelly criterion bet sizing and ranks plays
by expected value.

Usage:
    python scripts/find_edges.py [--bankroll 1000] [--kelly-fraction 0.25]
                                 [--date 2026-03-01] [--min-edge 0]
                                 [--output json,markdown,text]

Environment Variables (required):
    SUPABASE_URL        Your Supabase project URL
    SUPABASE_ANON_KEY   Your Supabase anon (public) key
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

try:
    from supabase import create_client, Client
except ImportError:
    sys.exit(
        "supabase-py is required.  Install with:\n"
        "  pip install supabase python-dateutil"
    )

# ── Constants ────────────────────────────────────────────────────────────────

# SECURITY: Credentials must come from environment variables — never hardcode
DEFAULT_SUPABASE_URL = ""  # Set via SUPABASE_URL env var
DEFAULT_SUPABASE_KEY = ""  # Set via SUPABASE_ANON_KEY or SUPABASE_SERVICE_KEY env var
DEFAULT_BANKROLL = 1_000.0
DEFAULT_KELLY_FRACTION = 0.25  # Quarter Kelly
DEFAULT_TOP_N = 5
JUICE_DEFAULT = -110  # Standard American odds when odds missing
MAX_KELLY_CAP = 0.05  # Never risk > 5% of bankroll on one play


# ── Supabase helpers ─────────────────────────────────────────────────────────

def get_supabase_client() -> Client:
    """Create a Supabase client from environment variables."""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_ANON_KEY") or os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        sys.exit(
            "Missing required environment variables.\n"
            "  Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY).\n"
            "  See .env.example for details."
        )
    return create_client(url, key)


def fetch_projections(sb: Client, game_date: str) -> list[dict]:
    """Fetch projections for a given date from the projections table."""
    resp = (
        sb.table("projections")
        .select("*")
        .eq("game_date", game_date)
        .execute()
    )
    return resp.data or []


def fetch_props(sb: Client, game_date: str) -> list[dict]:
    """Fetch prop lines for a given date from the props table."""
    resp = (
        sb.table("props")
        .select("*")
        .eq("game_date", game_date)
        .execute()
    )
    return resp.data or []


def fetch_historical_picks(sb: Client) -> list[dict]:
    """Fetch all graded picks for historical edge analysis."""
    resp = (
        sb.table("picks")
        .select("*")
        .not_.is_("grade", "null")
        .execute()
    )
    return resp.data or []


# ── Math helpers ─────────────────────────────────────────────────────────────

def american_to_decimal(odds: int | float | None) -> float:
    """Convert American odds to decimal odds.  Defaults to -110."""
    if odds is None:
        odds = JUICE_DEFAULT
    odds = float(odds)
    if odds > 0:
        return (odds / 100.0) + 1.0
    return (100.0 / abs(odds)) + 1.0


def implied_probability(american_odds: int | float | None) -> float:
    """Convert American odds to implied probability (no-vig not applied)."""
    dec = american_to_decimal(american_odds)
    return 1.0 / dec


def no_vig_probability(
    over_odds: int | float | None,
    under_odds: int | float | None,
    side: str,
) -> float:
    """Calculate the no-vig (true) implied probability for one side."""
    p_over = implied_probability(over_odds)
    p_under = implied_probability(under_odds)
    total = p_over + p_under  # overround
    if total == 0:
        return 0.5
    if side.lower() == "over":
        return p_over / total
    return p_under / total


def kelly_stake(
    edge: float,
    decimal_odds: float,
    fraction: float = DEFAULT_KELLY_FRACTION,
) -> float:
    """
    Fractional Kelly criterion stake as a fraction of bankroll.

    f* = fraction * (bp - q) / b
    where b = decimal_odds - 1, p = model win prob, q = 1 - p
    We derive p from the edge and the line.
    """
    b = decimal_odds - 1.0
    if b <= 0:
        return 0.0
    # Edge is projected_value - line.  We convert to a probability estimate
    # by checking if the edge implies a >50% chance of clearing.
    # For a more rigorous approach we'd use the full distribution, but this
    # heuristic works well: map edge magnitude to a win-probability bump.
    # A positive edge => OVER is favored; we estimate P(over) ~ 0.5 + edge_pct.
    # edge_pct = edge / line (as fraction of the line).
    # This keeps the Kelly sizing proportional to the edge magnitude.
    p = 0.5 + (edge * 0.5)  # bounded heuristic; edge is already normalized
    p = max(0.0, min(p, 0.99))
    q = 1.0 - p

    kelly = fraction * ((b * p - q) / b)
    kelly = max(kelly, 0.0)
    kelly = min(kelly, MAX_KELLY_CAP)
    return kelly


def calculate_edge_pct(projection: float, line: float) -> float:
    """Calculate edge as a percentage of the line."""
    if line == 0:
        return 0.0
    return (projection - line) / line


# ── Core matching ────────────────────────────────────────────────────────────

def match_projections_to_props(
    projections: list[dict],
    props: list[dict],
) -> list[dict]:
    """
    Join projections to props on (mlbam_id, stat_type) and compute edges.
    Returns a list of edge records sorted by absolute edge descending.
    """
    # Index projections by (mlbam_id, stat_type)
    proj_map: dict[tuple, dict] = {}
    for p in projections:
        key = (p.get("mlbam_id"), p.get("stat_type"))
        # Keep highest-confidence projection if duplicates exist
        existing = proj_map.get(key)
        if existing is None or (p.get("confidence") or 0) > (
            existing.get("confidence") or 0
        ):
            proj_map[key] = p

    edges: list[dict] = []

    for prop in props:
        key = (prop.get("mlbam_id"), prop.get("stat_type"))
        proj = proj_map.get(key)
        if proj is None:
            continue

        projected_value = float(proj.get("projection", 0))
        line = float(prop.get("line", 0))
        raw_edge = projected_value - line
        edge_pct = calculate_edge_pct(projected_value, line)

        over_odds = prop.get("over_odds")
        under_odds = prop.get("under_odds")

        # Determine direction
        if raw_edge > 0:
            direction = "OVER"
            relevant_odds = over_odds
            nv_prob = no_vig_probability(over_odds, under_odds, "over")
        elif raw_edge < 0:
            direction = "UNDER"
            relevant_odds = under_odds
            nv_prob = no_vig_probability(over_odds, under_odds, "under")
        else:
            continue  # No edge

        dec_odds = american_to_decimal(relevant_odds)

        # Normalize edge for Kelly input (edge_pct clamped to [-1, 1])
        norm_edge = max(-1.0, min(1.0, edge_pct))
        kelly_frac = kelly_stake(abs(norm_edge), dec_odds)

        # Confidence from projection model
        confidence = proj.get("confidence")
        model_version = proj.get("model_version", "unknown")
        features = proj.get("features", {})
        source = prop.get("source", "unknown")

        edges.append(
            {
                "player_name": proj.get("player_name") or prop.get("player_name", "Unknown"),
                "mlbam_id": prop.get("mlbam_id"),
                "stat_type": prop.get("stat_type"),
                "game_date": prop.get("game_date") or proj.get("game_date"),
                "source": source,
                "line": line,
                "projected_value": projected_value,
                "raw_edge": round(raw_edge, 2),
                "edge_pct": round(edge_pct * 100, 2),
                "direction": direction,
                "over_odds": over_odds,
                "under_odds": under_odds,
                "relevant_odds": relevant_odds,
                "decimal_odds": round(dec_odds, 3),
                "no_vig_prob": round(nv_prob * 100, 2),
                "kelly_fraction": round(kelly_frac * 100, 4),
                "confidence": confidence,
                "model_version": model_version,
                "features": features,
                "projection_id": proj.get("id"),
                "prop_id": prop.get("id"),
            }
        )

    # Sort by absolute edge descending
    edges.sort(key=lambda e: abs(e["edge_pct"]), reverse=True)
    return edges


# ── Historical analysis ──────────────────────────────────────────────────────

def analyze_historical_edges(picks: list[dict]) -> dict:
    """
    Analyze historical pick performance segmented by edge magnitude.
    Returns hit rates for different edge thresholds.
    """
    if not picks:
        return {
            "total_graded": 0,
            "note": "No graded picks available for historical analysis.",
        }

    thresholds = [0, 5, 10, 15, 20, 25, 30]
    results: dict[str, Any] = {"total_graded": len(picks)}

    for threshold in thresholds:
        bucket = [
            p for p in picks
            if p.get("edge") is not None
            and abs(float(p["edge"])) >= threshold
        ]
        total = len(bucket)
        hits = sum(
            1 for p in bucket
            if str(p.get("grade", "")).lower() == "hit"
        )
        pushes = sum(
            1 for p in bucket
            if str(p.get("grade", "")).lower() == "push"
        )
        misses = total - hits - pushes

        # Hit rate excludes pushes from denominator
        denom = hits + misses
        hit_rate = (hits / denom * 100) if denom > 0 else 0.0

        results[f"edge_gte_{threshold}pct"] = {
            "total": total,
            "hits": hits,
            "misses": misses,
            "pushes": pushes,
            "hit_rate": round(hit_rate, 1),
        }

    # Direction breakdown
    for direction in ("Over", "Under"):
        dir_picks = [
            p for p in picks
            if str(p.get("direction", "")).lower() == direction.lower()
        ]
        total = len(dir_picks)
        hits = sum(
            1 for p in dir_picks
            if str(p.get("grade", "")).lower() == "hit"
        )
        pushes = sum(
            1 for p in dir_picks
            if str(p.get("grade", "")).lower() == "push"
        )
        misses = total - hits - pushes
        denom = hits + misses
        hit_rate = (hits / denom * 100) if denom > 0 else 0.0

        results[f"direction_{direction.lower()}"] = {
            "total": total,
            "hits": hits,
            "misses": misses,
            "pushes": pushes,
            "hit_rate": round(hit_rate, 1),
        }

    return results


# ── Ranking & sizing ─────────────────────────────────────────────────────────

def rank_and_size(
    edges: list[dict],
    bankroll: float,
    kelly_fraction: float,
    top_n: int = DEFAULT_TOP_N,
) -> dict:
    """
    Separate OVER / UNDER plays, rank by edge, compute bet amounts.
    Returns structured output with top plays and historical analysis placeholder.
    """
    overs = [e for e in edges if e["direction"] == "OVER" and e["edge_pct"] > 0]
    unders = [e for e in edges if e["direction"] == "UNDER" and e["edge_pct"] < 0]

    # Sort: overs by largest positive edge, unders by largest negative edge
    overs.sort(key=lambda e: e["edge_pct"], reverse=True)
    unders.sort(key=lambda e: e["edge_pct"])  # most negative first

    def enrich(plays: list[dict], n: int) -> list[dict]:
        enriched = []
        for rank, play in enumerate(plays[:n], 1):
            # Recalculate Kelly with the user's fraction
            norm_edge = max(-1.0, min(1.0, play["edge_pct"] / 100.0))
            kelly_pct = kelly_stake(abs(norm_edge), play["decimal_odds"], kelly_fraction)
            wager = round(bankroll * kelly_pct, 2)
            # Cap wager at MAX_KELLY_CAP of bankroll
            wager = min(wager, bankroll * MAX_KELLY_CAP)

            # Confidence tier
            abs_edge = abs(play["edge_pct"])
            if abs_edge >= 20:
                tier = "HIGH"
                units = "3-5"
            elif abs_edge >= 10:
                tier = "MEDIUM"
                units = "2-3"
            elif abs_edge >= 5:
                tier = "LOW-MEDIUM"
                units = "1-2"
            else:
                tier = "LOW"
                units = "0.5-1"

            enriched.append(
                {
                    "rank": rank,
                    **play,
                    "kelly_pct": round(kelly_pct * 100, 4),
                    "wager": wager,
                    "confidence_tier": tier,
                    "recommended_units": units,
                }
            )
        return enriched

    return {
        "top_overs": enrich(overs, top_n),
        "top_unders": enrich(unders, top_n),
        "total_edges_found": len(edges),
        "total_overs": len(overs),
        "total_unders": len([e for e in edges if e["direction"] == "UNDER"]),
        "bankroll": bankroll,
        "kelly_fraction": kelly_fraction,
    }


# ── Output formatters ────────────────────────────────────────────────────────

def format_odds_display(odds: int | float | None) -> str:
    """Format American odds for display."""
    if odds is None:
        return "-110"
    odds = int(odds)
    return f"+{odds}" if odds > 0 else str(odds)


def output_json(
    ranked: dict,
    historical: dict,
    game_date: str,
    output_dir: Path,
) -> Path:
    """Write full output as JSON."""
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "game_date": game_date,
        "summary": {
            "total_edges": ranked["total_edges_found"],
            "over_plays": ranked["total_overs"],
            "under_plays": ranked["total_unders"],
            "bankroll": ranked["bankroll"],
            "kelly_fraction": ranked["kelly_fraction"],
        },
        "top_over_plays": ranked["top_overs"],
        "top_under_plays": ranked["top_unders"],
        "historical_analysis": historical,
    }
    path = output_dir / f"edges_{game_date}.json"
    path.write_text(json.dumps(payload, indent=2, default=str))
    return path


def output_markdown(
    ranked: dict,
    historical: dict,
    game_date: str,
    output_dir: Path,
) -> Path:
    """Write Twitter-ready Markdown output."""
    lines: list[str] = []
    lines.append(f"# ⚾ BaselineMLB Edge Report — {game_date}")
    lines.append("")
    lines.append(
        f"*{ranked['total_edges_found']} edges found | "
        f"Bankroll: ${ranked['bankroll']:,.0f} | "
        f"Kelly: {ranked['kelly_fraction']:.0%}*"
    )
    lines.append("")

    # Top Overs
    lines.append("## 🔼 Top OVER Plays")
    lines.append("")
    if ranked["top_overs"]:
        lines.append(
            "| # | Player | Stat | Line | Proj | Edge | Odds | Wager | Tier |"
        )
        lines.append(
            "|---|--------|------|------|------|------|------|-------|------|"
        )
        for p in ranked["top_overs"]:
            lines.append(
                f"| {p['rank']} "
                f"| {p['player_name']} "
                f"| {p['stat_type']} "
                f"| {p['line']} "
                f"| {p['projected_value']:.1f} "
                f"| +{p['edge_pct']:.1f}% "
                f"| {format_odds_display(p['relevant_odds'])} "
                f"| ${p['wager']:.2f} "
                f"| {p['confidence_tier']} |"
            )
    else:
        lines.append("*No OVER edges found for today.*")
    lines.append("")

    # Top Unders
    lines.append("## 🔽 Top UNDER Plays")
    lines.append("")
    if ranked["top_unders"]:
        lines.append(
            "| # | Player | Stat | Line | Proj | Edge | Odds | Wager | Tier |"
        )
        lines.append(
            "|---|--------|------|------|------|------|------|-------|------|"
        )
        for p in ranked["top_unders"]:
            lines.append(
                f"| {p['rank']} "
                f"| {p['player_name']} "
                f"| {p['stat_type']} "
                f"| {p['line']} "
                f"| {p['projected_value']:.1f} "
                f"| {p['edge_pct']:.1f}% "
                f"| {format_odds_display(p['relevant_odds'])} "
                f"| ${p['wager']:.2f} "
                f"| {p['confidence_tier']} |"
            )
    else:
        lines.append("*No UNDER edges found for today.*")
    lines.append("")

    # Historical
    lines.append("## 📊 Historical Edge Performance")
    lines.append("")
    if historical.get("total_graded", 0) > 0:
        lines.append("| Edge Threshold | Plays | Hits | Misses | Hit Rate |")
        lines.append("|----------------|-------|------|--------|----------|")
        for key in sorted(historical.keys()):
            if key.startswith("edge_gte_"):
                threshold = key.replace("edge_gte_", "").replace("pct", "%")
                d = historical[key]
                lines.append(
                    f"| ≥{threshold} "
                    f"| {d['total']} "
                    f"| {d['hits']} "
                    f"| {d['misses']} "
                    f"| {d['hit_rate']:.1f}% |"
                )
        lines.append("")
        # Direction breakdown
        for direction in ("over", "under"):
            key = f"direction_{direction}"
            if key in historical:
                d = historical[key]
                lines.append(
                    f"- **{direction.upper()}** plays: "
                    f"{d['hits']}/{d['total']} "
                    f"({d['hit_rate']:.1f}% hit rate)"
                )
    else:
        lines.append(
            historical.get("note", "No historical data available.")
        )
    lines.append("")
    lines.append("---")
    lines.append(
        f"*Generated by BaselineMLB Edge Finder | "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*"
    )

    content = "\n".join(lines)
    path = output_dir / f"edges_{game_date}.md"
    path.write_text(content)
    return path


def output_twitter_threads(
    ranked: dict, game_date: str, output_dir: Path
) -> Path:
    """Generate concise Twitter/X thread text."""
    tweets: list[str] = []

    # Header tweet
    tweets.append(
        f"⚾ BaselineMLB Edge Report — {game_date}\n\n"
        f"📊 {ranked['total_edges_found']} edges found today\n"
        f"🔼 {ranked['total_overs']} OVER plays\n"
        f"🔽 {ranked['total_unders']} UNDER plays\n\n"
        f"Top plays thread 🧵👇"
    )

    # Over plays
    if ranked["top_overs"]:
        over_lines = ["🔼 TOP OVER PLAYS\n"]
        for p in ranked["top_overs"]:
            over_lines.append(
                f"{p['rank']}. {p['player_name']} {p['stat_type']}\n"
                f"   Line: {p['line']} → Proj: {p['projected_value']:.1f} "
                f"(+{p['edge_pct']:.1f}% edge)\n"
                f"   {format_odds_display(p['relevant_odds'])} | "
                f"{p['confidence_tier']} confidence"
            )
        tweets.append("\n".join(over_lines))

    # Under plays
    if ranked["top_unders"]:
        under_lines = ["🔽 TOP UNDER PLAYS\n"]
        for p in ranked["top_unders"]:
            under_lines.append(
                f"{p['rank']}. {p['player_name']} {p['stat_type']}\n"
                f"   Line: {p['line']} → Proj: {p['projected_value']:.1f} "
                f"({p['edge_pct']:.1f}% edge)\n"
                f"   {format_odds_display(p['relevant_odds'])} | "
                f"{p['confidence_tier']} confidence"
            )
        tweets.append("\n".join(under_lines))

    content = "\n\n---\n\n".join(tweets)
    path = output_dir / f"edges_{game_date}_twitter.txt"
    path.write_text(content)
    return path


def output_plain_text(
    ranked: dict,
    historical: dict,
    game_date: str,
    output_dir: Path,
) -> Path:
    """Write plain-text summary."""
    lines: list[str] = []
    lines.append("=" * 60)
    lines.append(f"  BASELINEMLB EDGE REPORT — {game_date}")
    lines.append("=" * 60)
    lines.append("")
    lines.append(
        f"  Edges found: {ranked['total_edges_found']}  |  "
        f"Bankroll: ${ranked['bankroll']:,.0f}  |  "
        f"Kelly: {ranked['kelly_fraction']:.0%}"
    )
    lines.append("")

    def print_section(title: str, plays: list[dict]) -> None:
        lines.append("-" * 60)
        lines.append(f"  {title}")
        lines.append("-" * 60)
        if not plays:
            lines.append("  (none found)")
            lines.append("")
            return
        for p in plays:
            lines.append(
                f"  #{p['rank']}  {p['player_name']}  —  "
                f"{p['stat_type']}  ({p['source']})"
            )
            lines.append(
                f"        Line: {p['line']}   "
                f"Projected: {p['projected_value']:.1f}   "
                f"Edge: {p['edge_pct']:+.1f}%"
            )
            lines.append(
                f"        Odds: {format_odds_display(p['relevant_odds'])}   "
                f"Wager: ${p['wager']:.2f}   "
                f"Tier: {p['confidence_tier']} ({p['recommended_units']}u)"
            )
            if p.get("confidence") is not None:
                lines.append(
                    f"        Model confidence: {p['confidence']:.2f}   "
                    f"Version: {p['model_version']}"
                )
            lines.append("")

    print_section("TOP OVER PLAYS", ranked["top_overs"])
    print_section("TOP UNDER PLAYS", ranked["top_unders"])

    # Historical
    lines.append("-" * 60)
    lines.append("  HISTORICAL EDGE PERFORMANCE")
    lines.append("-" * 60)
    if historical.get("total_graded", 0) > 0:
        lines.append(
            f"  Total graded picks: {historical['total_graded']}"
        )
        lines.append("")
        for key in sorted(historical.keys()):
            if key.startswith("edge_gte_"):
                threshold = key.replace("edge_gte_", "").replace("pct", "")
                d = historical[key]
                lines.append(
                    f"  Edge >= {threshold}%:  "
                    f"{d['total']} plays  |  "
                    f"{d['hits']} hits / {d['misses']} misses  |  "
                    f"{d['hit_rate']:.1f}% hit rate"
                )
        lines.append("")
        for direction in ("over", "under"):
            key = f"direction_{direction}"
            if key in historical:
                d = historical[key]
                lines.append(
                    f"  {direction.upper()} plays:  "
                    f"{d['hits']}/{d['total']}  "
                    f"({d['hit_rate']:.1f}% hit rate)"
                )
    else:
        lines.append(
            f"  {historical.get('note', 'No historical data available.')}"
        )
    lines.append("")
    lines.append("=" * 60)
    lines.append(
        f"  Generated: "
        f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
    )
    lines.append(
        "  BaselineMLB Edge Finder  |  github.com/nrlefty5/baselinemlb"
    )
    lines.append("=" * 60)

    content = "\n".join(lines)
    path = output_dir / f"edges_{game_date}.txt"
    path.write_text(content)
    return path


# ── CLI ──────────────────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="BaselineMLB Edge Finder — identify profitable betting edges",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--bankroll",
        type=float,
        default=DEFAULT_BANKROLL,
        help=f"Total bankroll in dollars (default: ${DEFAULT_BANKROLL:,.0f})",
    )
    parser.add_argument(
        "--kelly-fraction",
        type=float,
        default=DEFAULT_KELLY_FRACTION,
        help=f"Kelly fraction (default: {DEFAULT_KELLY_FRACTION} = quarter Kelly)",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Game date in YYYY-MM-DD format (default: today)",
    )
    parser.add_argument(
        "--min-edge",
        type=float,
        default=0.0,
        help="Minimum absolute edge %% to include (default: 0)",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=DEFAULT_TOP_N,
        help=f"Number of top plays per direction (default: {DEFAULT_TOP_N})",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="json,markdown,text",
        help="Comma-separated output formats: json,markdown,text (default: all)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="output",
        help="Output directory (default: output/)",
    )
    parser.add_argument(
        "--skip-historical",
        action="store_true",
        help="Skip historical edge analysis (faster)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose output",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    game_date = args.date or date.today().isoformat()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_formats = [f.strip().lower() for f in args.output.split(",")]

    print(f"BaselineMLB Edge Finder")
    print(f"{'=' * 40}")
    print(f"Date:           {game_date}")
    print(f"Bankroll:       ${args.bankroll:,.0f}")
    print(f"Kelly fraction: {args.kelly_fraction:.0%}")
    print(f"Min edge:       {args.min_edge}%")
    print(f"Output:         {', '.join(output_formats)}")
    print()

    # Connect to Supabase
    print("Connecting to Supabase...")
    sb = get_supabase_client()

    # Fetch data
    print(f"Fetching projections for {game_date}...")
    projections = fetch_projections(sb, game_date)
    print(f"  → {len(projections)} projections found")

    print(f"Fetching props for {game_date}...")
    props = fetch_props(sb, game_date)
    print(f"  → {len(props)} prop lines found")

    if not projections:
        print("\n⚠️  No projections found for this date.")
        print("    Ensure the pipeline has run:  python pipeline/generate_projections.py")
        # Still generate empty output files
        edges = []
    elif not props:
        print("\n⚠️  No prop lines found for this date.")
        print("    Ensure props have been fetched:  python pipeline/fetch_props.py")
        edges = []
    else:
        # Match and calculate edges
        print("Matching projections to props and calculating edges...")
        edges = match_projections_to_props(projections, props)
        print(f"  → {len(edges)} matched edges")

    # Filter by min edge
    if args.min_edge > 0:
        edges = [e for e in edges if abs(e["edge_pct"]) >= args.min_edge]
        print(f"  → {len(edges)} after min-edge filter ({args.min_edge}%)")

    # Historical analysis
    historical: dict = {}
    if not args.skip_historical:
        print("Fetching historical picks for edge analysis...")
        picks = fetch_historical_picks(sb)
        print(f"  → {len(picks)} graded picks found")
        historical = analyze_historical_edges(picks)
    else:
        historical = {"note": "Historical analysis skipped (--skip-historical)."}

    # Rank and size
    print("Ranking plays and calculating bet sizing...")
    ranked = rank_and_size(edges, args.bankroll, args.kelly_fraction, args.top_n)

    # Generate outputs
    print(f"\nGenerating output files in {output_dir}/...")
    generated: list[Path] = []

    if "json" in output_formats:
        p = output_json(ranked, historical, game_date, output_dir)
        generated.append(p)
        print(f"  ✓ {p}")

    if "markdown" in output_formats:
        p = output_markdown(ranked, historical, game_date, output_dir)
        generated.append(p)
        # Also generate Twitter thread
        p2 = output_twitter_threads(ranked, game_date, output_dir)
        generated.append(p2)
        print(f"  ✓ {p}")
        print(f"  ✓ {p2}")

    if "text" in output_formats:
        p = output_plain_text(ranked, historical, game_date, output_dir)
        generated.append(p)
        print(f"  ✓ {p}")

    # Summary
    print(f"\n{'=' * 40}")
    print(f"SUMMARY")
    print(f"{'=' * 40}")
    print(f"Total edges:    {ranked['total_edges_found']}")
    print(f"OVER plays:     {ranked['total_overs']}")
    print(f"UNDER plays:    {ranked['total_unders']}")

    if ranked["top_overs"]:
        best = ranked["top_overs"][0]
        print(
            f"\nBest OVER:      {best['player_name']} "
            f"{best['stat_type']} "
            f"(+{best['edge_pct']:.1f}% edge, "
            f"${best['wager']:.2f} wager)"
        )

    if ranked["top_unders"]:
        best = ranked["top_unders"][0]
        print(
            f"Best UNDER:     {best['player_name']} "
            f"{best['stat_type']} "
            f"({best['edge_pct']:.1f}% edge, "
            f"${best['wager']:.2f} wager)"
        )

    if historical.get("total_graded", 0) > 0:
        for threshold in (10, 20):
            key = f"edge_gte_{threshold}pct"
            if key in historical:
                d = historical[key]
                print(
                    f"\nHistorical (edge ≥{threshold}%):  "
                    f"{d['hit_rate']:.1f}% hit rate  "
                    f"({d['total']} plays)"
                )

    if args.verbose and edges:
        print(f"\n{'=' * 40}")
        print("ALL EDGES (verbose)")
        print(f"{'=' * 40}")
        for e in edges:
            print(
                f"  {e['player_name']:20s}  {e['stat_type']:20s}  "
                f"Line: {e['line']:5.1f}  Proj: {e['projected_value']:5.1f}  "
                f"Edge: {e['edge_pct']:+6.1f}%  {e['direction']}"
            )

    print("\nDone.")


if __name__ == "__main__":
    main()

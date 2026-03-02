"""
lib/framing.py — Umpire & Catcher Framing Data Helpers
=======================================================

Provides convenient functions for fetching framing composite scores
from the Supabase ``umpire_framing`` table.  These are consumed by
``pipeline/generate_projections.py`` and ``simulator/run_daily.py``
to adjust K/BB probabilities based on the assigned home-plate umpire
and catcher.

Usage::

    from lib.framing import get_umpire_adjustment, get_catcher_adjustment

The adjustments are expressed as multipliers centered on 1.0:
  - > 1.0 → umpire/catcher favours strikeouts
  - < 1.0 → umpire/catcher suppresses strikeouts
  - 1.0   → neutral / no data available

Data source: ``umpire_framing`` table populated by
``pipeline/fetch_umpire_framing.py``.
"""

from __future__ import annotations

import logging
from typing import Optional

log = logging.getLogger("baselinemlb.framing")

# ---------------------------------------------------------------------------
# Lazy Supabase helpers (only imported when actually called)
# ---------------------------------------------------------------------------

_sb_get = None  # Will be bound on first use


def _ensure_supabase():
    """Lazily import sb_get from lib.supabase to avoid import-time side effects."""
    global _sb_get
    if _sb_get is None:
        from lib.supabase import sb_get
        _sb_get = sb_get


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_umpire_strike_rate(
    umpire_name: str,
    *,
    lookback_games: int = 30,
) -> Optional[float]:
    """
    Return the trailing ``lookback_games``-game average ``strike_rate``
    for *umpire_name* from the ``umpire_framing`` table.

    Returns ``None`` if no data is found.
    """
    _ensure_supabase()
    try:
        rows = _sb_get("umpire_framing", {
            "umpire_name": f"eq.{umpire_name}",
            "order": "game_date.desc",
            "limit": str(lookback_games),
        })
        if not rows:
            return None
        rates = [r["strike_rate"] for r in rows if r.get("strike_rate") is not None]
        return sum(rates) / len(rates) if rates else None
    except Exception as exc:
        log.warning("Failed to fetch umpire strike rate for %s: %s", umpire_name, exc)
        return None


def get_catcher_composite(
    catcher_id: int,
    *,
    lookback_games: int = 30,
) -> Optional[float]:
    """
    Return the trailing ``lookback_games``-game average ``composite_score``
    for *catcher_id* from the ``umpire_framing`` table.

    Returns ``None`` if no data is found.
    """
    _ensure_supabase()
    try:
        rows = _sb_get("umpire_framing", {
            "catcher_id": f"eq.{catcher_id}",
            "order": "game_date.desc",
            "limit": str(lookback_games),
        })
        if not rows:
            return None
        scores = [r["composite_score"] for r in rows if r.get("composite_score") is not None]
        return sum(scores) / len(scores) if scores else None
    except Exception as exc:
        log.warning("Failed to fetch catcher composite for %s: %s", catcher_id, exc)
        return None


def get_umpire_adjustment(umpire_name: str) -> float:
    """
    Return a K-probability multiplier based on umpire tendencies.

    - League-average strike rate ≈ 0.32
    - A generous umpire (0.34) → multiplier ≈ 1.03 (±3%)
    - A tight umpire (0.30) → multiplier ≈ 0.97

    Returns 1.0 (neutral) if no data is available.
    """
    LEAGUE_AVG_STRIKE_RATE = 0.32

    rate = get_umpire_strike_rate(umpire_name)
    if rate is None:
        return 1.0

    # Cap adjustment at ±5% to avoid wild swings from small samples
    raw = rate / LEAGUE_AVG_STRIKE_RATE
    return max(0.95, min(1.05, raw))


def get_catcher_adjustment(catcher_id: int) -> float:
    """
    Return a K-probability multiplier based on catcher framing quality.

    ``composite_score`` in the ``umpire_framing`` table is already a
    normalised 0-1 value centred around 0.5, so we map:

    - 0.5 → 1.0 (neutral)
    - 0.6 → 1.03 (elite framer, +3%)
    - 0.4 → 0.97 (poor framer, −3%)

    Returns 1.0 if no data is available.
    """
    score = get_catcher_composite(catcher_id)
    if score is None:
        return 1.0

    # Map [0, 1] → [0.94, 1.06] centred at 0.5 → 1.0
    # Each 0.1 of composite_score ≈ 3% K adjustment
    adjustment = 1.0 + (score - 0.5) * 0.3
    return max(0.94, min(1.06, adjustment))

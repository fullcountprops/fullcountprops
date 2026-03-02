"""
Shared Supabase helper module for BaselineMLB pipeline scripts.

Centralizes connection setup, header generation, and common operations
so individual scripts don't duplicate boilerplate.

Usage:
    from lib.supabase import get_client, sb_headers, sb_get, sb_upsert

Environment Variables (required):
    SUPABASE_URL            Your Supabase project URL
    SUPABASE_SERVICE_KEY    Supabase service role key (for pipeline writes)
"""

import os
import sys
import logging
import requests
from typing import Optional

log = logging.getLogger("baselinemlb.supabase")


def _require_env(name: str) -> str:
    """Return env var value or exit with a clear error."""
    val = os.environ.get(name, "").strip()
    if not val:
        sys.exit(f"Missing required environment variable: {name}")
    return val


def get_url() -> str:
    """Return validated SUPABASE_URL."""
    url = _require_env("SUPABASE_URL")
    if not url.startswith("https://") or not url.endswith(".supabase.co"):
        sys.exit(
            f"Invalid SUPABASE_URL — expected https://xxx.supabase.co, "
            f"got: {url[:30]}..."
        )
    return url


def get_key(prefer_service: bool = True) -> str:
    """
    Return Supabase key from environment.

    Args:
        prefer_service: If True (default), prefer SUPABASE_SERVICE_KEY for
                        pipeline writes.  Falls back to SUPABASE_ANON_KEY.
    """
    if prefer_service:
        key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
        if key:
            return key
    key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    if key:
        return key
    sys.exit("Missing SUPABASE_SERVICE_KEY or SUPABASE_ANON_KEY")


def sb_headers(key: Optional[str] = None) -> dict:
    """Standard Supabase REST headers with merge-duplicates for upserts."""
    if key is None:
        key = get_key()
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }


def sb_get(table: str, params: dict, url: Optional[str] = None) -> list:
    """
    GET rows from a Supabase table via REST API.

    Args:
        table:  Table name (e.g. "games", "players").
        params: Query params dict (e.g. {"game_date": "eq.2026-03-01"}).
        url:    Override SUPABASE_URL (rarely needed).

    Returns:
        List of row dicts.
    """
    base = url or get_url()
    r = requests.get(
        f"{base}/rest/v1/{table}",
        headers=sb_headers(),
        params=params,
    )
    r.raise_for_status()
    return r.json()


def sb_upsert(
    table: str,
    rows: list,
    batch_size: int = 500,
    url: Optional[str] = None,
) -> None:
    """
    Upsert rows into a Supabase table in batches.

    Args:
        table:      Target table name.
        rows:       List of row dicts.
        batch_size: Max rows per request (default 500).
        url:        Override SUPABASE_URL.
    """
    if not rows:
        log.info(f"No rows to upsert into {table}")
        return

    base = url or get_url()
    endpoint = f"{base}/rest/v1/{table}"

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        r = requests.post(endpoint, headers=sb_headers(), json=batch)
        if not r.ok:
            log.warning(f"Upsert failed: {r.status_code} {r.text[:200]}")
        else:
            log.info(f"Upserted {len(batch)} rows into {table}")


def get_client():
    """
    Return a supabase-py Client instance.

    Requires the `supabase` package (pip install supabase).
    """
    try:
        from supabase import create_client
    except ImportError:
        sys.exit("supabase-py required: pip install supabase")

    return create_client(get_url(), get_key())

#!/usr/bin/env python3
"""
track_clv.py — CLV (Closing Line Value) tracking for BaselineMLB.
Compares opening props prices with closing prices to measure sharpness.

CLV = (Our Opening Price - Closing Price) / Closing Price
Positive CLV = we had better info than the closing market
"""

import os
import logging
from datetime import datetime, timedelta
from typing import Optional
from supabase import create_client, Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger(__name__)


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")
    return create_client(url, key)


def calculate_clv_for_date(sb: Client, game_date: str):
    """
    Calculate CLV for all props on a given date.
    Compares the first fetched price (opening) vs last fetched price (closing).
    """
    log.info(f"Calculating CLV for {game_date}")
    
    # Get all props for this date
    props_response = sb.table("props").select("*").eq("game_date", game_date).execute()
    
    if not props_response.data:
        log.info(f"No props found for {game_date}")
        return
    
    clv_records = []
    
    # Group props by player + market
    props_by_key = {}
    for prop in props_response.data:
        key = (prop.get("player_name"), prop.get("market"))
        if key not in props_by_key:
            props_by_key[key] = []
        props_by_key[key].append(prop)
    
    for (player_name, market), props_list in props_by_key.items():
        # Sort by created_at to get opening and closing
        props_list.sort(key=lambda x: x.get("created_at", ""))
        
        if len(props_list) < 2:
            continue  # Need at least 2 prices to calculate CLV
        
        opening_prop = props_list[0]
        closing_prop = props_list[-1]
        
        opening_price = opening_prop.get("price")
        closing_price = closing_prop.get("price")
        opening_line = opening_prop.get("line")
        closing_line = closing_prop.get("line")
        
        if not opening_price or not closing_price:
            continue
        
        # Calculate CLV
        # For betting odds: more negative = favorite, less negative = dog
        # CLV measures if we got better value at opening than closing
        price_movement = opening_price - closing_price
        clv_percent = (price_movement / abs(closing_price)) * 100 if closing_price != 0 else 0
        
        clv_record = {
            "game_date": game_date,
            "player_name": player_name,
            "market": market,
            "opening_price": opening_price,
            "closing_price": closing_price,
            "opening_line": opening_line,
            "closing_line": closing_line,
            "price_movement": price_movement,
            "clv_percent": round(clv_percent, 2),
            "calculated_at": datetime.utcnow().isoformat()
        }
        
        clv_records.append(clv_record)
        log.info(f"CLV for {player_name} {market}: {clv_percent:.2f}%")
    
    # Upsert CLV records
    if clv_records:
        sb.table("clv_tracking").upsert(clv_records).execute()
        log.info(f"Saved {len(clv_records)} CLV records")


if __name__ == "__main__":
    sb = get_supabase()
    
    # Calculate CLV for yesterday (when games are complete)
    yesterday = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%d")
    
    calculate_clv_for_date(sb, yesterday)
    log.info("=== CLV tracking complete ===")

#!/usr/bin/env python3
"""
send_newsletter.py -- FullCountProps
Daily email newsletter system using Resend API.

Sends formatted HTML emails to subscribers with today's
pitcher strikeout projections and confidence scores.

Requires:
  - RESEND_API_KEY env var (for live sends)
  - SUPABASE_URL, SUPABASE_SERVICE_KEY env vars
  - Run after morning projections pipeline (10:30 AM ET)

Usage:
  python pipeline/send_newsletter.py             # Send live newsletter
  python pipeline/send_newsletter.py --dry-run    # Preview without sending (default in CI)
"""

import argparse
import logging
import os
from datetime import date

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("send_newsletter")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
FROM_EMAIL = os.environ.get("NEWSLETTER_FROM", "FullCountProps <noreply@fullcountprops.com>")
SUBSCRIBER_LIST_ID = os.environ.get("RESEND_AUDIENCE_ID", "")


def sb_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }


def resend_headers():
    return {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }


def fetch_projections(game_date: str) -> list:
    """Fetch today's projections from Supabase, ordered by confidence."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.warning("Supabase credentials not configured. Returning empty projections.")
        return []

    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/projections",
            headers=sb_headers(),
            params={
                "game_date": f"eq.{game_date}",
                "stat_type": "eq.pitcher_strikeouts",
                "select": "player_name,projection,confidence,features",
                "order": "confidence.desc",
            },
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f"Failed to fetch projections: {e}")
        return []


def fetch_subscribers() -> list:
    """Fetch active subscribers from Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        log.warning("Supabase credentials not configured. Returning empty subscribers.")
        return []

    try:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/subscribers",
            headers=sb_headers(),
            params={
                "active": "eq.true",
                "select": "email,first_name",
            },
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.warning(f"Failed to fetch subscribers: {e}")
        return []


def build_html(projections: list, game_date: str) -> str:
    """Build HTML email body for newsletter."""
    date_str = game_date  # e.g., "2025-04-15"

    rows_html = ""
    for proj in projections:
        name = proj.get("player_name", "Unknown")
        k_proj = proj.get("projection", 0)
        conf = proj.get("confidence", 0)
        conf_pct = f"{conf * 100:.0f}%"
        conf_color = "#27ae60" if conf >= 0.75 else ("#f39c12" if conf >= 0.60 else "#e74c3c")

        rows_html += f"""
        <tr>
            <td style="padding: 10px; border-bottom: 1px solid #eee;">{name}</td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;"
                ><strong>{k_proj:.1f}</strong></td>
            <td style="padding: 10px; border-bottom: 1px solid #eee; text-align: center;
                       color: {conf_color}; font-weight: bold;">{conf_pct}</td>
        </tr>"""

    html = f"""
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>FullCountProps — Projections for {date_str}</title>
    </head>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #1a1a2e; color: white; padding: 20px; border-radius: 8px;
                    text-align: center; margin-bottom: 20px;">
            <h1 style="margin: 0; font-size: 24px;">⚾ FullCountProps</h1>
            <p style="margin: 5px 0 0;">Daily Pitcher Strikeout Projections</p>
        </div>

        <h2 style="color: #1a1a2e;">Projections for {date_str}</h2>

        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="background: #f8f9fa;">
                    <th style="padding: 10px; text-align: left;">Pitcher</th>
                    <th style="padding: 10px; text-align: center;">Proj. K</th>
                    <th style="padding: 10px; text-align: center;">Confidence</th>
                </tr>
            </thead>
            <tbody>
                {rows_html}
            </tbody>
        </table>

        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 6px;
                    font-size: 12px; color: #666;">
            <p style="margin: 0;">Projections use a glass-box model incorporating career K/9,
            recent form, ballpark factors, umpire tendencies, and catcher framing.</p>
            <p style="margin: 5px 0 0;">This is not financial or gambling advice.</p>
        </div>

        <div style="text-align: center; margin-top: 20px; font-size: 12px; color: #999;">
            <a href="{{ unsubscribe_url }}">Unsubscribe</a>
        </div>
    </body>
    </html>"""
    return html


def send_via_resend(to_email: str, subject: str, html: str, first_name: str = "") -> bool:
    """Send email via Resend API."""
    personalized_html = html.replace("{{first_name}}", first_name or "Baseball Fan")
    payload = {
        "from": FROM_EMAIL,
        "to": [to_email],
        "subject": subject,
        "html": personalized_html,
    }
    r = requests.post(
        "https://api.resend.com/emails",
        headers=resend_headers(),
        json=payload,
    )
    if r.ok:
        log.info(f"  Sent to {to_email}")
        return True
    log.warning(f"  Failed to send to {to_email}: {r.status_code} {r.text[:100]}")
    return False


def run_newsletter(game_date: str = None, dry_run: bool = False):
    """Main newsletter runner."""
    if game_date is None:
        game_date = date.today().isoformat()

    log.info(f"=== Sending newsletter for {game_date} ===")

    if dry_run:
        log.info("DRY RUN mode enabled — will preview newsletter without sending")

    # Fetch projections
    projections = fetch_projections(game_date)
    if not projections:
        log.info("No projections found — skipping newsletter")
        if dry_run:
            log.info("DRY RUN: Would skip newsletter (no projections for today)")
        return

    log.info(f"Found {len(projections)} projections")

    # Build email content
    subject = f"⚾ FullCountProps Projections — {game_date}"
    html = build_html(projections, game_date)

    if dry_run:
        log.info("DRY RUN - Newsletter preview:")
        print(f"\n--- Subject: {subject} ---")
        print(f"--- Projections: {len(projections)} pitchers ---")
        for proj in projections[:10]:
            name = proj.get("player_name", "Unknown")
            k_proj = proj.get("projection", 0)
            conf = proj.get("confidence", 0)
            print(f"  {name}: {k_proj:.1f} K (conf: {conf * 100:.0f}%)")
        if len(projections) > 10:
            print(f"  ... and {len(projections) - 10} more")
        print(f"--- HTML length: {len(html)} chars ---")
        log.info("DRY RUN complete — no emails sent")
        return

    if not RESEND_API_KEY:
        log.error("RESEND_API_KEY not set — aborting (use --dry-run to preview)")
        return

    # Fetch and send to subscribers
    subscribers = fetch_subscribers()
    log.info(f"Sending to {len(subscribers)} subscribers")

    sent = 0
    failed = 0
    for sub in subscribers:
        email = sub.get("email")
        first_name = sub.get("first_name", "")
        if email:
            if send_via_resend(email, subject, html, first_name):
                sent += 1
            else:
                failed += 1

    log.info(f"Newsletter complete: {sent} sent, {failed} failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send FullCountProps daily newsletter")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Preview newsletter without sending emails (default in CI until API keys are configured)",
    )
    parser.add_argument(
        "--date",
        type=str,
        default=None,
        help="Game date to send newsletter for (YYYY-MM-DD, defaults to today)",
    )
    args = parser.parse_args()
    run_newsletter(game_date=args.date, dry_run=args.dry_run)

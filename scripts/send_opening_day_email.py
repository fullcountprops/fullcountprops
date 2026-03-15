#!/usr/bin/env python3
"""
send_opening_day_email.py — FullCountProps
Triggers the Opening Day email blast by calling the Next.js API endpoint.

Reads from environment:
  CRON_SECRET          — must match the CRON_SECRET on the server
  NEXT_PUBLIC_APP_URL  — base URL of the deployed app (e.g. https://www.fullcountprops.com)

Usage:
  CRON_SECRET=... NEXT_PUBLIC_APP_URL=https://www.fullcountprops.com \\
    python scripts/send_opening_day_email.py

The script exits non-zero on any error so it can be used in CI pipelines.
"""

import logging
import os
import sys

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("send_opening_day_email")

CRON_SECRET = os.environ.get("CRON_SECRET", "").strip()
APP_URL = os.environ.get("NEXT_PUBLIC_APP_URL", "").strip().rstrip("/")


def main() -> int:
    # Validate env vars
    missing = [name for name, val in [("CRON_SECRET", CRON_SECRET), ("NEXT_PUBLIC_APP_URL", APP_URL)] if not val]
    if missing:
        log.error("Missing required environment variables: %s", ", ".join(missing))
        return 1

    endpoint = f"{APP_URL}/api/send-opening-day-email"
    log.info("Calling %s", endpoint)

    try:
        resp = requests.post(
            endpoint,
            headers={
                "x-api-secret": CRON_SECRET,
                "Content-Type": "application/json",
            },
            timeout=120,  # allow up to 2 minutes for large lists
        )
    except requests.RequestException as exc:
        log.error("Request failed: %s", exc)
        return 1

    log.info("Status: %s", resp.status_code)

    try:
        data = resp.json()
        log.info("Response: %s", data)
    except ValueError:
        log.warning("Non-JSON response body: %s", resp.text[:200])

    if not resp.ok:
        log.error("Endpoint returned error status %s", resp.status_code)
        return 1

    sent = data.get("sent", 0) if isinstance(data, dict) else 0
    errors = data.get("errors", 0) if isinstance(data, dict) else 0

    log.info("Done — sent: %d, errors: %d", sent, errors)

    if errors > 0:
        log.warning("%d emails failed to send", errors)

    return 0


if __name__ == "__main__":
    sys.exit(main())

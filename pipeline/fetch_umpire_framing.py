#!/usr/bin/env python3
"""
fetch_umpire_framing.py - DEPRECATED

This script previously scraped umpire and catcher framing data from
Baseball Savant, which violates MLB's Terms of Use for automated/
commercial scraping.

Umpire framing composites should be computed from pre-downloaded
Statcast data. See data/README.md for instructions.

This file is retained as a no-op stub so existing workflow references
don't break. It will be removed in a future cleanup.
"""
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main():
    log.info("fetch_umpire_framing.py is DEPRECATED - Savant scraping removed for legal compliance.")
    log.info("Compute umpire framing from pre-downloaded Statcast data instead.")
    log.info("No action taken.")


if __name__ == "__main__":
    main()

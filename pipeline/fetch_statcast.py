#!/usr/bin/env python3
"""
fetch_statcast.py - DEPRECATED

This script previously scraped Statcast data via pybaseball, which
violates MLB's Terms of Use for automated/commercial scraping.

Statcast data should be pre-downloaded locally for model training.
See data/README.md for instructions on obtaining training datasets.

For real-time pitch-level data, use a licensed provider such as:
  - BallDontLie (api.balldontlie.io)
  - MySportsFeeds
  - Rolling Insights

This file is retained as a no-op stub so existing workflow references
don't break. It will be removed in a future cleanup.
"""
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main():
    log.info("fetch_statcast.py is DEPRECATED - Statcast scraping removed for legal compliance.")
    log.info("Use pre-downloaded training data in data/ directory instead.")
    log.info("No action taken.")


if __name__ == "__main__":
    main()

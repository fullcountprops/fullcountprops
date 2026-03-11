#!/usr/bin/env python3
"""
fetch_statcast_historical.py - DEPRECATED

This script previously scraped historical Statcast pitch-by-pitch data
from Baseball Savant, which violates MLB's Terms of Use.

Historical training data should be pre-downloaded once and stored
locally in the data/ directory. See data/README.md.

This file is retained as a no-op stub so existing workflow references
don't break.
"""
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


def main():
    log.info("fetch_statcast_historical.py is DEPRECATED - scraping removed for legal compliance.")
    log.info("Use pre-downloaded training data in data/ directory instead.")
    log.info("No action taken.")


if __name__ == "__main__":
    main()

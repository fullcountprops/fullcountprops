"""
BaselineMLB Monte Carlo Game Simulator
=======================================

A production-grade plate-appearance-level Monte Carlo simulation engine
for MLB player prop projections. Outputs full probability distributions
for strikeouts, hits, total bases, home runs, and other player stats.

Architecture:
    config          — Central configuration, feature lists, park factors
    data_prep       — Statcast / MLB API / Supabase data fetching
    matchup_model   — PA outcome probability model (LightGBM + odds-ratio fallback)
    game_engine     — Monte Carlo game simulator (2,500 iterations/game)
    prop_analyzer   — Compares simulated distributions to sportsbook prop lines
    train_model     — Training pipeline for the LightGBM matchup model
    run_simulation  — CLI entry point for daily simulation runs

Usage:
    # Run today's simulation
    python -m simulation.run_simulation --output json markdown --upload

    # Train the matchup model
    python -m simulation.train_model --seasons 2021 2022 2023 2024 2025

    # Backtest a historical date
    python -m simulation.run_simulation --backtest --backtest-date 2025-07-15

Model Version: mc-v1.0
"""

__version__ = "1.0.0"
__author__ = "BaselineMLB"
__model_version__ = "mc-v1.0"

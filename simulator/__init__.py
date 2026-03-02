"""
simulator — BaselineMLB Monte Carlo Simulation Engine
======================================================

This package implements the full Monte Carlo game-simulation pipeline for
BaselineMLB.  It consists of three primary modules:

monte_carlo_engine
    Core game-simulation logic.  Runs 3 000+ full nine-inning MLB games
    per call, tracking per-batter and per-pitcher statistics for every
    plate appearance.  Outputs rich per-simulation arrays that downstream
    components consume for probability estimation.

prop_calculator
    Converts raw simulation distributions into actionable sportsbook edges.
    Fetches today's prop lines from Supabase, computes over/under
    probabilities, strips the vig, calculates Kelly-criterion bet sizing,
    and attaches glass-box explanations for every recommended wager.

run_daily
    Top-level orchestrator.  Fetches today's games, lineups, weather, and
    props; loads the trained matchup model; drives the simulation engine for
    every scheduled game; and upserts results to Supabase.  Designed to be
    invoked from a cron job or CI/CD pipeline.

Typical usage
-------------
Run the full daily pipeline from the command line::

    python -m simulator.run_daily --date 2026-04-01 --n-sims 3000

Or exercise only the engine in a notebook::

    from simulator.monte_carlo_engine import GameSimulator, SimulationConfig
    sim = GameSimulator()
    result = sim.simulate_game(home_lineup, away_lineup,
                               home_pitcher_probs, away_pitcher_probs,
                               SimulationConfig(n_simulations=500))

Package-level constants
-----------------------
VERSION : str
    Semantic version of the simulator package.
DEFAULT_N_SIMS : int
    Default number of Monte Carlo iterations per game.
"""

VERSION: str = "1.0.0"
DEFAULT_N_SIMS: int = 3_000

__all__ = [
    "VERSION",
    "DEFAULT_N_SIMS",
    "monte_carlo_engine",
    "prop_calculator",
    "run_daily",
]

"""
monte_carlo_engine.py — Core Monte Carlo game simulation engine
===============================================================

Runs 3 000+ full MLB game simulations per call using vectorised NumPy
random sampling.  Each simulation tracks every plate appearance outcome
and produces per-batter / per-pitcher stat arrays that downstream modules
consume for probability-distribution analysis.

Design notes
------------
- Outcome probabilities are supplied as dicts keyed by outcome token
  (e.g. ``{"K": 0.22, "BB": 0.08, "1B": 0.18, ...}``).
- Runner advancement follows simplified but realistic rules; see
  ``_advance_runners`` for details.
- Pitcher fatigue degrades strikeout probability linearly after a
  configurable batter-faced threshold.
- All random draws use a seeded ``numpy.random.Generator`` for
  reproducibility.
- Target wall-clock: 3 000 simulations of a full nine-inning game in
  under 10 seconds on a modern laptop.
"""

from __future__ import annotations

import argparse
import logging
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy import stats as scipy_stats

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Outcome tokens (ordered for numpy searchsorted vectorisation)
# ---------------------------------------------------------------------------
OUTCOMES: list[str] = ["K", "BB", "HBP", "1B", "2B", "3B", "HR", "OUT"]

# Bases as integer flags: 0=empty, 1=runner present
FIRST = 0
SECOND = 1
THIRD = 2


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass
class SimulationConfig:
    """Hyper-parameters that control a simulation run.

    Attributes
    ----------
    n_simulations:
        Number of full-game Monte Carlo iterations.
    innings:
        Regulation innings per game (9 for MLB).
    dh_rule:
        If True, apply universal designated-hitter rule (pitcher does not bat).
    lineup_size:
        Number of batters in the lineup (always 9 in MLB).
    fatigue_threshold:
        Batters faced before pitcher fatigue begins affecting strikeout rate.
    fatigue_k_decay:
        Fractional reduction in K-probability per batter faced above threshold.
    random_seed:
        Seed for ``numpy.random.default_rng``; ``None`` for non-deterministic.
    max_extras:
        Maximum extra-inning half-frames to simulate before forcing a tie result.
    """

    n_simulations: int = 3_000
    innings: int = 9
    dh_rule: bool = True
    lineup_size: int = 9
    fatigue_threshold: int = 25
    fatigue_k_decay: float = 0.02
    random_seed: int | None = 42
    max_extras: int = 6


@dataclass
class PlateAppearanceResult:
    """The resolved outcome of a single plate appearance.

    Attributes
    ----------
    outcome:
        One of the OUTCOMES tokens.
    total_bases:
        Bases earned by the batter (0 for K/BB/HBP/OUT, 1-4 for hits/HR).
    is_hit:
        True for 1B, 2B, 3B, HR.
    is_walk:
        True for BB or HBP.
    is_strikeout:
        True for K.
    """

    outcome: str
    total_bases: int
    is_hit: bool
    is_walk: bool
    is_strikeout: bool


@dataclass
class GameState:
    """Mutable game state for a single simulation iteration.

    Attributes
    ----------
    inning:
        Current inning number (1-indexed).
    half:
        ``"top"`` or ``"bottom"``.
    outs:
        Outs recorded in the current half-inning (0-2).
    runners:
        Three-element list: ``[first, second, third]``, each 0 or 1.
    score:
        ``[away_score, home_score]``.
    batting_order_idx:
        Current position in the nine-batter lineup (0-8).
    pitcher_batters_faced:
        Running count of batters faced by the current pitcher.
    """

    inning: int = 1
    half: str = "top"  # "top" = away bats, "bottom" = home bats
    outs: int = 0
    runners: list[int] = field(default_factory=lambda: [0, 0, 0])
    score: list[int] = field(default_factory=lambda: [0, 0])
    batting_order_idx: int = 0
    pitcher_batters_faced: int = 0

    def reset_half_inning(self) -> None:
        """Clear runners and outs for the start of a new half-inning."""
        self.outs = 0
        self.runners = [0, 0, 0]

    def runs_scored(self) -> int:
        """Return the number of runners currently on base (convenience)."""
        return sum(self.runners)


@dataclass
class SimulationResult:
    """Raw per-simulation stat arrays for a single game.

    All arrays have shape ``(n_simulations,)`` unless otherwise noted.

    Attributes
    ----------
    home_scores:
        Home team run total for each simulation.
    away_scores:
        Away team run total for each simulation.
    batter_hits:
        Dict keyed by batter_id → array of hit counts.
    batter_total_bases:
        Dict keyed by batter_id → array of total-bases counts.
    batter_walks:
        Dict keyed by batter_id → array of walk counts.
    batter_strikeouts:
        Dict keyed by batter_id → array of strikeout counts.
    batter_rbis:
        Dict keyed by batter_id → array of RBI counts.
    batter_runs:
        Dict keyed by batter_id → array of run counts.
    pitcher_strikeouts:
        Dict keyed by pitcher_id → array of strikeout counts.
    pitcher_walks:
        Dict keyed by pitcher_id → array of walk (BB+HBP) counts.
    pitcher_hits_allowed:
        Dict keyed by pitcher_id → array of hits-allowed counts.
    pitcher_innings:
        Dict keyed by pitcher_id → array of innings-pitched (float).
    pitcher_pitches:
        Dict keyed by pitcher_id → array of estimated pitch counts.
    """

    home_scores: np.ndarray = field(default_factory=lambda: np.array([]))
    away_scores: np.ndarray = field(default_factory=lambda: np.array([]))
    batter_hits: dict[str, np.ndarray] = field(default_factory=dict)
    batter_total_bases: dict[str, np.ndarray] = field(default_factory=dict)
    batter_walks: dict[str, np.ndarray] = field(default_factory=dict)
    batter_strikeouts: dict[str, np.ndarray] = field(default_factory=dict)
    batter_rbis: dict[str, np.ndarray] = field(default_factory=dict)
    batter_runs: dict[str, np.ndarray] = field(default_factory=dict)
    pitcher_strikeouts: dict[str, np.ndarray] = field(default_factory=dict)
    pitcher_walks: dict[str, np.ndarray] = field(default_factory=dict)
    pitcher_hits_allowed: dict[str, np.ndarray] = field(default_factory=dict)
    pitcher_innings: dict[str, np.ndarray] = field(default_factory=dict)
    pitcher_pitches: dict[str, np.ndarray] = field(default_factory=dict)


@dataclass
class StatSummary:
    """Descriptive statistics for a single player-stat distribution.

    Attributes
    ----------
    mean / median / std:
        Central-tendency and spread measures.
    p10 / p25 / p75 / p90:
        Percentile values.
    min / max:
        Extreme values observed across simulations.
    """

    mean: float = 0.0
    median: float = 0.0
    std: float = 0.0
    p10: float = 0.0
    p25: float = 0.0
    p75: float = 0.0
    p90: float = 0.0
    min: float = 0.0
    max: float = 0.0

    def prob_over(self, threshold: float) -> float:
        """Return the empirical probability that the stat exceeds *threshold*.

        Note: this method is populated post-hoc by ``SimulationSummary``
        using the underlying raw array; it is a placeholder on the
        dataclass itself.
        """
        raise NotImplementedError(
            "Call SimulationSummary.prob_over(player_id, stat, threshold) instead."
        )


@dataclass
class SimulationSummary:
    """Aggregated distributions across all Monte Carlo iterations.

    Attributes
    ----------
    n_simulations:
        Number of iterations used to build this summary.
    home_score:
        Score distribution summary for the home team.
    away_score:
        Score distribution summary for the away team.
    batter_stats:
        Nested dict: ``batter_id → stat_name → StatSummary``.
    pitcher_stats:
        Nested dict: ``pitcher_id → stat_name → StatSummary``.
    raw:
        Reference to the underlying ``SimulationResult`` for ad-hoc queries.
    """

    n_simulations: int = 0
    home_score: StatSummary = field(default_factory=StatSummary)
    away_score: StatSummary = field(default_factory=StatSummary)
    batter_stats: dict[str, dict[str, StatSummary]] = field(default_factory=dict)
    pitcher_stats: dict[str, dict[str, StatSummary]] = field(default_factory=dict)
    raw: SimulationResult | None = None

    def prob_over(self, player_id: str, stat: str, threshold: float) -> float:
        """Return P(stat > threshold) for a player across all simulations.

        Parameters
        ----------
        player_id:
            Batter or pitcher identifier.
        stat:
            Stat key, e.g. ``"strikeouts"`` or ``"hits"``.
        threshold:
            The line to compare against.

        Returns
        -------
        float
            Probability in [0, 1].
        """
        arr = self._get_raw_array(player_id, stat)
        if arr is None:
            return 0.0
        return float(np.mean(arr > threshold))

    def prob_under(self, player_id: str, stat: str, threshold: float) -> float:
        """Return P(stat < threshold) for a player across all simulations."""
        arr = self._get_raw_array(player_id, stat)
        if arr is None:
            return 0.0
        return float(np.mean(arr < threshold))

    def _get_raw_array(self, player_id: str, stat: str) -> np.ndarray | None:
        """Retrieve the raw simulation array for *player_id* / *stat*."""
        if self.raw is None:
            return None
        batter_map: dict[str, dict[str, np.ndarray]] = {
            "hits": self.raw.batter_hits,
            "total_bases": self.raw.batter_total_bases,
            "walks": self.raw.batter_walks,
            "strikeouts": self.raw.batter_strikeouts,
            "rbis": self.raw.batter_rbis,
            "runs": self.raw.batter_runs,
        }
        pitcher_map: dict[str, dict[str, np.ndarray]] = {
            "strikeouts": self.raw.pitcher_strikeouts,
            "walks": self.raw.pitcher_walks,
            "hits_allowed": self.raw.pitcher_hits_allowed,
            "innings": self.raw.pitcher_innings,
            "pitches": self.raw.pitcher_pitches,
        }
        if stat in batter_map and player_id in batter_map[stat]:
            return batter_map[stat][player_id]
        if stat in pitcher_map and player_id in pitcher_map[stat]:
            return pitcher_map[stat][player_id]
        return None


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------


def _normalise_probs(prob_dict: dict[str, float]) -> dict[str, float]:
    """Ensure outcome probabilities sum to 1.0 (re-normalise if needed).

    Parameters
    ----------
    prob_dict:
        Raw probability dict from the matchup model.

    Returns
    -------
    dict[str, float]
        Normalised dict; missing outcomes are filled with 0.
    """
    full: dict[str, float] = {o: prob_dict.get(o, 0.0) for o in OUTCOMES}
    total = sum(full.values())
    if total <= 0:
        # Fallback to league-average distribution
        full = {
            "K": 0.225,
            "BB": 0.085,
            "HBP": 0.010,
            "1B": 0.155,
            "2B": 0.050,
            "3B": 0.005,
            "HR": 0.035,
            "OUT": 0.435,
        }
        total = 1.0
    return {k: v / total for k, v in full.items()}


def _summarise_array(arr: np.ndarray) -> StatSummary:
    """Compute descriptive statistics over a 1-D array.

    Parameters
    ----------
    arr:
        1-D NumPy array of simulation outcomes.

    Returns
    -------
    StatSummary
    """
    return StatSummary(
        mean=float(np.mean(arr)),
        median=float(np.median(arr)),
        std=float(np.std(arr)),
        p10=float(np.percentile(arr, 10)),
        p25=float(np.percentile(arr, 25)),
        p75=float(np.percentile(arr, 75)),
        p90=float(np.percentile(arr, 90)),
        min=float(np.min(arr)),
        max=float(np.max(arr)),
    )


# ---------------------------------------------------------------------------
# Plate appearance resolver
# ---------------------------------------------------------------------------


class PlateAppearance:
    """Resolve a single plate appearance outcome given matchup probabilities.

    Parameters
    ----------
    rng:
        Shared ``numpy.random.Generator`` instance.
    """

    _TOTAL_BASES: dict[str, int] = {
        "K": 0,
        "BB": 0,
        "HBP": 0,
        "1B": 1,
        "2B": 2,
        "3B": 3,
        "HR": 4,
        "OUT": 0,
    }

    def __init__(self, rng: np.random.Generator) -> None:
        """Initialise with a shared RNG."""
        self._rng = rng

    def resolve(
        self,
        pitcher_id: str,  # noqa: ARG002  (kept for API clarity / future use)
        batter_id: str,  # noqa: ARG002
        matchup_probs: dict[str, float],
        fatigue_factor: float = 1.0,
    ) -> PlateAppearanceResult:
        """Draw one outcome from the matchup probability distribution.

        Parameters
        ----------
        pitcher_id:
            Pitcher identifier (reserved for logging / SHAP).
        batter_id:
            Batter identifier (reserved for logging / SHAP).
        matchup_probs:
            Dict of outcome → probability (need not sum to exactly 1.0).
        fatigue_factor:
            Multiplier applied to the K probability before re-normalising;
            < 1.0 reduces K rate to model pitcher fatigue.

        Returns
        -------
        PlateAppearanceResult
        """
        probs = _normalise_probs(matchup_probs)

        # Apply fatigue to K probability
        if fatigue_factor != 1.0:
            k_raw = probs["K"] * fatigue_factor
            reduction = probs["K"] - k_raw
            # Redistribute the reduction proportionally to non-K outcomes
            non_k_total = sum(v for k, v in probs.items() if k != "K")
            probs = {
                o: (k_raw if o == "K" else v + reduction * v / non_k_total)
                for o, v in probs.items()
            }

        # Build cumulative distribution in OUTCOMES order
        cum_probs = np.cumsum([probs[o] for o in OUTCOMES])
        draw = self._rng.random()
        idx = int(np.searchsorted(cum_probs, draw))
        idx = min(idx, len(OUTCOMES) - 1)
        outcome = OUTCOMES[idx]

        return PlateAppearanceResult(
            outcome=outcome,
            total_bases=self._TOTAL_BASES[outcome],
            is_hit=outcome in ("1B", "2B", "3B", "HR"),
            is_walk=outcome in ("BB", "HBP"),
            is_strikeout=outcome == "K",
        )


# ---------------------------------------------------------------------------
# Runner advancement
# ---------------------------------------------------------------------------


def _advance_runners(
    runners: list[int],
    outcome: str,
    score_side: int,
    score: list[int],
) -> tuple[list[int], int]:
    """Update base state and score given a plate appearance outcome.

    Parameters
    ----------
    runners:
        Current ``[first, second, third]`` base occupancy (0/1).
    outcome:
        PA outcome token.
    score_side:
        Index into *score* list (0=away, 1=home).
    score:
        Mutable ``[away, home]`` list updated in-place.

    Returns
    -------
    tuple[list[int], int]
        Updated runners list and RBI count for this PA.
    """
    new_runners = list(runners)
    rbis = 0

    if outcome == "K" or outcome == "OUT":
        # No runner movement
        pass

    elif outcome in ("BB", "HBP"):
        # Force-advance: batter takes first; push runners only if forced
        if new_runners[FIRST]:
            if new_runners[SECOND]:
                if new_runners[THIRD]:
                    # Bases loaded → run scores
                    score[score_side] += 1
                    rbis += 1
                new_runners[THIRD] = new_runners[SECOND]
            new_runners[SECOND] = new_runners[FIRST]
        new_runners[FIRST] = 1

    elif outcome == "1B":
        # Third scores, second advances to third, first advances to second
        if new_runners[THIRD]:
            score[score_side] += 1
            rbis += 1
        new_runners[THIRD] = new_runners[SECOND]
        new_runners[SECOND] = new_runners[FIRST]
        new_runners[FIRST] = 1

    elif outcome == "2B":
        # All runners score; batter to second
        runs = sum(new_runners)
        score[score_side] += runs
        rbis += runs
        new_runners = [0, 1, 0]

    elif outcome == "3B":
        # All runners score; batter to third
        runs = sum(new_runners)
        score[score_side] += runs
        rbis += runs
        new_runners = [0, 0, 1]

    elif outcome == "HR":
        # Everyone scores including batter
        runs = sum(new_runners) + 1
        score[score_side] += runs
        rbis += runs
        new_runners = [0, 0, 0]

    return new_runners, rbis


# ---------------------------------------------------------------------------
# Core simulator
# ---------------------------------------------------------------------------


class GameSimulator:
    """Run Monte Carlo simulations of a full MLB game.

    Parameters
    ----------
    config:
        Default ``SimulationConfig``; can be overridden per call to
        ``simulate_game``.
    """

    def __init__(self, config: SimulationConfig | None = None) -> None:
        """Initialise with optional default configuration."""
        self._default_config = config or SimulationConfig()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def simulate_game(
        self,
        home_lineup: list[str],
        away_lineup: list[str],
        home_pitcher_probs: dict[str, dict[str, float]],
        away_pitcher_probs: dict[str, dict[str, float]],
        config: SimulationConfig | None = None,
        home_pitcher_id: str | None = None,
        away_pitcher_id: str | None = None,
    ) -> SimulationResult:
        """Simulate *n_simulations* full games and return raw stat arrays.

        Parameters
        ----------
        home_lineup:
            Ordered list of batter IDs for the home team (length 9).
        away_lineup:
            Ordered list of batter IDs for the away team (length 9).
        home_pitcher_probs:
            ``{batter_id: {outcome: prob}}`` — home pitcher vs. each
            away batter.  Keys must cover every batter in *away_lineup*.
        away_pitcher_probs:
            ``{batter_id: {outcome: prob}}`` — away pitcher vs. each
            home batter.
        config:
            Override default simulation parameters.
        home_pitcher_id:
            MLBAM player ID for the home starting pitcher.  Used as the
            key in pitcher stat accumulators so downstream consumers
            (prop calculator, Supabase) can match on real player IDs.
            Falls back to a generated opaque key when *None*.
        away_pitcher_id:
            Same as above for the away starting pitcher.

        Returns
        -------
        SimulationResult
            Per-simulation stat arrays for every player.
        """
        cfg = config or self._default_config
        rng = np.random.default_rng(cfg.random_seed)
        pa_resolver = PlateAppearance(rng)

        n = cfg.n_simulations

        # Initialise accumulator arrays
        home_scores = np.zeros(n, dtype=np.int32)
        away_scores = np.zeros(n, dtype=np.int32)

        all_batters = list(set(home_lineup + away_lineup))
        # Use real pitcher IDs when provided, else generate opaque keys
        home_pitcher_id = home_pitcher_id or f"home_sp_{id(home_pitcher_probs)}"
        away_pitcher_id = away_pitcher_id or f"away_sp_{id(away_pitcher_probs)}"

        b_hits = {b: np.zeros(n, dtype=np.int32) for b in all_batters}
        b_tb = {b: np.zeros(n, dtype=np.int32) for b in all_batters}
        b_bb = {b: np.zeros(n, dtype=np.int32) for b in all_batters}
        b_k = {b: np.zeros(n, dtype=np.int32) for b in all_batters}
        b_rbi = {b: np.zeros(n, dtype=np.int32) for b in all_batters}
        b_runs = {b: np.zeros(n, dtype=np.int32) for b in all_batters}

        p_k = {p: np.zeros(n, dtype=np.int32) for p in [home_pitcher_id, away_pitcher_id]}
        p_bb = {p: np.zeros(n, dtype=np.int32) for p in [home_pitcher_id, away_pitcher_id]}
        p_ha = {p: np.zeros(n, dtype=np.int32) for p in [home_pitcher_id, away_pitcher_id]}
        p_ip = {p: np.zeros(n, dtype=np.float32) for p in [home_pitcher_id, away_pitcher_id]}
        p_pc = {p: np.zeros(n, dtype=np.int32) for p in [home_pitcher_id, away_pitcher_id]}

        logger.info(
            "Starting %d simulations (home=%d batters, away=%d batters)",
            n,
            len(home_lineup),
            len(away_lineup),
        )
        t0 = time.perf_counter()

        for sim_idx in range(n):
            self._run_single_game(
                sim_idx=sim_idx,
                home_lineup=home_lineup,
                away_lineup=away_lineup,
                home_pitcher_probs=home_pitcher_probs,
                away_pitcher_probs=away_pitcher_probs,
                home_pitcher_id=home_pitcher_id,
                away_pitcher_id=away_pitcher_id,
                cfg=cfg,
                pa_resolver=pa_resolver,
                home_scores=home_scores,
                away_scores=away_scores,
                b_hits=b_hits,
                b_tb=b_tb,
                b_bb=b_bb,
                b_k=b_k,
                b_rbi=b_rbi,
                b_runs=b_runs,
                p_k=p_k,
                p_bb=p_bb,
                p_ha=p_ha,
                p_ip=p_ip,
                p_pc=p_pc,
            )

        elapsed = time.perf_counter() - t0
        logger.info("Completed %d simulations in %.2fs (%.1f sims/sec)", n, elapsed, n / elapsed)

        return SimulationResult(
            home_scores=home_scores,
            away_scores=away_scores,
            batter_hits=b_hits,
            batter_total_bases=b_tb,
            batter_walks=b_bb,
            batter_strikeouts=b_k,
            batter_rbis=b_rbi,
            batter_runs=b_runs,
            pitcher_strikeouts=p_k,
            pitcher_walks=p_bb,
            pitcher_hits_allowed=p_ha,
            pitcher_innings=p_ip,
            pitcher_pitches=p_pc,
        )

    # ------------------------------------------------------------------
    # Internal simulation loop
    # ------------------------------------------------------------------

    def _run_single_game(  # noqa: PLR0913  (many params needed for perf)
        self,
        sim_idx: int,
        home_lineup: list[str],
        away_lineup: list[str],
        home_pitcher_probs: dict[str, dict[str, float]],
        away_pitcher_probs: dict[str, dict[str, float]],
        home_pitcher_id: str,
        away_pitcher_id: str,
        cfg: SimulationConfig,
        pa_resolver: PlateAppearance,
        home_scores: np.ndarray,
        away_scores: np.ndarray,
        b_hits: dict[str, np.ndarray],
        b_tb: dict[str, np.ndarray],
        b_bb: dict[str, np.ndarray],
        b_k: dict[str, np.ndarray],
        b_rbi: dict[str, np.ndarray],
        b_runs: dict[str, np.ndarray],
        p_k: dict[str, np.ndarray],
        p_bb: dict[str, np.ndarray],
        p_ha: dict[str, np.ndarray],
        p_ip: dict[str, np.ndarray],
        p_pc: dict[str, np.ndarray],
    ) -> None:
        """Simulate one full game and accumulate stats into preallocated arrays.

        Parameters
        ----------
        sim_idx:
            Index into result arrays for this simulation.
        All other parameters mirror ``simulate_game``; see that method.
        """
        state = GameState()

        # Per-pitcher outs tracker (to compute IP)
        home_pitcher_outs = 0
        away_pitcher_outs = 0
        home_pitcher_bf = 0
        away_pitcher_bf = 0

        # Batting-order cursors (persist across innings)
        away_order_idx = 0
        home_order_idx = 0

        # Runners on base at end of each PA (for run-scored credit)
        batter_on_base: list[str | None] = [None, None, None]

        max_innings = cfg.innings + cfg.max_extras

        for inning in range(1, max_innings + 1):
            for half in ("top", "bottom"):
                # top = away bats vs home pitcher
                # bottom = home bats vs away pitcher
                if half == "top":
                    batting_lineup = away_lineup
                    pitcher_probs = home_pitcher_probs
                    pitcher_id = home_pitcher_id
                    score_side = 0  # away
                    order_cursor = away_order_idx
                    pitcher_bf_ref = home_pitcher_bf
                else:
                    batting_lineup = home_lineup
                    pitcher_probs = away_pitcher_probs
                    pitcher_id = away_pitcher_id
                    score_side = 1  # home
                    order_cursor = home_order_idx
                    pitcher_bf_ref = away_pitcher_bf

                outs = 0
                runners: list[int] = [0, 0, 0]
                on_base_ids: list[str | None] = [None, None, None]
                score = state.score

                while outs < 3:
                    batter_id = batting_lineup[order_cursor % cfg.lineup_size]
                    order_cursor += 1

                    # Compute fatigue factor
                    excess = max(0, pitcher_bf_ref - cfg.fatigue_threshold)
                    fatigue = max(0.5, 1.0 - excess * cfg.fatigue_k_decay)

                    probs = pitcher_probs.get(batter_id, {})
                    pa_result = pa_resolver.resolve(
                        pitcher_id, batter_id, probs, fatigue_factor=fatigue
                    )
                    pitcher_bf_ref += 1

                    # Estimate pitches (simplified: K=5, BB=6, HBP=3, hit=4, out=3.5)
                    pitch_est = {
                        "K": 5, "BB": 6, "HBP": 3,
                        "1B": 4, "2B": 4, "3B": 4, "HR": 4, "OUT": 3,
                    }.get(pa_result.outcome, 4)
                    if pitcher_id == home_pitcher_id:
                        p_pc[pitcher_id][sim_idx] += pitch_est
                    else:
                        p_pc[pitcher_id][sim_idx] += pitch_est

                    # Batter stats
                    if pa_result.is_hit:
                        b_hits[batter_id][sim_idx] += 1
                        b_tb[batter_id][sim_idx] += pa_result.total_bases
                        p_ha[pitcher_id][sim_idx] += 1
                    if pa_result.is_walk:
                        b_bb[batter_id][sim_idx] += 1
                        p_bb[pitcher_id][sim_idx] += 1
                    if pa_result.is_strikeout:
                        b_k[batter_id][sim_idx] += 1
                        p_k[pitcher_id][sim_idx] += 1

                    if pa_result.outcome == "K" or pa_result.outcome == "OUT":
                        outs += 1
                    else:
                        # Advance runners; check which runner IDs scored
                        prev_score = score[score_side]
                        runners, rbis = _advance_runners(
                            runners, pa_result.outcome, score_side, score
                        )
                        b_rbi[batter_id][sim_idx] += rbis
                        runs_scored_this_pa = score[score_side] - prev_score

                        # Credit runs to the batters who were on base
                        if pa_result.outcome == "HR":
                            b_runs[batter_id][sim_idx] += 1  # batter scores too
                            for slot, occ in enumerate(on_base_ids):
                                if occ is not None and runners[slot] == 0:
                                    b_runs[occ][sim_idx] += 1

                        # Update runner IDs on base
                        if pa_result.outcome == "1B":
                            on_base_ids[SECOND] = on_base_ids[FIRST]
                            on_base_ids[FIRST] = batter_id
                            on_base_ids[THIRD] = None  # simplified: was on 2nd, scored
                        elif pa_result.outcome == "2B":
                            on_base_ids = [None, batter_id, None]
                        elif pa_result.outcome == "3B":
                            on_base_ids = [None, None, batter_id]
                        elif pa_result.outcome in ("BB", "HBP"):
                            on_base_ids[SECOND] = on_base_ids[FIRST]
                            on_base_ids[FIRST] = batter_id

                # End of half-inning — record IP
                if half == "top":
                    home_pitcher_outs += outs
                    home_pitcher_bf = pitcher_bf_ref
                    away_order_idx = order_cursor
                    p_ip[home_pitcher_id][sim_idx] = home_pitcher_outs / 3.0
                else:
                    away_pitcher_outs += outs
                    away_pitcher_bf = pitcher_bf_ref
                    home_order_idx = order_cursor
                    p_ip[away_pitcher_id][sim_idx] = away_pitcher_outs / 3.0

                # Check walk-off / game-over conditions
                if inning >= cfg.innings and half == "bottom":
                    if score[1] != score[0]:  # home team either wins or loses
                        break

            # After each full inning past regulation, check for tie resolution
            if inning >= cfg.innings and state.score[0] != state.score[1]:
                break

        home_scores[sim_idx] = state.score[1]
        away_scores[sim_idx] = state.score[0]

    # ------------------------------------------------------------------
    # Summarisation
    # ------------------------------------------------------------------

    def summarise(self, result: SimulationResult) -> SimulationSummary:
        """Aggregate raw per-simulation arrays into a ``SimulationSummary``.

        Parameters
        ----------
        result:
            Output from ``simulate_game``.

        Returns
        -------
        SimulationSummary
        """
        n = len(result.home_scores)

        batter_stat_maps: dict[str, dict[str, np.ndarray]] = {
            "hits": result.batter_hits,
            "total_bases": result.batter_total_bases,
            "walks": result.batter_walks,
            "strikeouts": result.batter_strikeouts,
            "rbis": result.batter_rbis,
            "runs": result.batter_runs,
        }
        pitcher_stat_maps: dict[str, dict[str, np.ndarray]] = {
            "strikeouts": result.pitcher_strikeouts,
            "walks": result.pitcher_walks,
            "hits_allowed": result.pitcher_hits_allowed,
            "innings": result.pitcher_innings,
            "pitches": result.pitcher_pitches,
        }

        batter_stats: dict[str, dict[str, StatSummary]] = {}
        for stat, player_dict in batter_stat_maps.items():
            for pid, arr in player_dict.items():
                batter_stats.setdefault(pid, {})[stat] = _summarise_array(arr)

        pitcher_stats: dict[str, dict[str, StatSummary]] = {}
        for stat, player_dict in pitcher_stat_maps.items():
            for pid, arr in player_dict.items():
                pitcher_stats.setdefault(pid, {})[stat] = _summarise_array(arr)

        return SimulationSummary(
            n_simulations=n,
            home_score=_summarise_array(result.home_scores),
            away_score=_summarise_array(result.away_scores),
            batter_stats=batter_stats,
            pitcher_stats=pitcher_stats,
            raw=result,
        )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _build_demo_game(
    n_batters: int = 9,
) -> tuple[list[str], list[str], dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    """Build synthetic lineups and matchup probabilities for demonstration."""
    home_lineup = [f"home_b{i}" for i in range(n_batters)]
    away_lineup = [f"away_b{i}" for i in range(n_batters)]

    default_probs: dict[str, float] = {
        "K": 0.225, "BB": 0.085, "HBP": 0.010,
        "1B": 0.155, "2B": 0.050, "3B": 0.005,
        "HR": 0.035, "OUT": 0.435,
    }

    home_pitcher_probs = {b: dict(default_probs) for b in away_lineup}
    away_pitcher_probs = {b: dict(default_probs) for b in home_lineup}
    return home_lineup, away_lineup, home_pitcher_probs, away_pitcher_probs


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Run a demo Monte Carlo MLB game simulation."
    )
    parser.add_argument(
        "--n-sims", type=int, default=3_000, help="Number of simulations (default: 3000)"
    )
    parser.add_argument(
        "--seed", type=int, default=42, help="Random seed (default: 42)"
    )
    parser.add_argument(
        "--quiet", action="store_true", help="Suppress INFO logs"
    )
    args = parser.parse_args()

    if args.quiet:
        logging.getLogger().setLevel(logging.WARNING)

    home_l, away_l, hp_probs, ap_probs = _build_demo_game()
    sim_cfg = SimulationConfig(n_simulations=args.n_sims, random_seed=args.seed)
    engine = GameSimulator(sim_cfg)

    t_start = time.perf_counter()
    sim_result = engine.simulate_game(home_l, away_l, hp_probs, ap_probs, sim_cfg)
    summary = engine.summarise(sim_result)
    t_total = time.perf_counter() - t_start

    print(f"\n{'='*60}")
    print(f"  Demo: {args.n_sims} simulations completed in {t_total:.2f}s")
    print(f"  Home avg score : {summary.home_score.mean:.2f} (std {summary.home_score.std:.2f})")
    print(f"  Away avg score : {summary.away_score.mean:.2f} (std {summary.away_score.std:.2f})")
    first_batter = home_l[0]
    b = summary.batter_stats.get(first_batter, {})
    print(f"  {first_batter} avg hits: {b.get('hits', StatSummary()).mean:.3f}")
    print(f"{'='*60}\n")

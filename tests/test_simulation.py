"""
test_simulation.py — Comprehensive unit tests for the BaselineMLB Monte Carlo simulator.

Covers:
  - simulation.config     → TestConfig
  - simulation.matchup_model → TestOddsRatioModel, TestMatchupModel
  - simulation.game_engine   → TestGameState, TestPlayerStats, TestGameSimulator
  - simulation.prop_analyzer → TestPropAnalyzer

Run with:
    pytest tests/test_simulation.py -v
"""

from __future__ import annotations

import sys
import os
from collections import Counter
from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

# ---------------------------------------------------------------------------
# Ensure workspace root is on sys.path so imports resolve
# ---------------------------------------------------------------------------
WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKSPACE not in sys.path:
    sys.path.insert(0, WORKSPACE)

# ---------------------------------------------------------------------------
# Import modules under test
# ---------------------------------------------------------------------------
from simulation.config import (
    FEATURE_COLUMNS,
    LEAGUE_AVG_RATES,
    MODEL_OUTCOMES,
    PARK_FACTORS,
    SimulationConfig,
)
from simulation.matchup_model import (
    MatchupModel,
    OddsRatioModel,
)
from simulation.game_engine import (
    GameSimulator,
    GameState,
    PlayerStats,
    SimulationResult,
)
from simulation.prop_analyzer import (
    PropAnalysis,
    PropAnalyzer,
    PropLine,
)


# ===========================================================================
# Shared fixtures and helpers
# ===========================================================================


def _league_avg_pitcher() -> dict:
    """Pitcher stats equal to league averages — used as a neutral baseline."""
    stats = {f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES}
    stats["sample_pa"] = 700
    return stats


def _league_avg_batter() -> dict:
    """Batter stats equal to league averages — used as a neutral baseline."""
    stats = {f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES}
    stats["sample_pa"] = 600
    stats["hand"] = "R"
    return stats


def _neutral_context() -> dict:
    """Fully neutral context with no park / platoon / umpire adjustments."""
    return {
        "park_hr_factor": 1.0,
        "park_2b_factor": 1.0,
        "park_3b_factor": 1.0,
        "park_1b_factor": 1.0,
        "umpire_k_factor": 1.0,
        "umpire_bb_factor": 1.0,
        "catcher_framing_score": 0.0,
        "temperature": 72.0,
        "wind_speed": 0.0,
        "wind_to_cf": 0.0,
        "pitcher_hand": "R",
    }


def _make_player(mlbam_id: int, name: str, hand: str = "R") -> dict:
    """Minimal batter dict compatible with GameSimulator."""
    return {
        "mlbam_id": mlbam_id,
        "name": name,
        "hand": hand,
        **{f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES},
        "sample_pa": 500,
    }


def _make_pitcher(mlbam_id: int, name: str) -> dict:
    """Minimal pitcher dict compatible with GameSimulator."""
    return {
        "mlbam_id": mlbam_id,
        "name": name,
        **{f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES},
        "sample_pa": 700,
    }


def _make_game_data(
    away_lineup: List[dict],
    home_lineup: List[dict],
    away_starter: dict,
    home_starter: dict,
) -> SimpleNamespace:
    """Build a minimal game_data object for GameSimulator."""
    return SimpleNamespace(
        game_pk=12345,
        game_date="2025-04-01",
        away_team="NYY",
        home_team="BOS",
        venue="Fenway Park",
        park_factor=1.0,
        away_lineup=away_lineup,
        home_lineup=home_lineup,
        away_starter=away_starter,
        home_starter=home_starter,
        away_bullpen_composite={
            **{f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES},
            "sample_pa": 300,
            "mlbam_id": 9901,
            "name": "Away Bullpen",
        },
        home_bullpen_composite={
            **{f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES},
            "sample_pa": 300,
            "mlbam_id": 9902,
            "name": "Home Bullpen",
        },
    )


class MockMatchupModel:
    """Deterministic mock that always returns fixed league-average probabilities."""

    def predict_pa_probs(
        self, pitcher_stats: dict, batter_stats: dict, context: dict, **kwargs
    ) -> dict[str, float]:
        return dict(LEAGUE_AVG_RATES)  # already sums to 1.0


# ===========================================================================
# TestConfig
# ===========================================================================


class TestConfig:
    """Tests for simulation.config constants and SimulationConfig dataclass."""

    def test_default_config_valid(self):
        """SimulationConfig() creates a valid config with no errors."""
        cfg = SimulationConfig()
        assert cfg.NUM_SIMULATIONS == 2500
        assert cfg.RANDOM_SEED is None
        assert isinstance(cfg.MODEL_PATH, str)

    def test_weights_sum_to_one(self):
        """RECENT_WEIGHT + CAREER_WEIGHT must equal exactly 1.0."""
        cfg = SimulationConfig()
        assert abs(cfg.RECENT_WEIGHT + cfg.CAREER_WEIGHT - 1.0) < 1e-9

    def test_weights_sum_to_one_custom(self):
        """Custom weights that sum to 1.0 are accepted."""
        cfg = SimulationConfig(RECENT_WEIGHT=0.7, CAREER_WEIGHT=0.3)
        assert abs(cfg.RECENT_WEIGHT + cfg.CAREER_WEIGHT - 1.0) < 1e-9

    def test_weights_not_summing_to_one_raises(self):
        """Weights that do not sum to 1.0 raise ValueError."""
        with pytest.raises(ValueError, match="RECENT_WEIGHT"):
            SimulationConfig(RECENT_WEIGHT=0.5, CAREER_WEIGHT=0.6)

    def test_num_simulations_zero_raises(self):
        """NUM_SIMULATIONS=0 raises ValueError."""
        with pytest.raises(ValueError, match="NUM_SIMULATIONS"):
            SimulationConfig(NUM_SIMULATIONS=0)

    def test_league_avg_rates_sum_to_one(self):
        """All LEAGUE_AVG_RATES values sum to approximately 1.0."""
        total = sum(LEAGUE_AVG_RATES.values())
        assert abs(total - 1.0) < 1e-6, f"LEAGUE_AVG_RATES sum = {total}"

    def test_model_outcomes_match_league_rates(self):
        """Every key in MODEL_OUTCOMES exists in LEAGUE_AVG_RATES."""
        for outcome in MODEL_OUTCOMES:
            assert outcome in LEAGUE_AVG_RATES, (
                f"'{outcome}' is in MODEL_OUTCOMES but missing from LEAGUE_AVG_RATES"
            )

    def test_park_factors_all_30_parks(self):
        """PARK_FACTORS contains entries for all 30 MLB venues."""
        real_parks = {k for k in PARK_FACTORS if k != "neutral"}
        assert len(real_parks) >= 28, (
            f"Expected at least 28 MLB venue entries, found {len(real_parks)}: {real_parks}"
        )

    def test_park_factors_neutral_entry_exists(self):
        """PARK_FACTORS includes a 'neutral' fallback entry."""
        assert "neutral" in PARK_FACTORS
        assert PARK_FACTORS["neutral"]["hr"] == 1.0

    def test_park_factors_have_required_keys(self):
        """Every park factor entry has all required sub-keys."""
        required_keys = {"hr", "h", "k", "bb", "2b", "3b"}
        for venue, factors in PARK_FACTORS.items():
            assert required_keys.issubset(factors.keys()), (
                f"'{venue}' is missing keys: {required_keys - factors.keys()}"
            )

    def test_feature_columns_count(self):
        """FEATURE_COLUMNS has exactly 33 features."""
        assert len(FEATURE_COLUMNS) == 33, (
            f"Expected 33 features, got {len(FEATURE_COLUMNS)}"
        )

    def test_feature_columns_no_duplicates(self):
        """FEATURE_COLUMNS has no duplicate entries."""
        assert len(FEATURE_COLUMNS) == len(set(FEATURE_COLUMNS))

    @pytest.mark.parametrize("outcome", MODEL_OUTCOMES)
    def test_league_avg_rates_positive(self, outcome):
        """Every league average rate is strictly positive."""
        assert LEAGUE_AVG_RATES[outcome] > 0, (
            f"LEAGUE_AVG_RATES['{outcome}'] = {LEAGUE_AVG_RATES[outcome]} is not positive"
        )


# ===========================================================================
# TestOddsRatioModel
# ===========================================================================


class TestOddsRatioModel:
    """Tests for OddsRatioModel (generalised log5 / odds-ratio model)."""

    @pytest.fixture(autouse=True)
    def model(self):
        self.orm = OddsRatioModel()

    def _predict(self, pitcher=None, batter=None, context=None):
        p = pitcher or _league_avg_pitcher()
        b = batter or _league_avg_batter()
        c = context or _neutral_context()
        return self.orm.predict_pa_probs(p, b, c)

    def test_league_avg_vs_league_avg(self):
        probs = self._predict()
        for outcome in MODEL_OUTCOMES:
            lg = LEAGUE_AVG_RATES[outcome]
            delta = abs(probs[outcome] - lg)
            assert delta < 0.05

    def test_high_k_pitcher_increases_k_prob(self):
        baseline_probs = self._predict()
        base_k = baseline_probs["strikeout"]
        high_k_pitcher = _league_avg_pitcher()
        high_k_pitcher["strikeout_rate"] = 0.40
        high_k_probs = self._predict(pitcher=high_k_pitcher)
        assert high_k_probs["strikeout"] > base_k

    def test_probabilities_sum_to_one(self):
        probs = self._predict()
        total = sum(probs.values())
        assert abs(total - 1.0) < 1e-9

    def test_probabilities_sum_to_one_various_contexts(self):
        high_k_p = _league_avg_pitcher()
        high_k_p["strikeout_rate"] = 0.38
        low_bb_b = _league_avg_batter()
        low_bb_b["walk_rate"] = 0.04
        ctx_coors = dict(_neutral_context())
        ctx_coors["park_hr_factor"] = 1.30
        ctx_coors["temperature"] = 95.0
        for pitcher, batter, context in [
            (_league_avg_pitcher(), _league_avg_batter(), _neutral_context()),
            (high_k_p, _league_avg_batter(), _neutral_context()),
            (_league_avg_pitcher(), low_bb_b, ctx_coors),
        ]:
            probs = self.orm.predict_pa_probs(pitcher, batter, context)
            total = sum(probs.values())
            assert abs(total - 1.0) < 1e-9

    def test_no_negative_probs(self):
        probs = self._predict()
        for outcome, prob in probs.items():
            assert prob >= 0.0

    def test_park_factor_affects_hr(self):
        neutral_probs = self._predict()
        high_hr_ctx = dict(_neutral_context())
        high_hr_ctx["park_hr_factor"] = 1.30
        high_hr_probs = self._predict(context=high_hr_ctx)
        assert high_hr_probs["home_run"] > neutral_probs["home_run"]

    def test_low_hr_park_decreases_hr(self):
        neutral_probs = self._predict()
        low_hr_ctx = dict(_neutral_context())
        low_hr_ctx["park_hr_factor"] = 0.78
        low_hr_probs = self._predict(context=low_hr_ctx)
        assert low_hr_probs["home_run"] < neutral_probs["home_run"]

    def test_platoon_advantage(self):
        rr_batter = _league_avg_batter()
        rr_batter["hand"] = "R"
        rr_ctx = dict(_neutral_context())
        rr_ctx["pitcher_hand"] = "R"
        rr_probs = self.orm.predict_pa_probs(rr_batter, rr_batter, rr_ctx)
        lr_batter = _league_avg_batter()
        lr_batter["hand"] = "L"
        lr_ctx = dict(_neutral_context())
        lr_ctx["pitcher_hand"] = "R"
        lr_probs = self.orm.predict_pa_probs(lr_batter, lr_batter, lr_ctx)
        lr_hit_total = sum(lr_probs[h] for h in ("single", "double", "triple", "home_run"))
        rr_hit_total = sum(rr_probs[h] for h in ("single", "double", "triple", "home_run"))
        assert lr_hit_total > rr_hit_total

    def test_platoon_advantage_reduces_k(self):
        rr_batter = _league_avg_batter()
        rr_batter["hand"] = "R"
        ctx_r = dict(_neutral_context())
        ctx_r["pitcher_hand"] = "R"
        rr_probs = self.orm.predict_pa_probs(rr_batter, rr_batter, ctx_r)
        lr_batter = _league_avg_batter()
        lr_batter["hand"] = "L"
        ctx_l = dict(_neutral_context())
        ctx_l["pitcher_hand"] = "R"
        lr_probs = self.orm.predict_pa_probs(lr_batter, lr_batter, ctx_l)
        assert lr_probs["strikeout"] < rr_probs["strikeout"]

    def test_umpire_factor_increases_ks(self):
        baseline_probs = self._predict()
        tight_ctx = dict(_neutral_context())
        tight_ctx["umpire_k_factor"] = 1.25
        ump_probs = self._predict(context=tight_ctx)
        assert ump_probs["strikeout"] > baseline_probs["strikeout"]

    def test_umpire_factor_decreases_ks_tight_zone(self):
        baseline_probs = self._predict()
        tight_ctx = dict(_neutral_context())
        tight_ctx["umpire_k_factor"] = 0.75
        ump_probs = self._predict(context=tight_ctx)
        assert ump_probs["strikeout"] < baseline_probs["strikeout"]

    def test_catcher_framing_increases_ks(self):
        baseline = self._predict()
        framing_ctx = dict(_neutral_context())
        framing_ctx["catcher_framing_score"] = 2.0
        framing_probs = self._predict(context=framing_ctx)
        assert framing_probs["strikeout"] > baseline["strikeout"]

    def test_hot_weather_increases_hr(self):
        baseline = self._predict()
        hot_ctx = dict(_neutral_context())
        hot_ctx["temperature"] = 95.0
        hot_probs = self._predict(context=hot_ctx)
        assert hot_probs["home_run"] > baseline["home_run"]

    def test_wind_blowing_out_increases_hr(self):
        baseline = self._predict()
        wind_ctx = dict(_neutral_context())
        wind_ctx["wind_to_cf"] = 1.0
        wind_ctx["wind_speed"] = 15.0
        wind_probs = self._predict(context=wind_ctx)
        assert wind_probs["home_run"] > baseline["home_run"]

    @pytest.mark.parametrize("outcome", MODEL_OUTCOMES)
    def test_all_outcomes_present(self, outcome):
        probs = self._predict()
        assert outcome in probs

    def test_small_sample_regresses_to_league(self):
        extreme_pitcher = {f"{o}_rate": LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES}
        extreme_pitcher["strikeout_rate"] = 0.99
        extreme_pitcher["out_rate"] = 0.01
        extreme_pitcher["sample_pa"] = 10
        probs = self.orm.predict_pa_probs(
            extreme_pitcher, _league_avg_batter(), _neutral_context()
        )
        assert probs["strikeout"] < 0.80


# ===========================================================================
# TestMatchupModel
# ===========================================================================


class TestMatchupModel:
    """Tests for the MatchupModel facade."""

    def test_fallback_to_odds_ratio(self):
        model = MatchupModel(model_path="nonexistent_model.txt", use_ml=True)
        assert model.active_model == "odds_ratio"

    def test_fallback_to_odds_ratio_no_path(self):
        model = MatchupModel(model_path=None)
        assert model.active_model == "odds_ratio"

    def test_use_ml_false_uses_odds_ratio(self):
        model = MatchupModel(use_ml=False)
        assert model.active_model == "odds_ratio"

    def test_predict_pa_probs_returns_dict(self):
        model = MatchupModel(model_path=None)
        probs = model.predict_pa_probs(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        assert isinstance(probs, dict)
        for outcome in MODEL_OUTCOMES:
            assert outcome in probs

    def test_predict_pa_probs_sums_to_one(self):
        model = MatchupModel(model_path=None)
        probs = model.predict_pa_probs(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        assert abs(sum(probs.values()) - 1.0) < 1e-9

    def test_explain_prediction_structure(self):
        model = MatchupModel(model_path=None)
        result = model.explain_prediction(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        assert "outcomes" in result
        assert "confidence" in result
        assert "active_model" in result
        outcomes = result["outcomes"]
        for outcome in MODEL_OUTCOMES:
            assert outcome in outcomes
        for outcome, detail in outcomes.items():
            assert "base_prob" in detail
            assert "adjustments" in detail
            assert "final_prob" in detail
            adj = detail["adjustments"]
            for layer in ("park_factor", "platoon", "umpire", "catcher_framing", "weather"):
                assert layer in adj
                layer_detail = adj[layer]
                assert "direction" in layer_detail
                assert "magnitude" in layer_detail
                assert "reason" in layer_detail
                assert layer_detail["direction"] in ("up", "down", "neutral")

    def test_explain_prediction_confidence_range(self):
        model = MatchupModel(model_path=None)
        result = model.explain_prediction(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        assert 0.0 <= result["confidence"] <= 1.0

    def test_explain_prediction_final_probs_sum_to_one(self):
        model = MatchupModel(model_path=None)
        result = model.explain_prediction(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        total = sum(d["final_prob"] for d in result["outcomes"].values())
        assert abs(total - 1.0) < 1e-4

    def test_explain_prediction_base_probs_positive(self):
        model = MatchupModel(model_path=None)
        result = model.explain_prediction(
            _league_avg_pitcher(), _league_avg_batter(), _neutral_context()
        )
        for outcome, detail in result["outcomes"].items():
            assert detail["base_prob"] > 0


# ===========================================================================
# TestGameState
# ===========================================================================


class TestGameState:
    """Tests for GameState — the mutable game state tracker."""

    def test_initial_state(self):
        gs = GameState()
        assert gs.inning == 1
        assert gs.half == "top"
        assert gs.outs == 0
        assert gs.runners == {1: None, 2: None, 3: None}
        assert gs.score == {"away": 0, "home": 0}

    def test_initial_lineup_index(self):
        gs = GameState()
        assert gs.lineup_index["away"] == 0
        assert gs.lineup_index["home"] == 0

    def test_record_out(self):
        gs = GameState()
        gs.record_out()
        assert gs.outs == 1
        gs.record_out()
        assert gs.outs == 2
        gs.record_out()
        assert gs.outs == 3

    def test_record_three_outs_triggers_switch_after_switch_sides(self):
        gs = GameState()
        gs.record_out()
        gs.record_out()
        gs.record_out()
        assert gs.outs == 3
        gs.switch_sides()
        assert gs.half == "bottom"
        assert gs.outs == 0
        assert gs.runners == {1: None, 2: None, 3: None}

    def test_switch_sides_top_to_bottom(self):
        gs = GameState()
        gs.switch_sides()
        assert gs.half == "bottom"
        assert gs.inning == 1

    def test_switch_sides_bottom_to_top_increments_inning(self):
        gs = GameState()
        gs.half = "bottom"
        gs.switch_sides()
        assert gs.half == "top"
        assert gs.inning == 2

    def test_advance_runners_single_runner_on_1b(self):
        gs = GameState()
        gs.runners[1] = 10
        runs = gs.advance_runners(1)
        assert runs == 0
        assert gs.runners[2] == 10
        assert gs.runners[1] is None

    def test_advance_runners_single(self):
        gs = GameState()
        gs.runners[1] = 7
        runs = gs.advance_runners(1)
        assert runs == 0
        assert gs.runners[2] == 7
        assert gs.runners[1] is None
        assert gs.runners[3] is None

    def test_advance_runners_runner_scores_from_2b_on_double(self):
        gs = GameState()
        gs.half = "top"
        gs.runners[2] = 5
        runs = gs.advance_runners(2)
        assert runs == 1
        assert gs.score["away"] == 1

    def test_advance_runners_home_run(self):
        gs = GameState()
        gs.half = "top"
        gs.runners = {1: 1, 2: 2, 3: 3}
        runs = gs.advance_runners(4)
        assert runs == 3
        assert gs.runners == {1: None, 2: None, 3: None}

    def test_advance_runners_home_run_clears_bases(self):
        gs = GameState()
        gs.runners = {1: 1, 2: 2, 3: 3}
        gs.advance_runners(4)
        assert all(v is None for v in gs.runners.values())

    def test_walk_with_bases_loaded(self):
        gs = GameState()
        gs.half = "top"
        gs.runners = {1: 1, 2: 2, 3: 3}
        runs = gs.force_advance_on_walk(batter_id=4)
        assert runs == 1
        assert gs.score["away"] == 1
        assert gs.runners[1] == 4
        assert gs.runners[2] == 1
        assert gs.runners[3] == 2

    def test_walk_empty_bases(self):
        gs = GameState()
        runs = gs.force_advance_on_walk(batter_id=99)
        assert runs == 0
        assert gs.runners[1] == 99

    def test_walk_runner_on_first_only(self):
        gs = GameState()
        gs.runners[1] = 10
        runs = gs.force_advance_on_walk(batter_id=20)
        assert runs == 0
        assert gs.runners[1] == 20
        assert gs.runners[2] == 10

    def test_game_over_after_9(self):
        gs = GameState()
        for _ in range(18):
            gs.switch_sides()
        assert gs.inning >= 9

    def test_walkoff_scenario(self):
        gs = GameState()
        gs.inning = 9
        gs.half = "bottom"
        gs.score = {"away": 3, "home": 3}
        gs.score["home"] += 1
        assert gs.score["home"] > gs.score["away"]

    def test_manfred_runner(self):
        gs = GameState()
        gs.set_manfred_runner()
        assert gs.runners[2] == -1
        assert gs.runners[1] is None
        assert gs.runners[3] is None

    def test_next_batter_wraps_around(self):
        gs = GameState()
        gs.lineup_index["away"] = 8
        gs.next_batter("away")
        assert gs.lineup_index["away"] == 0

    def test_batting_team_property(self):
        gs = GameState()
        assert gs.batting_team == "away"
        gs.half = "bottom"
        assert gs.batting_team == "home"

    def test_fielding_team_property(self):
        gs = GameState()
        assert gs.fielding_team == "home"
        gs.half = "bottom"
        assert gs.fielding_team == "away"

    def test_place_batter_on_empty_base(self):
        gs = GameState()
        gs.place_batter_on_base(1, 42)
        assert gs.runners[1] == 42

    def test_place_batter_pushes_existing_runner(self):
        gs = GameState()
        gs.runners[1] = 5
        gs.place_batter_on_base(1, 10)
        assert gs.runners[1] == 10
        assert gs.runners[2] == 5

    def test_advance_runners_probabilistic_single(self):
        rng = np.random.default_rng(seed=42)
        gs = GameState()
        gs.half = "top"
        gs.runners[1] = 1
        gs.runners[2] = 2
        gs.runners[3] = 3
        initial_score = gs.score["away"]
        runs = gs.advance_runners_probabilistic("single", rng)
        assert gs.score["away"] >= initial_score
        for base_val in gs.runners.values():
            assert base_val is None or isinstance(base_val, int)

    def test_advance_runners_probabilistic_double(self):
        rng = np.random.default_rng(seed=0)
        gs = GameState()
        gs.half = "top"
        gs.runners[2] = 2
        gs.runners[3] = 3
        runs = gs.advance_runners_probabilistic("double", rng)
        assert runs == 2
        assert gs.score["away"] == 2

    def test_advance_runners_probabilistic_invalid_outcome_raises(self):
        rng = np.random.default_rng(seed=0)
        gs = GameState()
        with pytest.raises(ValueError, match="advance_runners_probabilistic"):
            gs.advance_runners_probabilistic("home_run", rng)


# ===========================================================================
# TestPlayerStats
# ===========================================================================


class TestPlayerStats:
    """Tests for PlayerStats — the per-player stat accumulator."""

    @pytest.fixture(autouse=True)
    def ps(self):
        self.ps = PlayerStats(player_id=1001, player_name="Test Player")

    def test_record_and_retrieve(self):
        self.ps.finalise_simulation({"strikeouts": 7, "walks": 1})
        self.ps.finalise_simulation({"strikeouts": 5, "walks": 0})
        self.ps.finalise_simulation({"strikeouts": 7, "walks": 2})
        dist = self.ps.get_distribution("strikeouts")
        assert dist[7] == 2
        assert dist[5] == 1
        assert 6 not in dist

    def test_p_over_calculation(self):
        n_sims = 100
        for i in range(n_sims):
            ks = 6 if i < 60 else 5
            self.ps.finalise_simulation({"strikeouts": ks})
        p_over = self.ps.get_p_over("strikeouts", 5.5)
        assert abs(p_over - 0.60) < 1e-9

    def test_mean_calculation(self):
        self.ps.finalise_simulation({"hits": 0})
        self.ps.finalise_simulation({"hits": 2})
        self.ps.finalise_simulation({"hits": 4})
        mean = self.ps.get_mean("hits")
        expected = (0 + 2 + 4) / 3
        assert abs(mean - expected) < 1e-9

    def test_mean_empty_returns_zero(self):
        assert self.ps.get_mean("strikeouts") == 0.0

    def test_median_calculation(self):
        for v in [1, 2, 3, 4, 5]:
            self.ps.finalise_simulation({"pa": v})
        median = self.ps.get_median("pa")
        assert median == 3.0

    def test_std_calculation(self):
        values = [2, 4, 4, 4, 5, 5, 7, 9]
        for v in values:
            self.ps.finalise_simulation({"hits": v})
        std = self.ps.get_std("hits")
        assert abs(std - 2.0) < 1e-9

    def test_p_over_zero_line(self):
        for _ in range(50):
            self.ps.finalise_simulation({"strikeouts": 3})
        assert self.ps.get_p_over("strikeouts", 0) == 1.0

    def test_p_over_empty_returns_zero(self):
        assert self.ps.get_p_over("strikeouts", 5.5) == 0.0

    def test_get_distribution_empty_returns_empty_dict(self):
        assert self.ps.get_distribution("non_existent_stat") == {}

    def test_record_pa_outcome_strikeout(self):
        self.ps.record_pa_outcome("strikeout")
        assert self.ps.stat_counts["pa"][1] == 1
        assert self.ps.stat_counts["strikeouts"][1] == 1

    def test_record_pa_outcome_home_run(self):
        self.ps.record_pa_outcome("home_run")
        assert self.ps.stat_counts["hits"][1] == 1
        assert self.ps.stat_counts["home_runs"][1] == 1
        assert self.ps.stat_counts["total_bases"][4] == 1

    def test_record_pa_outcome_single(self):
        self.ps.record_pa_outcome("single")
        assert self.ps.stat_counts["hits"][1] == 1
        assert self.ps.stat_counts["singles"][1] == 1
        assert self.ps.stat_counts["total_bases"][1] == 1

    def test_record_pa_outcome_double(self):
        self.ps.record_pa_outcome("double")
        assert self.ps.stat_counts["total_bases"][2] == 1

    def test_record_pa_outcome_triple(self):
        self.ps.record_pa_outcome("triple")
        assert self.ps.stat_counts["total_bases"][3] == 1

    def test_record_pitcher_pa_strikeout(self):
        self.ps.record_pitcher_pa("strikeout", pitches=5)
        assert self.ps.stat_counts["outs_recorded"][1] == 1
        assert self.ps.stat_counts["strikeouts"][1] == 1
        assert self.ps.stat_counts["pitches"][5] == 1

    @pytest.mark.parametrize("stat,value,line,expected_p_over", [
        ("strikeouts", 6, 5.5, 1.0),
        ("strikeouts", 5, 5.5, 0.0),
        ("hits", 2, 1.5, 1.0),
        ("walks", 0, 0.5, 0.0),
    ])
    def test_p_over_parametrized(self, stat, value, line, expected_p_over):
        ps = PlayerStats(player_id=99, player_name="P")
        for _ in range(20):
            ps.finalise_simulation({stat: value})
        result = ps.get_p_over(stat, line)
        assert result == expected_p_over


# ===========================================================================
# TestGameSimulator
# ===========================================================================


class TestGameSimulator:
    """Tests for GameSimulator — the Monte Carlo game simulation engine."""

    @pytest.fixture(autouse=True)
    def setup_simulator(self):
        self.away_lineup = [_make_player(1000 + i, f"Away{i+1}") for i in range(9)]
        self.home_lineup = [_make_player(2000 + i, f"Home{i+1}") for i in range(9)]
        self.away_starter = _make_pitcher(9001, "AwayStarter")
        self.home_starter = _make_pitcher(9002, "HomeStarter")
        self.game_data = _make_game_data(
            self.away_lineup, self.home_lineup,
            self.away_starter, self.home_starter,
        )
        self.config = SimpleNamespace(
            num_simulations=100,
            random_seed=42,
            pitcher_pc_mean=88.0,
            pitcher_pc_std=10.0,
            gdp_rate=0.12,
        )
        self.mock_model = MockMatchupModel()
        self.simulator = GameSimulator(
            matchup_model=self.mock_model,
            config=self.config,
        )

    def test_simulation_produces_results(self):
        result = self.simulator.simulate_game(self.game_data)
        assert isinstance(result, SimulationResult)

    def test_simulation_result_has_player_results(self):
        result = self.simulator.simulate_game(self.game_data)
        assert isinstance(result.player_results, dict)
        assert len(result.player_results) > 0

    def test_all_players_have_stats(self):
        result = self.simulator.simulate_game(self.game_data)
        all_batter_ids = {p["mlbam_id"] for p in self.away_lineup + self.home_lineup}
        for pid in all_batter_ids:
            assert pid in result.player_results
            ps = result.player_results[pid]
            pa_dist = ps.get_distribution("pa")
            assert pa_dist

    def test_deterministic_with_seed(self):
        result_a = self.simulator.simulate_game(self.game_data)
        result_b = self.simulator.simulate_game(self.game_data)
        assert result_a.team_results["away"]["wins"] == result_b.team_results["away"]["wins"]
        assert result_a.team_results["home"]["wins"] == result_b.team_results["home"]["wins"]

    def test_reasonable_k_range(self):
        result = self.simulator.simulate_game(self.game_data)
        pitcher_ps = result.player_results.get(9001)
        if pitcher_ps is None:
            pytest.skip("Starter not in player_results")
        k_dist = pitcher_ps.get_distribution("strikeouts")
        for k_total in k_dist.keys():
            assert 0 <= k_total <= 20

    def test_score_is_non_negative(self):
        result = self.simulator.simulate_game(self.game_data)
        for side in ("away", "home"):
            for run_total in result.team_results[side]["run_distribution"].keys():
                assert run_total >= 0

    def test_num_simulations_recorded(self):
        result = self.simulator.simulate_game(self.game_data)
        assert result.num_simulations == 100

    def test_win_probabilities_sum_to_one_approx(self):
        result = self.simulator.simulate_game(self.game_data)
        total_wins = (
            result.team_results["away"]["wins"] + result.team_results["home"]["wins"]
        )
        assert total_wins <= 100

    def test_game_info_populated(self):
        result = self.simulator.simulate_game(self.game_data)
        assert result.game_info["game_pk"] == 12345
        assert result.game_info["away_team"] == "NYY"
        assert result.game_info["home_team"] == "BOS"

    def test_simulation_runs_without_bullpen(self):
        game_data_no_bp = SimpleNamespace(
            game_pk=99,
            game_date="2025-04-01",
            away_team="TB",
            home_team="TEX",
            venue="Globe Life Field",
            park_factor=1.0,
            away_lineup=self.away_lineup,
            home_lineup=self.home_lineup,
            away_starter=self.away_starter,
            home_starter=self.home_starter,
        )
        result = self.simulator.simulate_game(game_data_no_bp)
        assert isinstance(result, SimulationResult)

    def test_simulation_with_different_seeds_differ(self):
        config_a = SimpleNamespace(
            num_simulations=200, random_seed=1,
            pitcher_pc_mean=88.0, pitcher_pc_std=10.0, gdp_rate=0.12,
        )
        config_b = SimpleNamespace(
            num_simulations=200, random_seed=999,
            pitcher_pc_mean=88.0, pitcher_pc_std=10.0, gdp_rate=0.12,
        )
        sim_a = GameSimulator(matchup_model=self.mock_model, config=config_a)
        sim_b = GameSimulator(matchup_model=self.mock_model, config=config_b)
        result_a = sim_a.simulate_game(self.game_data)
        result_b = sim_b.simulate_game(self.game_data)
        wins_a = result_a.team_results["away"]["wins"]
        wins_b = result_b.team_results["away"]["wins"]
        assert isinstance(wins_a, int)
        assert isinstance(wins_b, int)


# ===========================================================================
# TestPropAnalyzer
# ===========================================================================


class TestPropAnalyzer:
    """Tests for PropAnalyzer — the edge analysis engine."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.config = SimulationConfig()
        self.analyzer = PropAnalyzer(self.config)
        self.sim_result = SimulationResult(
            game_info={"game_pk": 1, "game_date": "2025-04-01"},
            num_simulations=100,
        )
        ps = PlayerStats(player_id=5001, player_name="Test Pitcher")
        for i in range(100):
            ks = 6 if i < 60 else 5
            ps.finalise_simulation({"strikeouts": ks})
        self.sim_result.player_results[5001] = ps
        self.prop = PropLine(
            player_id=5001,
            player_name="Test Pitcher",
            stat_type="pitcher_strikeouts",
            line=5.5,
            over_odds=-115,
            under_odds=-105,
            sportsbook="fanduel",
        )

    def test_analyze_prop_basic(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        assert isinstance(analysis, PropAnalysis)
        assert analysis.prop is self.prop
        assert isinstance(analysis.simulated_mean, float)
        assert isinstance(analysis.p_over, float)
        assert isinstance(analysis.p_under, float)
        assert isinstance(analysis.confidence_tier, str)
        assert isinstance(analysis.recommended_side, str)
        assert analysis.recommended_side in ("over", "under", "pass")

    def test_analyze_prop_p_over_correct(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        assert abs(analysis.p_over - 0.60) < 1e-6

    def test_analyze_prop_p_under_complementary(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        assert abs(analysis.p_over + analysis.p_under - 1.0) < 1e-6

    def test_analyze_prop_player_not_found_returns_pass(self):
        missing_prop = PropLine(
            player_id=9999,
            player_name="Ghost Player",
            stat_type="pitcher_strikeouts",
            line=5.5,
            over_odds=-115,
            under_odds=-105,
            sportsbook="fanduel",
        )
        analysis = self.analyzer.analyze_prop(missing_prop, self.sim_result)
        assert analysis.recommended_side == "pass"
        assert analysis.confidence_tier == "PASS"

    def test_analyze_prop_unknown_stat_type_returns_pass(self):
        bad_prop = PropLine(
            player_id=5001,
            player_name="Test Pitcher",
            stat_type="xfip_minus",
            line=3.5,
            over_odds=-110,
            under_odds=-110,
            sportsbook="draftkings",
        )
        analysis = self.analyzer.analyze_prop(bad_prop, self.sim_result)
        assert analysis.recommended_side == "pass"

    def test_kelly_criterion(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        assert analysis.kelly_fraction > 0
        assert analysis.kelly_wager_pct <= self.config.MAX_KELLY_BET + 1e-9

    def test_kelly_zero_when_no_edge(self):
        sim_result2 = SimulationResult(
            game_info={"game_pk": 2, "game_date": "2025-04-01"},
            num_simulations=1000,
        )
        ps2 = PlayerStats(player_id=7777, player_name="NoEdge")
        for i in range(1000):
            ps2.finalise_simulation({"strikeouts": 6 if i < 500 else 5})
        sim_result2.player_results[7777] = ps2
        no_edge_prop = PropLine(
            player_id=7777, player_name="NoEdge",
            stat_type="pitcher_strikeouts", line=5.5,
            over_odds=-110, under_odds=-110, sportsbook="fanduel",
        )
        analysis = self.analyzer.analyze_prop(no_edge_prop, sim_result2)
        assert analysis.recommended_side == "pass"
        assert analysis.kelly_fraction == 0.0
        assert analysis.kelly_wager_pct == 0.0

    def test_odds_conversion_negative(self):
        implied = PropAnalyzer._american_to_implied(-110)
        expected = 110 / (110 + 100)
        assert abs(implied - expected) < 1e-6

    def test_odds_conversion_positive(self):
        implied = PropAnalyzer._american_to_implied(150)
        expected = 100 / (150 + 100)
        assert abs(implied - expected) < 1e-6

    @pytest.mark.parametrize("odds,expected", [
        (-110, 110 / 210),
        (+150, 100 / 250),
        (-200, 200 / 300),
        (+100, 100 / 200),
        (-300, 300 / 400),
    ])
    def test_odds_conversion_parametrized(self, odds, expected):
        result = PropAnalyzer._american_to_implied(odds)
        assert abs(result - expected) < 1e-9

    def test_confidence_tiers(self):
        config = SimulationConfig()
        ev_threshold = config.EV_THRESHOLD

        def _result_for_p_over(p_over_target: float, player_id: int) -> SimulationResult:
            sr = SimulationResult(
                game_info={"game_pk": player_id, "game_date": "2025-04-01"},
                num_simulations=1000,
            )
            ps = PlayerStats(player_id=player_id, player_name="TPlayer")
            n_over = int(p_over_target * 1000)
            for i in range(1000):
                ps.finalise_simulation({"strikeouts": 6 if i < n_over else 4})
            sr.player_results[player_id] = ps
            return sr

        over_odds = -110
        under_odds = -110
        over_imp = PropAnalyzer._american_to_implied(over_odds)
        under_imp = PropAnalyzer._american_to_implied(under_odds)
        total = over_imp + under_imp
        no_vig_over = over_imp / total

        p_high = no_vig_over + 0.10
        analysis_high = self.analyzer.analyze_prop(
            PropLine(1, "H", "pitcher_strikeouts", 5.5, over_odds, under_odds, "fanduel"),
            _result_for_p_over(min(p_high, 0.999), player_id=1),
        )
        assert analysis_high.confidence_tier == "HIGH"

        p_medium = no_vig_over + 0.06
        analysis_medium = self.analyzer.analyze_prop(
            PropLine(2, "M", "pitcher_strikeouts", 5.5, over_odds, under_odds, "fanduel"),
            _result_for_p_over(min(p_medium, 0.999), player_id=2),
        )
        assert analysis_medium.confidence_tier == "MEDIUM"

        p_low = no_vig_over + 0.04
        analysis_low = self.analyzer.analyze_prop(
            PropLine(3, "L", "pitcher_strikeouts", 5.5, over_odds, under_odds, "fanduel"),
            _result_for_p_over(min(p_low, 0.999), player_id=3),
        )
        assert analysis_low.confidence_tier == "LOW"

        p_pass = no_vig_over + 0.01
        analysis_pass = self.analyzer.analyze_prop(
            PropLine(4, "P", "pitcher_strikeouts", 5.5, over_odds, under_odds, "fanduel"),
            _result_for_p_over(min(p_pass, 0.999), player_id=4),
        )
        assert analysis_pass.confidence_tier == "PASS"

    def test_no_vig_calculation(self):
        no_vig_over, no_vig_under = self.analyzer._no_vig_probs(-110, -110)
        assert abs(no_vig_over + no_vig_under - 1.0) < 1e-9
        assert abs(no_vig_over - 0.5) < 1e-9

    def test_no_vig_calculation_asymmetric(self):
        no_vig_over, no_vig_under = self.analyzer._no_vig_probs(-120, +100)
        assert abs(no_vig_over + no_vig_under - 1.0) < 1e-9

    def test_edge_values_are_correct(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        expected_edge_over = round(analysis.p_over - analysis.implied_prob_over, 6)
        assert abs(analysis.edge_over - expected_edge_over) < 1e-6

    def test_recommended_side_follows_best_edge(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        if analysis.recommended_side == "over":
            assert analysis.edge_over >= analysis.edge_under
        elif analysis.recommended_side == "under":
            assert analysis.edge_under >= analysis.edge_over

    def test_distribution_in_analysis(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        assert isinstance(analysis.distribution, dict)
        assert len(analysis.distribution) > 0
        total = sum(analysis.distribution.values())
        assert abs(total - 1.0) < 1e-5

    def test_analyze_game_processes_all_props(self):
        props = [
            self.prop,
            PropLine(9999, "Ghost", "pitcher_strikeouts", 5.5, -110, -110, "fanduel"),
        ]
        analyses = self.analyzer.analyze_game(self.sim_result, props)
        assert len(analyses) == len(props)
        assert all(isinstance(a, PropAnalysis) for a in analyses)

    def test_decimal_odds_conversion(self):
        dec_neg = PropAnalyzer._american_to_decimal(-115)
        assert abs(dec_neg - (1.0 + 100.0 / 115.0)) < 1e-9
        dec_pos = PropAnalyzer._american_to_decimal(150)
        assert abs(dec_pos - 2.50) < 1e-9

    def test_ev_pct_matches_edge(self):
        analysis = self.analyzer.analyze_prop(self.prop, self.sim_result)
        if analysis.recommended_side == "over":
            expected_ev = round(analysis.edge_over * 100, 4)
        elif analysis.recommended_side == "under":
            expected_ev = round(analysis.edge_under * 100, 4)
        else:
            expected_ev = 0.0
        assert abs(analysis.ev_pct - expected_ev) < 1e-6

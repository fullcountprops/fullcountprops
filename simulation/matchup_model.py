"""
FullCountProps — matchup_model.py
================================
Core ML model that predicts per-PA outcome probabilities for each
batter-pitcher matchup.

Three classes are exposed:

  TrainedMatchupModel  — LightGBM multi-class classifier (8 outcomes).
                         Falls back to OddsRatioModel when no saved model
                         is available.

  OddsRatioModel       — Generalised log5 / odds-ratio formula with full
                         contextual adjustments (park, platoon, umpire,
                         catcher framing, weather). No training data required.

  MatchupModel         — Unified facade that tries the trained model first
                         and degrades gracefully to OddsRatioModel.  Also
                         exposes the glass-box explain_prediction() method
                         that is FullCountProps's key differentiator.

All predict_pa_probs() methods return a dict[str, float] whose values sum
to exactly 1.0, keyed by the 8 strings in MODEL_OUTCOMES.
"""

from __future__ import annotations

import logging
import warnings
from pathlib import Path
from typing import Optional

import numpy as np

# ---------------------------------------------------------------------------
# Imports from simulation.config — only the three names the task specifies
# ---------------------------------------------------------------------------
from simulation.config import (
    FEATURE_COLUMNS,
    LEAGUE_AVG_RATES,
    MODEL_OUTCOMES,
)

# LightGBM is optional — gracefully skip if not installed
try:
    import lightgbm as lgb  # type: ignore
    _LGBM_AVAILABLE = True
except ImportError:
    lgb = None  # type: ignore
    _LGBM_AVAILABLE = False

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Derived module-level constants (not imported from config — computed here)
# ---------------------------------------------------------------------------
NUM_OUTCOMES: int = len(MODEL_OUTCOMES)
OUTCOME_TO_IDX: dict[str, int] = {o: i for i, o in enumerate(MODEL_OUTCOMES)}

# Per-outcome regression PA counts (how many PA to blend toward league avg)
# Higher = more conservative / more shrinkage for rare events
_REGRESSION_PA: dict[str, int] = {
    "strikeout": 200,
    "walk":      200,
    "hbp":       500,   # very rare; regress harder
    "single":    150,
    "double":    300,
    "triple":    600,   # extremely rare; heavy regression
    "home_run":  300,
    "out":       100,
}

# Probability clipping bounds — applied before every normalisation
_PROB_MIN: float = 0.001
_PROB_MAX: float = 0.999

# Platoon multipliers
_PLATOON_HIT_BOOST: float  = 0.05   # 5% hit-prob boost for batter with platoon adv.
_PLATOON_K_REDUCTION: float = 0.03  # 3% K reduction for batter with platoon adv.

# Weather HR adjustment parameters
_WEATHER_TEMP_BASELINE: float      = 72.0   # F neutral temperature
_WEATHER_TEMP_COEFFICIENT: float   = 0.003  # HR prob boost per F above baseline
_WEATHER_WIND_OUT_BOOST: float     = 0.08   # max HR boost when wind blowing out
_WEATHER_WIND_IN_REDUCTION: float  = 0.06   # max HR reduction when blowing in

# Catcher framing: K prob boost per standard deviation of framing z-score
_FRAMING_K_PER_SD: float = 0.025

# Confidence score sample thresholds
_PA_FULL: int    = 502  # "full" data — log5 reliable
_PA_PARTIAL: int = 150  # "some" data
_PA_MINIMAL: int = 30   # "little" data — very uncertain

# Pre-computed league-rate array (fixed order matching MODEL_OUTCOMES)
_LEAGUE_RATES_ARRAY: np.ndarray = np.array(
    [LEAGUE_AVG_RATES[o] for o in MODEL_OUTCOMES], dtype=np.float64
)

# Outcome index shortcuts
_K_IDX:  int = OUTCOME_TO_IDX["strikeout"]
_BB_IDX: int = OUTCOME_TO_IDX["walk"]
_1B_IDX: int = OUTCOME_TO_IDX["single"]
_2B_IDX: int = OUTCOME_TO_IDX["double"]
_3B_IDX: int = OUTCOME_TO_IDX["triple"]
_HR_IDX: int = OUTCOME_TO_IDX["home_run"]
_HIT_INDICES: tuple[int, ...] = (_1B_IDX, _2B_IDX, _3B_IDX, _HR_IDX)


# ===========================================================================
#  Utility helpers
# ===========================================================================

def _softmax(x: np.ndarray) -> np.ndarray:
    """Numerically stable softmax over a 1-D array."""
    x = x - x.max()
    e = np.exp(x)
    return e / e.sum()


def _clip_and_normalise(probs: np.ndarray) -> np.ndarray:
    """
    Clip every probability to [_PROB_MIN, _PROB_MAX] then re-normalise so
    the result sums to exactly 1.0.
    """
    probs = np.clip(probs, _PROB_MIN, _PROB_MAX).astype(np.float64)
    total = probs.sum()
    if total <= 0:
        return np.full(len(probs), 1.0 / len(probs))
    return probs / total


def _array_to_dict(arr: np.ndarray) -> dict[str, float]:
    """Convert a (NUM_OUTCOMES,) probability array to {outcome: prob}."""
    return {outcome: float(arr[i]) for i, outcome in enumerate(MODEL_OUTCOMES)}


def _regress_toward_league(
    observed_rate: float,
    outcome: str,
    sample_pa: int,
) -> float:
    """
    Bayesian-style shrinkage toward the league average rate.

        regressed = (observed_events + league_avg * regression_pa) /
                    (sample_pa       + regression_pa)

    where observed_events = observed_rate x sample_pa.
    """
    reg_pa    = _REGRESSION_PA.get(outcome, 200)
    lg_avg    = LEAGUE_AVG_RATES[outcome]
    obs_events = max(0.0, observed_rate) * max(0, sample_pa)
    return float((obs_events + lg_avg * reg_pa) / (sample_pa + reg_pa))


def _confidence_from_sample(pitcher_pa: int, batter_pa: int) -> float:
    """
    Return a [0, 1] confidence score reflecting data availability.
    Uses a harmonic-mean blend of pitcher and batter sample quality.
    """
    def _score(n: int) -> float:
        if n >= _PA_FULL:
            return 1.0
        if n >= _PA_PARTIAL:
            return 0.6 + 0.4 * (n - _PA_PARTIAL) / (_PA_FULL - _PA_PARTIAL)
        if n >= _PA_MINIMAL:
            return 0.2 + 0.4 * (n - _PA_MINIMAL) / (_PA_PARTIAL - _PA_MINIMAL)
        return 0.1 * n / max(_PA_MINIMAL, 1)

    ps = _score(pitcher_pa)
    bs = _score(batter_pa)
    if ps + bs == 0.0:
        return 0.0
    return 2.0 * ps * bs / (ps + bs)


# ===========================================================================
#  Approach 1 — Trained ML Model (LightGBM multi-class classifier)
# ===========================================================================

class TrainedMatchupModel:
    """
    LightGBM multi-class classifier with 8 PA outcome classes.

    objective='multiclass', num_class=8.  The model is expected to accept
    a feature vector ordered exactly as ``FEATURE_COLUMNS`` from
    ``simulation.config``.

    Parameters
    ----------
    model_path : str | Path | None
        Path to a saved LightGBM booster (.txt native format or .pkl/.pickle).
        If *None* or the file does not exist, ``is_loaded`` will be ``False``
        and callers should use ``OddsRatioModel`` instead.
    """

    def __init__(self, model_path: Optional[str | Path] = None) -> None:
        self.model_path    = Path(model_path) if model_path else None
        self.is_loaded: bool = False
        self._model: Optional["lgb.Booster"] = None
        self._feature_names: list[str] = list(FEATURE_COLUMNS)

        if not _LGBM_AVAILABLE:
            log.warning(
                "lightgbm is not installed.  TrainedMatchupModel will not "
                "function; use MatchupModel which falls back automatically."
            )
            return

        if self.model_path is not None and self.model_path.is_file():
            self._load(self.model_path)
        elif self.model_path is not None:
            log.warning(
                "Model file not found at '%s'.  Falling back to "
                "OddsRatioModel.", self.model_path
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_pa_probs(self, features: np.ndarray) -> dict[str, float]:
        """
        Predict PA outcome probabilities from a pre-built feature vector.

        Parameters
        ----------
        features : np.ndarray
            1-D array of length ``len(FEATURE_COLUMNS)`` in the same order
            as ``FEATURE_COLUMNS``.  May also be 2-D with shape (1, n_features).

        Returns
        -------
        dict[str, float]
            Probabilities for each outcome in ``MODEL_OUTCOMES``, guaranteed
            to sum to exactly 1.0.

        Raises
        ------
        RuntimeError
            If the model is not loaded (``is_loaded == False``).
        """
        if not self.is_loaded or self._model is None:
            raise RuntimeError(
                "TrainedMatchupModel has no loaded model.  "
                "Use MatchupModel which handles fallback automatically."
            )

        features = np.asarray(features, dtype=np.float64)
        if features.ndim == 1:
            features = features.reshape(1, -1)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            # LightGBM predict -> shape (n_samples, n_classes)
            raw: np.ndarray = self._model.predict(features)[0]  # (n_classes,)

        # Softmax for a valid probability distribution, then clip + normalise
        probs = _softmax(raw)
        probs = _clip_and_normalise(probs)
        return _array_to_dict(probs)

    def get_feature_importance(self) -> dict[str, float]:
        """
        Return gain-based feature importance normalised to sum to 1.0.

        Returns
        -------
        dict[str, float]
            Sorted descending by importance.  Empty dict if model not loaded.
        """
        if not self.is_loaded or self._model is None:
            return {}

        raw: np.ndarray = self._model.feature_importance(importance_type="gain")
        names: list[str] = self._model.feature_name()
        total = raw.sum()
        if total == 0:
            return {n: 0.0 for n in names}

        normalised = {n: float(v / total) for n, v in zip(names, raw)}
        return dict(sorted(normalised.items(), key=lambda kv: kv[1], reverse=True))

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load(self, path: Path) -> None:
        """Load a LightGBM booster from disk (supports .txt and .pkl)."""
        try:
            suffix = path.suffix.lower()
            if suffix in (".pkl", ".pickle"):
                import pickle
                with open(path, "rb") as fh:
                    self._model = pickle.load(fh)
            else:
                # Native LightGBM text format
                self._model = lgb.Booster(model_file=str(path))

            self.is_loaded = True
            log.info("Loaded TrainedMatchupModel from '%s'.", path)

            try:
                self._feature_names = self._model.feature_name()
            except Exception:
                pass  # feature names not critical

        except Exception as exc:
            log.error(
                "Failed to load LightGBM model from '%s': %s.  "
                "Falling back to OddsRatioModel.", path, exc,
            )
            self._model = None
            self.is_loaded = False


# ===========================================================================
#  Approach 2 — Odds-Ratio / Generalised log5 Fallback
# ===========================================================================

class OddsRatioModel:
    """
    Generalised log5 / odds-ratio matchup model with contextual adjustments.

    Implements the Haechrel generalisation of Bill James's log5 formula
    across all 8 PA outcome categories, with Bayesian regression toward
    league averages for small samples and five contextual adjustment layers:

      1. Park factors  (HR, 2B, 3B, 1B)
      2. Platoon       (batter hand vs. pitcher hand)
      3. Umpire        (strike-zone K and BB tendencies)
      4. Catcher framing  (called-strike K adjustment)
      5. Weather       (temperature and wind effects on HR)

    Reference
    ---------
    SABR — "Matchup Probabilities in Major League Baseball"
    https://sabr.org/journal/article/matchup-probabilities-in-major-league-baseball/

    PLoS ONE — "Bayesian hierarchical log5 model"
    https://pmc.ncbi.nlm.nih.gov/articles/PMC6192592/
    """

    def __init__(self) -> None:
        self._league_rates = dict(LEAGUE_AVG_RATES)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_pa_probs(
        self,
        pitcher_stats: dict,
        batter_stats: dict,
        context: dict,
    ) -> dict[str, float]:
        """
        Predict PA outcome probabilities using the generalised log5 formula
        with contextual adjustments.

        Parameters
        ----------
        pitcher_stats : dict
            Keys: ``{outcome}_rate`` for each outcome in MODEL_OUTCOMES (e.g.
            ``'strikeout_rate'``, ``'home_run_rate'``), plus ``'sample_pa'``
            (BF count for regression).  Missing keys fall back to
            ``LEAGUE_AVG_RATES``.

        batter_stats : dict
            Same structure as ``pitcher_stats`` with the batter's per-PA
            rates plus ``'sample_pa'`` and optional ``'hand'`` ('L', 'R',
            or 'S').

        context : dict
            Contextual modifiers — all optional, sensible defaults applied.

        Returns
        -------
        dict[str, float]
            Normalised probabilities for each outcome in ``MODEL_OUTCOMES``,
            guaranteed to sum to exactly 1.0.  Each value is clipped to
            [0.001, 0.999] before normalisation.
        """
        # ------------------------------------------------------------------
        # Step 1 — Retrieve and regress raw rates toward the league average
        # ------------------------------------------------------------------
        pitcher_pa = int(pitcher_stats.get("sample_pa", _PA_PARTIAL))
        batter_pa  = int(batter_stats.get("sample_pa", _PA_PARTIAL))

        pitcher_rates = np.zeros(NUM_OUTCOMES, dtype=np.float64)
        batter_rates  = np.zeros(NUM_OUTCOMES, dtype=np.float64)

        for i, outcome in enumerate(MODEL_OUTCOMES):
            key    = f"{outcome}_rate"
            lg_avg = self._league_rates[outcome]

            # Clip extreme raw values before regression
            p_raw = float(np.clip(pitcher_stats.get(key, lg_avg), 0.0, 1.0))
            b_raw = float(np.clip(batter_stats.get(key,  lg_avg), 0.0, 1.0))

            pitcher_rates[i] = _regress_toward_league(p_raw, outcome, pitcher_pa)
            batter_rates[i]  = _regress_toward_league(b_raw, outcome, batter_pa)

        # ------------------------------------------------------------------
        # Step 2 — Generalised log5 formula (Haechrel / SABR)
        # ------------------------------------------------------------------
        safe_league  = np.where(_LEAGUE_RATES_ARRAY > 0.0, _LEAGUE_RATES_ARRAY, 1e-9)
        batter_rel   = batter_rates / safe_league
        b_rel_sum    = batter_rel.sum()
        if b_rel_sum <= 0.0:
            batter_rel = np.ones(NUM_OUTCOMES, dtype=np.float64)
            b_rel_sum  = float(NUM_OUTCOMES)

        x_prime    = batter_rel / b_rel_sum
        numerators = x_prime * pitcher_rates
        denom      = numerators.sum()
        probs      = (numerators / denom) if denom > 0.0 else _LEAGUE_RATES_ARRAY.copy()

        # ------------------------------------------------------------------
        # Steps 3-7 — Contextual adjustments
        # ------------------------------------------------------------------
        probs = self._apply_park_factors(probs, context)
        probs = self._apply_platoon(probs, batter_stats, context)
        probs = self._apply_umpire(probs, context)
        probs = self._apply_catcher_framing(probs, context)
        probs = self._apply_weather(probs, context)

        # ------------------------------------------------------------------
        # Final clip + normalisation
        # ------------------------------------------------------------------
        probs = _clip_and_normalise(probs)
        return _array_to_dict(probs)

    # ------------------------------------------------------------------
    # Contextual adjustment layers (each returns a raw, un-normalised array)
    # ------------------------------------------------------------------

    def _apply_park_factors(
        self, probs: np.ndarray, context: dict
    ) -> np.ndarray:
        """Scale HR, 2B, 3B, 1B by park factors then renormalise."""
        pf_hr = float(np.clip(context.get("park_hr_factor", 1.0), 0.5, 2.0))
        pf_2b = float(np.clip(context.get("park_2b_factor", 1.0), 0.5, 2.0))
        pf_3b = float(np.clip(context.get("park_3b_factor", 1.0), 0.5, 2.0))
        pf_1b = float(np.clip(context.get("park_1b_factor", 1.0), 0.5, 2.0))

        probs = probs.copy()
        probs[_HR_IDX] *= pf_hr
        probs[_2B_IDX] *= pf_2b
        probs[_3B_IDX] *= pf_3b
        probs[_1B_IDX] *= pf_1b

        total = probs.sum()
        if total > 0.0:
            probs /= total
        return probs

    def _apply_platoon(
        self, probs: np.ndarray, batter_stats: dict, context: dict
    ) -> np.ndarray:
        """
        Boost hit probabilities and reduce K probability when the batter
        has platoon advantage (opposite hands from the pitcher).
        """
        if "platoon_advantage" in context:
            has_advantage = bool(context["platoon_advantage"])
        else:
            batter_hand  = str(batter_stats.get("hand", "R")).upper()
            pitcher_hand = str(context.get("pitcher_hand", "R")).upper()
            has_advantage = (batter_hand == "S") or (batter_hand != pitcher_hand)

        if not has_advantage:
            return probs

        probs = probs.copy()
        for idx in _HIT_INDICES:
            probs[idx] *= (1.0 + _PLATOON_HIT_BOOST)
        probs[_K_IDX] *= (1.0 - _PLATOON_K_REDUCTION)

        total = probs.sum()
        if total > 0.0:
            probs /= total
        return probs

    def _apply_umpire(self, probs: np.ndarray, context: dict) -> np.ndarray:
        """
        Scale K and BB probabilities by umpire zone-tendency factors.
        """
        ump_k  = float(np.clip(context.get("umpire_k_factor",  1.0), 0.5, 2.0))
        ump_bb = float(np.clip(context.get("umpire_bb_factor", 1.0), 0.5, 2.0))

        if abs(ump_k - 1.0) < 1e-6 and abs(ump_bb - 1.0) < 1e-6:
            return probs

        probs = probs.copy()
        probs[_K_IDX]  *= ump_k
        probs[_BB_IDX] *= ump_bb

        total = probs.sum()
        if total > 0.0:
            probs /= total
        return probs

    def _apply_catcher_framing(
        self, probs: np.ndarray, context: dict
    ) -> np.ndarray:
        """
        Adjust K probability by catcher framing z-score.
        """
        framing_z = float(np.clip(context.get("catcher_framing_score", 0.0), -3.0, 3.0))
        if abs(framing_z) < 1e-6:
            return probs

        multiplier = float(np.clip(1.0 + framing_z * _FRAMING_K_PER_SD, 0.5, 1.5))

        probs = probs.copy()
        probs[_K_IDX] *= multiplier

        total = probs.sum()
        if total > 0.0:
            probs /= total
        return probs

    def _apply_weather(self, probs: np.ndarray, context: dict) -> np.ndarray:
        """
        Adjust HR probability based on temperature and wind direction.
        """
        temp       = float(np.clip(context.get("temperature",  _WEATHER_TEMP_BASELINE), 20.0, 120.0))
        wind_speed = float(np.clip(context.get("wind_speed",   0.0), 0.0, 40.0))
        wind_to_cf = float(np.clip(context.get("wind_to_cf",   0.0), -1.0, 1.0))

        temp_adj         = _WEATHER_TEMP_COEFFICIENT * (temp - _WEATHER_TEMP_BASELINE)
        wind_fraction    = min(wind_speed / 15.0, 1.0)
        wind_adj         = (
            wind_to_cf * wind_fraction * _WEATHER_WIND_OUT_BOOST
            if wind_to_cf >= 0
            else wind_to_cf * wind_fraction * _WEATHER_WIND_IN_REDUCTION
        )

        total_adj = temp_adj + wind_adj
        if abs(total_adj) < 1e-6:
            return probs

        probs = probs.copy()
        probs[_HR_IDX] = max(_PROB_MIN, probs[_HR_IDX] * (1.0 + total_adj))

        total = probs.sum()
        if total > 0.0:
            probs /= total
        return probs


# ===========================================================================
#  Unified facade — MatchupModel
# ===========================================================================

class MatchupModel:
    """
    Unified interface for PA outcome probability prediction.

    Tries to use a trained LightGBM model (TrainedMatchupModel) when one is
    available; otherwise degrades silently to the statistical OddsRatioModel.

    Parameters
    ----------
    model_path : str | Path | None
        Path to a saved LightGBM booster.  ``None`` -> always use OddsRatioModel.
    use_ml : bool
        If ``False``, always uses OddsRatioModel regardless of ``model_path``.
    """

    def __init__(
        self,
        model_path: Optional[str | Path] = None,
        use_ml: bool = True,
    ) -> None:
        self.use_ml       = use_ml
        self._odds_model  = OddsRatioModel()
        self._trained_model: Optional[TrainedMatchupModel] = None
        self._active_model: str = "odds_ratio"

        if use_ml and _LGBM_AVAILABLE:
            trained = TrainedMatchupModel(model_path=model_path)
            if trained.is_loaded:
                self._trained_model = trained
                self._active_model  = "trained_lgbm"
            else:
                log.info(
                    "TrainedMatchupModel unavailable; using OddsRatioModel."
                )
        elif use_ml and not _LGBM_AVAILABLE:
            log.warning(
                "use_ml=True but LightGBM is not installed.  "
                "Falling back to OddsRatioModel."
            )

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def active_model(self) -> str:
        """Returns ``'trained_lgbm'`` or ``'odds_ratio'``."""
        return self._active_model

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def predict_pa_probs(
        self,
        pitcher_stats: dict,
        batter_stats: dict,
        context: dict,
        features: Optional[np.ndarray] = None,
    ) -> dict[str, float]:
        """
        Predict PA outcome probabilities for a specific matchup.
        """
        if (
            self._active_model == "trained_lgbm"
            and self._trained_model is not None
            and features is not None
        ):
            try:
                return self._trained_model.predict_pa_probs(features)
            except Exception as exc:
                log.warning(
                    "TrainedMatchupModel raised %s; falling back to "
                    "OddsRatioModel for this PA.", exc
                )

        return self._odds_model.predict_pa_probs(pitcher_stats, batter_stats, context)

    def explain_prediction(
        self,
        pitcher_stats: dict,
        batter_stats: dict,
        context: dict,
    ) -> dict:
        """
        Glass-box explanation of model adjustments for every PA outcome.
        """
        odds = self._odds_model

        pitcher_pa = int(pitcher_stats.get("sample_pa", _PA_PARTIAL))
        batter_pa  = int(batter_stats.get("sample_pa", _PA_PARTIAL))
        confidence = _confidence_from_sample(pitcher_pa, batter_pa)

        base_arr = self._compute_base_probs(pitcher_stats, batter_stats)

        after_park    = odds._apply_park_factors(base_arr.copy(), context)
        after_platoon = odds._apply_platoon(after_park.copy(), batter_stats, context)
        after_umpire  = odds._apply_umpire(after_platoon.copy(), context)
        after_framing = odds._apply_catcher_framing(after_umpire.copy(), context)
        after_weather = odds._apply_weather(after_framing.copy(), context)

        base_norm    = _clip_and_normalise(base_arr.copy())
        park_norm    = _clip_and_normalise(after_park.copy())
        platoon_norm = _clip_and_normalise(after_platoon.copy())
        umpire_norm  = _clip_and_normalise(after_umpire.copy())
        framing_norm = _clip_and_normalise(after_framing.copy())
        final_norm   = _clip_and_normalise(after_weather.copy())

        pf_hr       = float(context.get("park_hr_factor",         1.0))
        pf_2b       = float(context.get("park_2b_factor",         1.0))
        pf_3b       = float(context.get("park_3b_factor",         1.0))
        pf_1b       = float(context.get("park_1b_factor",         1.0))
        ump_k       = float(context.get("umpire_k_factor",        1.0))
        ump_bb      = float(context.get("umpire_bb_factor",       1.0))
        framing_z   = float(context.get("catcher_framing_score",  0.0))
        temp        = float(context.get("temperature",            _WEATHER_TEMP_BASELINE))
        wind_speed  = float(context.get("wind_speed",             0.0))
        wind_to_cf  = float(context.get("wind_to_cf",             0.0))

        batter_hand  = str(batter_stats.get("hand", "R")).upper()
        pitcher_hand = str(context.get("pitcher_hand", "R")).upper()

        if "platoon_advantage" in context:
            has_plat = bool(context["platoon_advantage"])
        else:
            has_plat = (batter_hand == "S") or (batter_hand != pitcher_hand)

        def _direction(delta: float) -> str:
            if delta > 0.0005:
                return "up"
            if delta < -0.0005:
                return "down"
            return "neutral"

        outcomes_explanation: dict = {}

        for i, outcome in enumerate(MODEL_OUTCOMES):
            base_p    = float(base_norm[i])
            park_p    = float(park_norm[i])
            platoon_p = float(platoon_norm[i])
            umpire_p  = float(umpire_norm[i])
            framing_p = float(framing_norm[i])
            final_p   = float(final_norm[i])

            park_delta    = park_p    - base_p
            platoon_delta = platoon_p - park_p
            umpire_delta  = umpire_p  - platoon_p
            framing_delta = framing_p - umpire_p
            weather_delta = final_p   - framing_p

            if outcome == "home_run":
                sentiment = (
                    "hitter-friendly" if pf_hr > 1.05
                    else "pitcher-friendly" if pf_hr < 0.95
                    else "neutral"
                )
                park_reason = f"Park HR factor {pf_hr:.2f} ({sentiment})"
            elif outcome == "double":
                park_reason = f"Park 2B factor {pf_2b:.2f}"
            elif outcome == "triple":
                park_reason = f"Park 3B factor {pf_3b:.2f}"
            elif outcome == "single":
                park_reason = f"Park 1B factor {pf_1b:.2f}"
            else:
                park_reason = "Park factors do not directly affect this outcome"

            if has_plat:
                if batter_hand == "S":
                    platoon_reason = (
                        "Batter is switch-hitter (always has platoon advantage); "
                        f"hit probs +{_PLATOON_HIT_BOOST*100:.0f}%, "
                        f"K -{_PLATOON_K_REDUCTION*100:.0f}%"
                    )
                else:
                    platoon_reason = (
                        f"Batter {batter_hand} vs. pitcher {pitcher_hand}: "
                        f"platoon advantage; "
                        f"hit probs +{_PLATOON_HIT_BOOST*100:.0f}%, "
                        f"K -{_PLATOON_K_REDUCTION*100:.0f}%"
                    )
            else:
                platoon_reason = (
                    f"Batter {batter_hand} vs. pitcher {pitcher_hand}: "
                    "no platoon advantage (same hand)"
                )

            if outcome == "strikeout":
                ump_pct = (ump_k - 1.0) * 100
                zone_desc = "expanded zone" if ump_pct > 0 else "tight zone"
                umpire_reason = (
                    f"Umpire K factor {ump_k:.2f} "
                    f"({zone_desc} {ump_pct:+.1f}% vs avg)"
                )
            elif outcome == "walk":
                ump_pct = (ump_bb - 1.0) * 100
                zone_desc = "generous" if ump_pct > 0 else "stingy"
                umpire_reason = (
                    f"Umpire BB factor {ump_bb:.2f} "
                    f"({zone_desc} {ump_pct:+.1f}% vs avg)"
                )
            else:
                umpire_reason = (
                    "Umpire tendency affects K/BB only "
                    "(indirect renormalisation here)"
                )

            framing_pct = framing_z * _FRAMING_K_PER_SD * 100
            if outcome == "strikeout":
                qual = "above avg" if framing_z > 0 else "below avg" if framing_z < 0 else "avg"
                framing_reason = (
                    f"Catcher framing z={framing_z:+.2f} "
                    f"({qual} framing; {framing_pct:+.1f}% K adjustment)"
                )
            else:
                framing_reason = (
                    "Catcher framing adjusts K probability only "
                    "(indirect renormalisation here)"
                )

            temp_delta_f = temp - _WEATHER_TEMP_BASELINE
            if outcome == "home_run":
                if wind_to_cf > 0.1:
                    wind_desc = "blowing out"
                elif wind_to_cf < -0.1:
                    wind_desc = "blowing in"
                else:
                    wind_desc = "neutral"
                weather_reason = (
                    f"Temp {temp:.0f}F ({temp_delta_f:+.0f}F vs "
                    f"{_WEATHER_TEMP_BASELINE:.0f}F baseline), "
                    f"wind {wind_speed:.0f} mph {wind_desc}"
                )
            else:
                weather_reason = (
                    "Weather (temperature/wind) adjusts HR probability only "
                    "(indirect renormalisation here)"
                )

            outcomes_explanation[outcome] = {
                "base_prob": round(base_p, 5),
                "adjustments": {
                    "park_factor": {
                        "direction": _direction(park_delta),
                        "magnitude": round(park_delta, 5),
                        "reason":    park_reason,
                    },
                    "platoon": {
                        "direction": _direction(platoon_delta),
                        "magnitude": round(platoon_delta, 5),
                        "reason":    platoon_reason,
                    },
                    "umpire": {
                        "direction": _direction(umpire_delta),
                        "magnitude": round(umpire_delta, 5),
                        "reason":    umpire_reason,
                    },
                    "catcher_framing": {
                        "direction": _direction(framing_delta),
                        "magnitude": round(framing_delta, 5),
                        "reason":    framing_reason,
                    },
                    "weather": {
                        "direction": _direction(weather_delta),
                        "magnitude": round(weather_delta, 5),
                        "reason":    weather_reason,
                    },
                },
                "final_prob": round(final_p, 5),
            }

        return {
            "outcomes":     outcomes_explanation,
            "confidence":   round(confidence, 3),
            "active_model": self._active_model,
        }

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _compute_base_probs(
        self, pitcher_stats: dict, batter_stats: dict
    ) -> np.ndarray:
        """
        Compute log5/odds-ratio probabilities WITHOUT any contextual
        adjustments.  Used as the baseline stage for explain_prediction().
        """
        pitcher_pa = int(pitcher_stats.get("sample_pa", _PA_PARTIAL))
        batter_pa  = int(batter_stats.get("sample_pa",  _PA_PARTIAL))

        pitcher_rates = np.zeros(NUM_OUTCOMES, dtype=np.float64)
        batter_rates  = np.zeros(NUM_OUTCOMES, dtype=np.float64)

        for i, outcome in enumerate(MODEL_OUTCOMES):
            key    = f"{outcome}_rate"
            lg_avg = LEAGUE_AVG_RATES[outcome]
            p_raw  = float(np.clip(pitcher_stats.get(key, lg_avg), 0.0, 1.0))
            b_raw  = float(np.clip(batter_stats.get(key,  lg_avg), 0.0, 1.0))
            pitcher_rates[i] = _regress_toward_league(p_raw, outcome, pitcher_pa)
            batter_rates[i]  = _regress_toward_league(b_raw, outcome, batter_pa)

        safe_league = np.where(_LEAGUE_RATES_ARRAY > 0.0, _LEAGUE_RATES_ARRAY, 1e-9)
        batter_rel  = batter_rates / safe_league
        b_sum       = batter_rel.sum()
        if b_sum <= 0.0:
            batter_rel = np.ones(NUM_OUTCOMES, dtype=np.float64)
            b_sum = float(NUM_OUTCOMES)

        x_prime    = batter_rel / b_sum
        numerators = x_prime * pitcher_rates
        denom      = numerators.sum()
        return (numerators / denom) if denom > 0.0 else _LEAGUE_RATES_ARRAY.copy()

"""
simulation — LEGACY Monte Carlo simulation package.
========================================================

.. deprecated::
    This package is deprecated. Use ``simulator/`` instead.

STATUS: Legacy wrapper. All production code uses the ``simulator/`` package.

This package contains the original Monte Carlo simulation implementation
(8,636 lines across 7 modules). It is retained because:

1. ``tests/test_simulation.py`` (168 tests) validates this implementation
2. The code is stable and passing — deleting it would remove test coverage

This ``__init__.py`` now re-exports ``simulator/`` package-level constants so
that any code doing ``from simulation import VERSION`` or
``import simulation; simulation.VERSION`` continues to work unchanged.

The CANONICAL simulation package is ``simulator/`` which is used by:
- ``pipeline/`` scripts (via simulator.run_daily)
- ``scripts/backtest_simulator.py``
- ``scripts/integration_test.py``
- ``Makefile simulate`` target
- ``.github/workflows/simulator.yml``

For new development, **always use** ``simulator/``.

Migration Plan:
- Migrate tests/test_simulation.py to test against simulator/ directly
- Archive or remove simulation/ entirely once tests are migrated
"""

import warnings

warnings.warn(
    "The 'simulation' package is deprecated and will be removed in a future release. "
    "Use 'simulator' instead.",
    DeprecationWarning,
    stacklevel=2,
)

# ---------------------------------------------------------------------------
# Re-export simulator/ package-level constants so that any consumer doing
#   from simulation import VERSION
# or
#   import simulation; simulation.DEFAULT_N_SIMS
# continues to work without modification.
# ---------------------------------------------------------------------------
from simulator import VERSION, DEFAULT_N_SIMS  # noqa: E402, F401

# Legacy metadata preserved for backward compatibility
__version__ = "1.0.0"
__status__ = "deprecated"
__author__ = "BaselineMLB"
__model_version__ = "mc-v1.0"

__all__ = [
    "VERSION",
    "DEFAULT_N_SIMS",
]

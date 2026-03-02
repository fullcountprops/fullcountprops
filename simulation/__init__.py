"""
simulation — LEGACY Monte Carlo simulation package.
=====================================================

STATUS: Legacy. All production code uses the `simulator/` package.

This package contains the original Monte Carlo simulation implementation
(8,636 lines across 7 modules). It is retained because:

1. `tests/test_simulation.py` (168 tests) validates this implementation
2. The code is stable and passing — deleting it would remove test coverage

The CANONICAL simulation package is `simulator/` which is used by:
- `pipeline/` scripts (via simulator.run_daily)
- `scripts/backtest_simulator.py`
- `scripts/integration_test.py`
- `Makefile simulate` target
- `.github/workflows/simulator.yml`

For new development, always use `simulator/`.

Migration Plan (Cycle #5+):
- Migrate test_simulation.py to test against simulator/ directly
- Archive or remove simulation/ entirely

Package version: mc-v1.0 (legacy)
"""

__version__ = "1.0.0"
__status__ = "legacy"
__author__ = "BaselineMLB"
__model_version__ = "mc-v1.0"

"""
conftest.py — Shared pytest configuration for BaselineMLB tests.

Ensures the workspace root is on sys.path so all package imports
(simulation/, simulator/, models/, lib/, pipeline/) resolve correctly
when running `pytest tests/` from any directory.
"""

import os
import sys

# Add workspace root to sys.path for package imports
WORKSPACE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if WORKSPACE not in sys.path:
    sys.path.insert(0, WORKSPACE)

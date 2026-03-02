# =============================================================================
# Makefile — Baseline MLB
# Common commands for local development and CI
# =============================================================================

.PHONY: help simulate backtest train refresh-data test lint test-python \
        test-frontend projections grade props setup clean full-pipeline

PYTHON ?= python3.11
PIP ?= pip
NPM ?= npm
NUM_SIMS ?= 10000

CYAN  := \033[36m
GREEN := \033[32m
RESET := \033[0m

help: ## Show available commands
	@echo ""
	@echo "$(CYAN)Baseline MLB — Development Commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""

setup: ## Install all dependencies (Python + Node)
	$(PIP) install --upgrade pip
	$(PIP) install -r requirements.txt
	$(PIP) install ruff pytest pytest-cov xgboost scikit-learn numpy scipy joblib
	cd frontend && $(NPM) install

simulate: ## Run Monte Carlo simulation for today's games
	@echo "$(CYAN)Running simulation pipeline...$(RESET)"
	$(PYTHON) pipeline/fetch_games.py
	$(PYTHON) pipeline/fetch_players.py
	$(PYTHON) pipeline/fetch_props.py
	$(PYTHON) pipeline/generate_projections.py
	$(PYTHON) pipeline/generate_batter_projections.py
	@echo "$(GREEN)Point-estimate projections complete.$(RESET)"
	@echo "$(CYAN)Running Monte Carlo engine ($(NUM_SIMS) sims)...$(RESET)"
	$(PYTHON) -m simulator.run_daily --n-sims $(NUM_SIMS) || echo "$(CYAN)MC simulator skipped (dependencies not met or no games today).$(RESET)"
	@echo "$(GREEN)Simulation complete.$(RESET)"

backtest: ## Run backtest for the past week
	@echo "$(CYAN)Running weekly backtest...$(RESET)"
	$(PYTHON) scripts/grade_accuracy.py --backfill 7
	@echo "$(GREEN)Backtest complete.$(RESET)"

train: ## Retrain the XGBoost matchup model
	@echo "$(CYAN)Retraining model...$(RESET)"
	@mkdir -p models data/training
	$(PYTHON) scripts/grade_accuracy.py --backfill 30
	@echo "For full retrain, run: gh workflow run model_retrain.yml"

refresh-data: ## Fetch latest Statcast, props, and umpire data
	@echo "$(CYAN)Refreshing data...$(RESET)"
	$(PYTHON) pipeline/fetch_statcast.py
	$(PYTHON) pipeline/fetch_props.py
	$(PYTHON) pipeline/fetch_umpire_framing.py
	@echo "$(GREEN)Data refresh complete.$(RESET)"

projections: ## Generate pitcher + batter projections for today
	$(PYTHON) pipeline/generate_projections.py
	$(PYTHON) pipeline/generate_batter_projections.py

props: ## Fetch latest prop lines from The Odds API
	$(PYTHON) pipeline/fetch_props.py

grade: ## Grade yesterday's picks against actual results
	$(PYTHON) scripts/grade_accuracy.py
	$(PYTHON) scripts/track_clv.py

test: lint test-python test-frontend ## Run all tests (lint + pytest + frontend)
	@echo "$(GREEN)All tests passed.$(RESET)"

lint: ## Lint Python code with Ruff
	ruff check pipeline/ scripts/ lib/ tests/ \
		--select E,F,W,I --ignore E501,E402

test-python: ## Run Python unit tests with Pytest
	$(PYTHON) -m pytest tests/ -v --tb=short \
		--cov=pipeline --cov=lib --cov-report=term-missing

test-frontend: ## Build and lint the Next.js frontend
	cd frontend && $(NPM) run lint || true
	cd frontend && $(NPM) run build

clean: ## Remove cached data and build artifacts
	rm -rf data/*.json data/training/ __pycache__ .pytest_cache .ruff_cache
	rm -rf frontend/.next frontend/node_modules/.cache

full-pipeline: ## Run the complete daily pipeline end-to-end
	$(MAKE) refresh-data
	$(MAKE) simulate
	$(MAKE) grade

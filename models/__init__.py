"""
BaselineMLB — Matchup Probability Model

Multi-class gradient boosting model for predicting plate appearance
outcome probabilities. This is the "brain" of the Monte Carlo game simulator.

Modules:
    feature_config  — Centralized feature names, outcome labels, defaults
    matchup_model   — Core LightGBM model class with SHAP explanations
    train_model     — CLI script for training and saving model artifacts
    predict         — Inference API returning PA outcome probability vectors
"""

__version__ = "1.0.0"

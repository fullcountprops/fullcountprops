"""
Umpire & Catcher Framing Model
==============================
Estimates called-strike probability for any pitch location using
logistic regression on Statcast pitch-by-pitch data.

Outputs:
  - Per-catcher framing runs above average (RAA)
  - Per-umpire zone bias (horizontal / vertical tendencies)
  - Strike probability surface (for viz)

Data source: pybaseball statcast() — 2021-2024 seasons
Model: Logistic regression with position + count + handedness controls
"""

import pandas as pd
import numpy as np
from pybaseball import statcast
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_score
import warnings
warnings.filterwarnings('ignore')

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
STRIKE_ZONE_TOP_DEFAULT = 3.5   # ft (approx MLB average)
STRIKE_ZONE_BOT_DEFAULT = 1.5   # ft
STRIKE_ZONE_LEFT  = -0.8333    # ft (half plate width + ball radius)
STRIKE_ZONE_RIGHT =  0.8333    # ft

# Run value of a called strike vs ball (approx from RE24)
RUN_VALUE_CS_VS_BALL = 0.136   # runs

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_called_pitches(start_year: int = 2023, end_year: int = 2024) -> pd.DataFrame:
    """
    Pull Statcast data for called pitches only (description in
    ['called_strike', 'ball']) across the specified seasons.
    """
    frames = []
    for year in range(start_year, end_year + 1):
        print(f"Fetching {year} Statcast data...")
        df = statcast(f"{year}-03-28", f"{year}-10-05")
        called = df[df['description'].isin(['called_strike', 'ball'])].copy()
        frames.append(called)
    data = pd.concat(frames, ignore_index=True)
    print(f"Loaded {len(data):,} called pitches ({start_year}-{end_year})")
    return data


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Engineer model features from raw Statcast columns.
    Features:
      plate_x, plate_z         — horizontal/vertical location (ft)
      plate_x2, plate_z2       — squared terms
      plate_xz                 — interaction
      dist_center              — Euclidean distance from zone center
      on_edge                  — within 1.5 in of any zone boundary
      balls, strikes            — count state
      p_throws_R               — pitcher handedness (1=R, 0=L)
      stand_R                  — batter stance (1=R, 0=L)
    """
    df = df.dropna(subset=['plate_x', 'plate_z', 'balls', 'strikes']).copy()

    df['plate_x2']  = df['plate_x'] ** 2
    df['plate_z2']  = df['plate_z'] ** 2
    df['plate_xz']  = df['plate_x'] * df['plate_z']

    zone_cx = 0.0
    zone_cz = (STRIKE_ZONE_TOP_DEFAULT + STRIKE_ZONE_BOT_DEFAULT) / 2
    df['dist_center'] = np.sqrt((df['plate_x'] - zone_cx)**2 +
                                (df['plate_z'] - zone_cz)**2)

    # On-edge flag: within 2 in (0.167 ft) of any zone boundary
    edge_margin = 0.167
    df['on_edge'] = (
        (df['plate_x'].abs().between(STRIKE_ZONE_RIGHT - edge_margin,
                                      STRIKE_ZONE_RIGHT + edge_margin)) |
        (df['plate_z'].between(STRIKE_ZONE_TOP_DEFAULT - edge_margin,
                               STRIKE_ZONE_TOP_DEFAULT + edge_margin)) |
        (df['plate_z'].between(STRIKE_ZONE_BOT_DEFAULT - edge_margin,
                               STRIKE_ZONE_BOT_DEFAULT + edge_margin))
    ).astype(int)

    df['p_throws_R'] = (df['p_throws'] == 'R').astype(int)
    df['stand_R']    = (df['stand']    == 'R').astype(int)
    df['is_called_strike'] = (df['description'] == 'called_strike').astype(int)

    feature_cols = [
        'plate_x', 'plate_z', 'plate_x2', 'plate_z2', 'plate_xz',
        'dist_center', 'on_edge',
        'balls', 'strikes',
        'p_throws_R', 'stand_R',
    ]
    return df, feature_cols


# ---------------------------------------------------------------------------
# Model training
# ---------------------------------------------------------------------------

def train_strike_prob_model(df: pd.DataFrame, feature_cols: list):
    """
    Fit logistic regression to predict called-strike probability.
    Returns fitted model + scaler.
    """
    X = df[feature_cols].values
    y = df['is_called_strike'].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = LogisticRegression(C=1.0, max_iter=500, solver='lbfgs')
    model.fit(X_scaled, y)

    cv_scores = cross_val_score(model, X_scaled, y, cv=5, scoring='roc_auc')
    print(f"Model AUC (5-fold CV): {cv_scores.mean():.4f} ± {cv_scores.std():.4f}")

    return model, scaler


# ---------------------------------------------------------------------------
# Framing metrics
# ---------------------------------------------------------------------------

def compute_framing_runs(df: pd.DataFrame, model, scaler,
                         feature_cols: list) -> pd.DataFrame:
    """
    For each pitch, compute expected strike probability.
    Framing value (per pitch) = actual_strike - p_strike.
    Aggregate by catcher (fielder_2) to get framing runs above average.

    Framing RAA = sum(actual - expected) * RUN_VALUE_CS_VS_BALL
    """
    X = df[feature_cols].values
    X_scaled = scaler.transform(X)
    df = df.copy()
    df['p_strike'] = model.predict_proba(X_scaled)[:, 1]
    df['framing_value'] = (df['is_called_strike'] - df['p_strike']) * RUN_VALUE_CS_VS_BALL

    # fielder_2 = catcher MLBAM ID in Statcast
    catcher_framing = (
        df.groupby('fielder_2')
        .agg(
            pitches_seen=('framing_value', 'count'),
            framing_runs=('framing_value', 'sum'),
            strike_rate=('is_called_strike', 'mean'),
            expected_strike_rate=('p_strike', 'mean'),
        )
        .reset_index()
        .rename(columns={'fielder_2': 'catcher_id'})
    )
    catcher_framing['framing_runs'] = catcher_framing['framing_runs'].round(1)
    catcher_framing = catcher_framing.sort_values('framing_runs', ascending=False)
    return catcher_framing


def compute_umpire_bias(df: pd.DataFrame, model, scaler,
                        feature_cols: list) -> pd.DataFrame:
    """
    Compute per-umpire called-strike rate vs expected.
    Positive bias = umpire calls more strikes than model predicts.
    """
    if 'umpire' not in df.columns:
        print("No umpire column in dataset — skipping umpire bias computation.")
        return pd.DataFrame()

    X = df[feature_cols].values
    X_scaled = scaler.transform(X)
    df = df.copy()
    df['p_strike'] = model.predict_proba(X_scaled)[:, 1]
    df['strike_above_exp'] = df['is_called_strike'] - df['p_strike']

    umpire_bias = (
        df.groupby('umpire')
        .agg(
            pitches=('strike_above_exp', 'count'),
            strike_bias=('strike_above_exp', 'mean'),
            # Horizontal tendency: positive = inside to RHB
            horiz_bias=('plate_x', lambda x:
                        (df.loc[x.index, 'strike_above_exp'] * x).mean()),
            # Vertical tendency: positive = high zone expanded
            vert_bias=('plate_z', lambda x:
                       (df.loc[x.index, 'strike_above_exp'] * x).mean()),
        )
        .reset_index()
    )
    umpire_bias = umpire_bias[umpire_bias['pitches'] >= 500]  # min sample
    umpire_bias = umpire_bias.sort_values('strike_bias', ascending=False)
    return umpire_bias


# ---------------------------------------------------------------------------
# Strike probability surface (for visualization)
# ---------------------------------------------------------------------------

def strike_prob_surface(model, scaler, feature_cols: list,
                        balls: int = 1, strikes: int = 1,
                        p_throws_R: int = 1, stand_R: int = 1,
                        grid_n: int = 50) -> pd.DataFrame:
    """
    Generate a grid of strike probabilities across the strike zone.
    Useful for heatmap visualization.
    """
    x_grid = np.linspace(-1.5, 1.5, grid_n)
    z_grid = np.linspace(0.5, 4.5, grid_n)
    xx, zz = np.meshgrid(x_grid, z_grid)

    zone_cz = (STRIKE_ZONE_TOP_DEFAULT + STRIKE_ZONE_BOT_DEFAULT) / 2
    dist_center = np.sqrt(xx**2 + (zz - zone_cz)**2)
    edge_margin = 0.167
    on_edge = (
        (np.abs(xx) > STRIKE_ZONE_RIGHT - edge_margin) |
        (zz > STRIKE_ZONE_TOP_DEFAULT - edge_margin) |
        (zz < STRIKE_ZONE_BOT_DEFAULT + edge_margin)
    ).astype(int)

    n = grid_n * grid_n
    grid_df = pd.DataFrame({
        'plate_x':      xx.ravel(),
        'plate_z':      zz.ravel(),
        'plate_x2':     xx.ravel()**2,
        'plate_z2':     zz.ravel()**2,
        'plate_xz':     (xx * zz).ravel(),
        'dist_center':  dist_center.ravel(),
        'on_edge':      on_edge.ravel(),
        'balls':        np.full(n, balls),
        'strikes':      np.full(n, strikes),
        'p_throws_R':   np.full(n, p_throws_R),
        'stand_R':      np.full(n, stand_R),
    })

    X_scaled = scaler.transform(grid_df[feature_cols].values)
    grid_df['p_strike'] = model.predict_proba(X_scaled)[:, 1]
    return grid_df


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    # 1. Load data
    df_raw = load_called_pitches(start_year=2023, end_year=2024)

    # 2. Feature engineering
    df, feature_cols = build_features(df_raw)
    print(f"Training on {len(df):,} called pitches")

    # 3. Train model
    model, scaler = train_strike_prob_model(df, feature_cols)

    # 4. Catcher framing
    framing = compute_framing_runs(df, model, scaler, feature_cols)
    print("\nTop 10 Framers (Runs Above Average):")
    print(framing.head(10).to_string(index=False))

    framing.to_csv('outputs/catcher_framing_2023_2024.csv', index=False)
    print("\nSaved: outputs/catcher_framing_2023_2024.csv")

    # 5. Umpire bias
    ump_bias = compute_umpire_bias(df, model, scaler, feature_cols)
    if not ump_bias.empty:
        print("\nTop 10 Most Strike-Happy Umpires:")
        print(ump_bias.head(10).to_string(index=False))
        ump_bias.to_csv('outputs/umpire_bias_2023_2024.csv', index=False)
        print("Saved: outputs/umpire_bias_2023_2024.csv")

    # 6. Strike prob surface (example: 1-1 count, RHP vs RHB)
    surface = strike_prob_surface(model, scaler, feature_cols,
                                  balls=1, strikes=1)
    surface.to_csv('outputs/strike_prob_surface_1_1.csv', index=False)
    print("Saved: outputs/strike_prob_surface_1_1.csv")

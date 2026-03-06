# Model Methodology — FullCountProps

> Every projection is a glass box. Every factor is logged. Every result is graded publicly.

## Philosophy

FullCountProps rejects black-box machine learning for player prop projections. Instead, we use **transparent, interpretable models** where every input factor is visible and every output is reproducible. If we project a pitcher for 6.2 strikeouts, you can see exactly why.

---

## Pitcher Strikeout Model (v1.0-glass-box)

**Target:** Projected strikeouts for a starting pitcher in a single game.

### Input Factors

| Factor | Source | Weight |
|--------|--------|--------|
| Career K/9 rate | MLB Stats API (career pitching splits) | Primary |
| Park K-factor | Baseball Savant 3-year rolling average | Adjustment (%) |
| Expected innings pitched | Fixed at 5.5 IP (future: model-based) | Multiplier |

### Formula

```
adjusted_k9 = career_k9 * (1 + park_k_factor / 100)
projected_k  = (adjusted_k9 / 9) * expected_innings
```

### Confidence Score

The model assigns a confidence score (0.50 – 0.95) based on:
- Expected innings >= 5.0 IP: +0.15
- Career K/9 > 0: +0.15
- Career K/9 >= 8.0: +0.05

### Park K-Factors

All 30 MLB stadiums are covered. Factors represent the percentage adjustment to a pitcher's K/9 rate at that venue:

- **High K environments (+3 to +5):** Oracle Park, Dodger Stadium, Petco Park, T-Mobile Park, Yankee Stadium, Citi Field
- **Neutral (0 to +2):** Most parks
- **Low K environments (-1 to -8):** Coors Field (-8), Wrigley Field (-3), Great American Ball Park (-2), Citizens Bank Park (-2)

### Backtest Results (2025 Season)

| Metric | Value |
|--------|-------|
| Projections tested | 4,804 |
| Mean Absolute Error | 1.91 K |
| Median Error | 1.62 K |
| Within 1 strikeout | 32.8% |
| Within 2 strikeouts | 58.6% |
| Within 3 strikeouts | 78.7% |

---

## Batter Total Bases Model (v1.1-glass-box-tb-rampup)

**Target:** Projected total bases (1B + 2×2B + 3×3B + 4×HR) for a batter in a single game.

### Input Factors

| Factor | Source | Weight |
|--------|--------|--------|
| Career TB/PA rate | MLB Stats API (career hitting splits) | Primary |
| Early-season ramp-up weight | Games played this season | Blending factor |
| Park TB-factor | Baseball Savant 3-year rolling average | Adjustment (%) |
| Expected plate appearances | Fixed at 4.2 PA (future: lineup-based) | Multiplier |

### Early-Season Ramp-Up

To prevent volatile early-season projections (e.g., a player going 3-for-4 with 2 HRs on Opening Day), career rates are blended with the MLB league average during the first 30 games:

```
weight = min(games_played / 30, 1.0)
blended_tb_pa = (1 - weight) * MLB_AVG_TB_PA + weight * career_tb_per_pa
```

- **Game 0 (Opening Day):** 100% league average (0.135 TB/PA)
- **Game 15:** 50/50 blend
- **Game 30+:** 100% career rate

### Formula

```
adjusted_tb_per_pa = blended_tb_pa * (1 + park_tb_factor / 100)
projected_tb       = adjusted_tb_per_pa * expected_pa
```

### Park TB-Factors

- **Hitter-friendly (+4 to +12):** Coors Field (+12), Great American Ball Park (+8), Yankee Stadium (+5)
- **Neutral (-1 to +3):** Most parks
- **Pitcher-friendly (-2 to -6):** Petco Park (-6), Oracle Park (-5), T-Mobile Park (-5)

---

## Edge Detection (find_edges.py)

The edge finder compares model projections against sportsbook prop lines to identify value bets.

### Process

1. **Match** projections to props on `(mlbam_id, stat_type)`
2. **Calculate edge:** `(projected_value - line) / line * 100`
3. **Determine direction:** OVER if projection > line, UNDER if projection < line
4. **No-vig probability:** Remove book overround from odds
5. **Kelly sizing:** Fractional Kelly criterion (default 25%) with 5% bankroll cap

### Confidence Tiers

| Edge Magnitude | Tier | Recommended Units |
|---------------|------|-------------------|
| >= 20% | HIGH | 3-5 units |
| >= 10% | MEDIUM | 2-3 units |
| >= 5% | LOW-MEDIUM | 1-2 units |
| < 5% | LOW | 0.5-1 units |

---

## Accuracy Grading (grade_accuracy.py)

Every projection is graded against actual results:
- **Hit:** Projection was on the correct side of the line
- **Miss:** Projection was on the wrong side
- **Push:** Actual result equals the line exactly

Grading runs nightly at 2 AM ET via the overnight pipeline.

---

## CLV Tracking (track_clv.py)

Closing Line Value (CLV) measures whether our projections moved in the right direction relative to market consensus:

```
price_movement = opening_price - closing_price
clv_percent    = (price_movement / abs(closing_price)) * 100
```

Positive CLV = the market moved toward our projection after we made it.

---

## Future Improvements

- **Opponent lineup K-rate:** Factor in opposing team's strikeout tendency
- **Recent form (14-day rolling):** Weight recent performance more heavily
- **Umpire + catcher framing composites:** Already collected, not yet in model
- **Platoon splits:** L/R matchup adjustments for batter projections
- **Weather factors:** Wind speed/direction at outdoor parks
- **Dynamic expected innings:** Model based on pitch count tendencies

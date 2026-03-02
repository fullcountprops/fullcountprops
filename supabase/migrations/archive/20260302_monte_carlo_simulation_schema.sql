-- ============================================================
-- Migration: Monte Carlo Simulation System Schema
-- Date: 2026-03-02
-- Description: Complete schema for the Monte Carlo simulation
--   engine, including:
--   1. simulation_results — per-player sim outputs + edge calc
--   2. simulation_explanations — SHAP-based feature explanations
--   3. backtest_results — daily accuracy / ROI tracking by tier
--   4. model_artifacts — versioned model registry
--   5. player_rolling_stats — 14-day rolling Statcast metrics
--   6. RLS policies (public read, service-role write)
--   7. Indexes for date / player / game query patterns
--   8. Database functions: get_todays_edges(),
--      get_player_history(player_id), get_backtest_summary()
-- ============================================================

-- ============================================================
-- 1. SIMULATION RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS simulation_results (
  id                BIGSERIAL PRIMARY KEY,
  game_id           INT NOT NULL,
  simulation_date   DATE NOT NULL,
  player_id         INT NOT NULL,
  player_name       TEXT NOT NULL,
  team              TEXT,
  prop_type         TEXT NOT NULL
                      CHECK (prop_type IN ('K','H','TB','HR','R','RBI','BB')),
  sportsbook_line   NUMERIC(5,1) NOT NULL,
  simulated_mean    NUMERIC(8,4) NOT NULL,
  simulated_median  NUMERIC(8,4) NOT NULL,
  p_over            NUMERIC(6,5) NOT NULL,
  p_under           NUMERIC(6,5) NOT NULL,
  edge_pct          NUMERIC(7,4),
  kelly_stake       NUMERIC(6,4),
  confidence_tier   TEXT CHECK (confidence_tier IN ('A','B','C','D')),
  distribution_json JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW(),

  -- One simulation per player + prop + game per day
  UNIQUE (simulation_date, game_id, player_id, prop_type)
);

COMMENT ON TABLE simulation_results IS
  'Monte Carlo simulation outputs — one row per player/prop/game/day';

-- ============================================================
-- 2. SIMULATION EXPLANATIONS (SHAP values)
-- ============================================================
CREATE TABLE IF NOT EXISTS simulation_explanations (
  id                  BIGSERIAL PRIMARY KEY,
  result_id           BIGINT NOT NULL
                        REFERENCES simulation_results(id)
                        ON DELETE CASCADE,
  feature_name        TEXT NOT NULL,
  shap_value          NUMERIC(10,6) NOT NULL,
  direction           TEXT NOT NULL
                        CHECK (direction IN ('positive','negative')),
  human_readable_text TEXT,

  -- One explanation per feature per result
  UNIQUE (result_id, feature_name)
);

COMMENT ON TABLE simulation_explanations IS
  'SHAP-based feature explanations for each simulation result';

-- ============================================================
-- 3. BACKTEST RESULTS
-- ============================================================
CREATE TABLE IF NOT EXISTS backtest_results (
  id                  BIGSERIAL PRIMARY KEY,
  date                DATE NOT NULL,
  prop_type           TEXT NOT NULL
                        CHECK (prop_type IN ('K','H','TB','HR','R','RBI','BB','ALL')),
  total_predictions   INT NOT NULL DEFAULT 0,
  correct_predictions INT NOT NULL DEFAULT 0,
  accuracy_pct        NUMERIC(6,3),
  profit_loss         NUMERIC(10,2),
  roi_pct             NUMERIC(7,3),
  avg_edge            NUMERIC(7,4),
  tier_a_roi          NUMERIC(7,3),
  tier_b_roi          NUMERIC(7,3),
  tier_c_roi          NUMERIC(7,3),
  created_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (date, prop_type)
);

COMMENT ON TABLE backtest_results IS
  'Daily backtest accuracy and ROI by prop type and confidence tier';

-- ============================================================
-- 4. MODEL ARTIFACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS model_artifacts (
  id                      BIGSERIAL PRIMARY KEY,
  model_version           TEXT NOT NULL UNIQUE,
  trained_date            DATE NOT NULL,
  training_samples        INT,
  log_loss                NUMERIC(8,6),
  accuracy_vs_baseline    NUMERIC(7,4),
  feature_importance_json JSONB,
  model_path              TEXT,
  is_active               BOOLEAN DEFAULT FALSE,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE model_artifacts IS
  'Versioned model registry — only one model should have is_active = TRUE';

-- ============================================================
-- 5. PLAYER ROLLING STATS (14-day Statcast windows)
-- ============================================================
CREATE TABLE IF NOT EXISTS player_rolling_stats (
  id              BIGSERIAL PRIMARY KEY,
  player_id       INT NOT NULL,
  stat_date       DATE NOT NULL,
  k_rate_14d      NUMERIC(6,4),
  bb_rate_14d     NUMERIC(6,4),
  xba_14d         NUMERIC(6,4),
  xslg_14d        NUMERIC(6,4),
  barrel_rate_14d NUMERIC(6,4),
  chase_rate_14d  NUMERIC(6,4),
  whiff_rate_14d  NUMERIC(6,4),
  exit_velo_14d   NUMERIC(6,2),
  hard_hit_14d    NUMERIC(6,4),
  swstr_14d       NUMERIC(6,4),
  csw_14d         NUMERIC(6,4),
  zone_14d        NUMERIC(6,4),
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (player_id, stat_date)
);

COMMENT ON TABLE player_rolling_stats IS
  '14-day rolling Statcast metrics per player, refreshed daily';

-- ============================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all new tables
ALTER TABLE simulation_results      ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulation_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_artifacts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_rolling_stats    ENABLE ROW LEVEL SECURITY;

-- Public read policies (anon + authenticated can SELECT)
CREATE POLICY public_read_simulation_results
  ON simulation_results FOR SELECT
  USING (TRUE);

CREATE POLICY public_read_simulation_explanations
  ON simulation_explanations FOR SELECT
  USING (TRUE);

CREATE POLICY public_read_backtest_results
  ON backtest_results FOR SELECT
  USING (TRUE);

CREATE POLICY public_read_model_artifacts
  ON model_artifacts FOR SELECT
  USING (TRUE);

CREATE POLICY public_read_player_rolling_stats
  ON player_rolling_stats FOR SELECT
  USING (TRUE);

-- Service-role write policies (pipeline service key only)
CREATE POLICY service_write_simulation_results
  ON simulation_results FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY service_write_simulation_explanations
  ON simulation_explanations FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY service_write_backtest_results
  ON backtest_results FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY service_write_model_artifacts
  ON model_artifacts FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY service_write_player_rolling_stats
  ON player_rolling_stats FOR ALL
  TO service_role
  USING (TRUE) WITH CHECK (TRUE);

-- ============================================================
-- 7. INDEXES
-- ============================================================

-- simulation_results: query by date, player, game, confidence
CREATE INDEX IF NOT EXISTS idx_sim_results_date
  ON simulation_results (simulation_date);
CREATE INDEX IF NOT EXISTS idx_sim_results_player
  ON simulation_results (player_id);
CREATE INDEX IF NOT EXISTS idx_sim_results_game
  ON simulation_results (game_id);
CREATE INDEX IF NOT EXISTS idx_sim_results_date_player
  ON simulation_results (simulation_date, player_id);
CREATE INDEX IF NOT EXISTS idx_sim_results_date_tier
  ON simulation_results (simulation_date, confidence_tier);
CREATE INDEX IF NOT EXISTS idx_sim_results_prop_type
  ON simulation_results (prop_type);

-- simulation_explanations: look up by result_id
CREATE INDEX IF NOT EXISTS idx_sim_explanations_result
  ON simulation_explanations (result_id);

-- backtest_results: query by date range, prop type
CREATE INDEX IF NOT EXISTS idx_backtest_date
  ON backtest_results (date);
CREATE INDEX IF NOT EXISTS idx_backtest_prop_type
  ON backtest_results (prop_type);

-- model_artifacts: find active model quickly
CREATE INDEX IF NOT EXISTS idx_model_active
  ON model_artifacts (is_active) WHERE is_active = TRUE;

-- player_rolling_stats: query by player, date, or both
CREATE INDEX IF NOT EXISTS idx_rolling_stats_player
  ON player_rolling_stats (player_id);
CREATE INDEX IF NOT EXISTS idx_rolling_stats_date
  ON player_rolling_stats (stat_date);
CREATE INDEX IF NOT EXISTS idx_rolling_stats_player_date
  ON player_rolling_stats (player_id, stat_date);

-- ============================================================
-- 8. DATABASE FUNCTIONS
-- ============================================================

-- get_todays_edges(): Return all simulation results for today
-- that have positive edge, ranked by confidence + edge size
CREATE OR REPLACE FUNCTION get_todays_edges(
  min_edge NUMERIC DEFAULT 0,
  target_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  id              BIGINT,
  game_id         INT,
  player_id       INT,
  player_name     TEXT,
  team            TEXT,
  prop_type       TEXT,
  sportsbook_line NUMERIC,
  simulated_mean  NUMERIC,
  simulated_median NUMERIC,
  p_over          NUMERIC,
  p_under         NUMERIC,
  edge_pct        NUMERIC,
  kelly_stake     NUMERIC,
  confidence_tier TEXT,
  distribution_json JSONB
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sr.id,
    sr.game_id,
    sr.player_id,
    sr.player_name,
    sr.team,
    sr.prop_type,
    sr.sportsbook_line,
    sr.simulated_mean,
    sr.simulated_median,
    sr.p_over,
    sr.p_under,
    sr.edge_pct,
    sr.kelly_stake,
    sr.confidence_tier,
    sr.distribution_json
  FROM simulation_results sr
  WHERE sr.simulation_date = target_date
    AND ABS(sr.edge_pct) >= min_edge
  ORDER BY
    CASE sr.confidence_tier
      WHEN 'A' THEN 1
      WHEN 'B' THEN 2
      WHEN 'C' THEN 3
      WHEN 'D' THEN 4
      ELSE 5
    END,
    ABS(sr.edge_pct) DESC;
$$;

COMMENT ON FUNCTION get_todays_edges IS
  'Returns today''s simulation results with edge >= min_edge, ranked by tier + edge size';


-- get_player_history(player_id): Return recent simulation
-- results + rolling stats for a specific player
CREATE OR REPLACE FUNCTION get_player_history(
  p_player_id INT,
  lookback_days INT DEFAULT 30
)
RETURNS TABLE (
  simulation_date   DATE,
  prop_type         TEXT,
  sportsbook_line   NUMERIC,
  simulated_mean    NUMERIC,
  p_over            NUMERIC,
  p_under           NUMERIC,
  edge_pct          NUMERIC,
  confidence_tier   TEXT,
  -- rolling stats (joined)
  k_rate_14d        NUMERIC,
  bb_rate_14d       NUMERIC,
  xba_14d           NUMERIC,
  xslg_14d          NUMERIC,
  barrel_rate_14d   NUMERIC,
  whiff_rate_14d    NUMERIC,
  exit_velo_14d     NUMERIC,
  hard_hit_14d      NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    sr.simulation_date,
    sr.prop_type,
    sr.sportsbook_line,
    sr.simulated_mean,
    sr.p_over,
    sr.p_under,
    sr.edge_pct,
    sr.confidence_tier,
    prs.k_rate_14d,
    prs.bb_rate_14d,
    prs.xba_14d,
    prs.xslg_14d,
    prs.barrel_rate_14d,
    prs.whiff_rate_14d,
    prs.exit_velo_14d,
    prs.hard_hit_14d
  FROM simulation_results sr
  LEFT JOIN player_rolling_stats prs
    ON prs.player_id = sr.player_id
    AND prs.stat_date = sr.simulation_date
  WHERE sr.player_id = p_player_id
    AND sr.simulation_date >= CURRENT_DATE - lookback_days
  ORDER BY sr.simulation_date DESC, sr.prop_type;
$$;

COMMENT ON FUNCTION get_player_history IS
  'Returns recent simulation results + rolling stats for a player over the lookback window';


-- get_backtest_summary(): Aggregate backtest performance
-- across a date range, broken down by prop type
CREATE OR REPLACE FUNCTION get_backtest_summary(
  start_date DATE DEFAULT CURRENT_DATE - 30,
  end_date   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  prop_type           TEXT,
  days_tracked        BIGINT,
  total_predictions   BIGINT,
  correct_predictions BIGINT,
  accuracy_pct        NUMERIC,
  total_profit_loss   NUMERIC,
  avg_roi_pct         NUMERIC,
  avg_edge            NUMERIC,
  avg_tier_a_roi      NUMERIC,
  avg_tier_b_roi      NUMERIC,
  avg_tier_c_roi      NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    br.prop_type,
    COUNT(*)                          AS days_tracked,
    SUM(br.total_predictions)         AS total_predictions,
    SUM(br.correct_predictions)       AS correct_predictions,
    CASE
      WHEN SUM(br.total_predictions) > 0
      THEN ROUND(
        100.0 * SUM(br.correct_predictions) / SUM(br.total_predictions), 2
      )
      ELSE 0
    END                               AS accuracy_pct,
    SUM(br.profit_loss)               AS total_profit_loss,
    ROUND(AVG(br.roi_pct), 3)        AS avg_roi_pct,
    ROUND(AVG(br.avg_edge), 4)       AS avg_edge,
    ROUND(AVG(br.tier_a_roi), 3)     AS avg_tier_a_roi,
    ROUND(AVG(br.tier_b_roi), 3)     AS avg_tier_b_roi,
    ROUND(AVG(br.tier_c_roi), 3)     AS avg_tier_c_roi
  FROM backtest_results br
  WHERE br.date BETWEEN start_date AND end_date
  GROUP BY br.prop_type
  ORDER BY accuracy_pct DESC;
$$;

COMMENT ON FUNCTION get_backtest_summary IS
  'Aggregated backtest metrics over a date range, grouped by prop type';

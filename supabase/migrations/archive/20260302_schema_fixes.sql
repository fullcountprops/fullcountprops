-- ============================================================
-- Migration: Add missing constraints, policies, and tables
-- Date: 2026-03-02
-- Description: Fixes critical schema gaps identified in audit:
--   1. Unique constraints on projections, picks, umpire_framing
--   2. Missing RLS policy for props (public read)
--   3. Missing email_subscribers table
--   4. Missing pitcher_overrides table
--   5. Missing columns on games table
--   6. Index on projections.stat_type
-- ============================================================

-- 1. UNIQUE CONSTRAINTS
ALTER TABLE projections
  ADD CONSTRAINT projections_unique_daily
  UNIQUE (game_date, mlbam_id, stat_type);

ALTER TABLE picks
  ADD CONSTRAINT picks_unique_daily
  UNIQUE (game_date, mlbam_id, stat_type);

ALTER TABLE umpire_framing
  ADD CONSTRAINT umpire_framing_unique_game
  UNIQUE (game_pk, umpire_id, catcher_id);

ALTER TABLE accuracy_summary
  ADD CONSTRAINT accuracy_summary_unique_period
  UNIQUE (period, stat_type);

-- 2. MISSING RLS POLICY FOR PROPS
CREATE POLICY public_read_props ON props
  FOR SELECT USING (TRUE);

-- 3. EMAIL SUBSCRIBERS TABLE
CREATE TABLE IF NOT EXISTS email_subscribers (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  source        TEXT DEFAULT 'website',
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed  BOOLEAN DEFAULT FALSE
);
ALTER TABLE email_subscribers ENABLE ROW LEVEL SECURITY;

-- 4. PITCHER OVERRIDES TABLE
CREATE TABLE IF NOT EXISTS pitcher_overrides (
  id            BIGSERIAL PRIMARY KEY,
  game_pk       INT NOT NULL REFERENCES games(game_pk),
  game_date     DATE NOT NULL,
  side          TEXT NOT NULL CHECK (side IN ('home', 'away')),
  pitcher_id    INT NOT NULL,
  pitcher_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_pk, side)
);
ALTER TABLE pitcher_overrides ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS overrides_date_idx ON pitcher_overrides(game_date);

-- 5. MISSING GAMES TABLE COLUMNS
ALTER TABLE games ADD COLUMN IF NOT EXISTS game_time TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_probable_pitcher_id INT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS home_probable_pitcher TEXT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_probable_pitcher_id INT;
ALTER TABLE games ADD COLUMN IF NOT EXISTS away_probable_pitcher TEXT;

-- 6. MISSING INDEX
CREATE INDEX IF NOT EXISTS proj_stat_type_idx ON projections(stat_type);

-- 7. RLS POLICY FOR CLV TRACKING
ALTER TABLE clv_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read_clv ON clv_tracking
  FOR SELECT USING (TRUE);

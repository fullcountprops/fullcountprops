-- ============================================================
-- Baseline MLB — Migration: Statcast Historical Pipeline Tables
-- Run after the base schema.sql
-- ============================================================

-- 1. PLAYER SEASON STATS (aggregated from Statcast PA data)
-- One row per (mlbam_id, season, role). Used by frontend and model.
CREATE TABLE IF NOT EXISTS player_season_stats (
  id              BIGSERIAL PRIMARY KEY,
  mlbam_id        INT NOT NULL REFERENCES players(mlbam_id),
  season          INT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('pitcher', 'batter')),

  -- Common stats
  pa_faced        INT,          -- PAs faced (pitcher) or taken (batter)
  k_pct           NUMERIC(5,4),
  bb_pct          NUMERIC(5,4),
  hr_pct          NUMERIC(5,4),

  -- Pitcher-specific
  avg_velo        NUMERIC(5,1),
  swstr_pct       NUMERIC(5,4),
  csw_pct         NUMERIC(5,4),
  zone_pct        NUMERIC(5,4),
  gb_rate         NUMERIC(5,4),
  fb_rate         NUMERIC(5,4),

  -- Batter-specific
  avg_ev          NUMERIC(5,1),
  barrel_pct      NUMERIC(5,4),
  chase_rate      NUMERIC(5,4),
  whiff_pct       NUMERIC(5,4),
  xba             NUMERIC(5,3),
  xslg            NUMERIC(5,3),
  hard_hit_pct    NUMERIC(5,4),

  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mlbam_id, season, role)
);

CREATE INDEX IF NOT EXISTS idx_pss_player_season ON player_season_stats(mlbam_id, season);
CREATE INDEX IF NOT EXISTS idx_pss_role ON player_season_stats(role);

-- 2. LINEUPS (confirmed starting lineups for each game)
CREATE TABLE IF NOT EXISTS lineups (
  id              BIGSERIAL PRIMARY KEY,
  game_pk         INT NOT NULL,
  game_date       DATE NOT NULL,
  mlbam_id        INT NOT NULL,
  full_name       TEXT NOT NULL,
  team            TEXT,
  side            TEXT CHECK (side IN ('home', 'away')),
  batting_order   INT CHECK (batting_order BETWEEN 1 AND 9),
  position        TEXT,
  bats            CHAR(1),
  venue           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_pk, mlbam_id)
);

CREATE INDEX IF NOT EXISTS idx_lineups_date ON lineups(game_date);
CREATE INDEX IF NOT EXISTS idx_lineups_game ON lineups(game_pk);
CREATE INDEX IF NOT EXISTS idx_lineups_player ON lineups(mlbam_id);

-- 3. GAME WEATHER (weather conditions at game time)
CREATE TABLE IF NOT EXISTS game_weather (
  id                    BIGSERIAL PRIMARY KEY,
  game_pk               INT UNIQUE NOT NULL,
  game_date             DATE NOT NULL,
  venue                 TEXT,
  home_team             TEXT,
  is_dome               BOOLEAN DEFAULT FALSE,
  temp_f                NUMERIC(5,1),
  humidity_pct          NUMERIC(5,1),
  wind_speed_mph        NUMERIC(5,1),
  wind_direction_deg    NUMERIC(5,0),
  wind_direction_label  TEXT,
  precipitation_mm      NUMERIC(5,2),
  conditions            TEXT,
  game_hour_local       INT,
  fetched_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_date ON game_weather(game_date);
CREATE INDEX IF NOT EXISTS idx_weather_venue ON game_weather(venue);

-- 4. RLS policies
ALTER TABLE player_season_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE lineups             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_weather        ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_read_pss ON player_season_stats
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_lineups ON lineups
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_weather ON game_weather
  FOR SELECT USING (TRUE);

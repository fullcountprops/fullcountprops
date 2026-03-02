-- ============================================================
-- Baseline MLB — Master Schema
-- ============================================================

-- 1. PLAYERS
CREATE TABLE IF NOT EXISTS players (
  id            BIGSERIAL PRIMARY KEY,
  mlbam_id      INT UNIQUE NOT NULL,
  full_name     TEXT NOT NULL,
  team          TEXT,
  position      TEXT,
  bats          CHAR(1),
  throws        CHAR(1),
  active        BOOLEAN DEFAULT TRUE,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. GAMES
CREATE TABLE IF NOT EXISTS games (
  id                        BIGSERIAL PRIMARY KEY,
  game_pk                   INT UNIQUE NOT NULL,
  game_date                 DATE NOT NULL,
  game_time                 TEXT,
  home_team                 TEXT NOT NULL,
  away_team                 TEXT NOT NULL,
  venue                     TEXT,
  status                    TEXT,
  home_score                INT,
  away_score                INT,
  home_probable_pitcher_id  INT,
  home_probable_pitcher     TEXT,
  away_probable_pitcher_id  INT,
  away_probable_pitcher     TEXT,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PROPS (from The Odds API)
CREATE TABLE IF NOT EXISTS props (
  id              BIGSERIAL PRIMARY KEY,
  external_id     TEXT UNIQUE,
  source          TEXT NOT NULL,
  game_pk         INT REFERENCES games(game_pk),
  mlbam_id        INT REFERENCES players(mlbam_id),
  player_name     TEXT NOT NULL,
  stat_type       TEXT NOT NULL,
  line            NUMERIC(5,1) NOT NULL,
  over_odds       INT,
  under_odds      INT,
  fetched_at      TIMESTAMPTZ DEFAULT NOW(),
  game_date       DATE
);

CREATE INDEX IF NOT EXISTS props_game_date_idx ON props(game_date);
CREATE INDEX IF NOT EXISTS props_mlbam_idx     ON props(mlbam_id);
CREATE INDEX IF NOT EXISTS props_stat_idx      ON props(stat_type);

-- 4. STATCAST (pitch-level)
CREATE TABLE IF NOT EXISTS statcast_pitches (
  id              BIGSERIAL PRIMARY KEY,
  game_pk         INT,
  game_date       DATE,
  pitcher_id      INT,
  batter_id       INT,
  inning          INT,
  pitch_type      TEXT,
  release_speed   NUMERIC(5,2),
  pfx_x           NUMERIC(6,3),
  pfx_z           NUMERIC(6,3),
  plate_x         NUMERIC(6,3),
  plate_z         NUMERIC(6,3),
  description     TEXT,
  zone            INT,
  estimated_ba    NUMERIC(5,3),
  estimated_woba  NUMERIC(5,3),
  launch_speed    NUMERIC(5,2),
  launch_angle    NUMERIC(5,2),
  hit_distance    INT,
  events          TEXT,
  fetched_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS statcast_pitcher_date_idx ON statcast_pitches(pitcher_id, game_date);
CREATE INDEX IF NOT EXISTS statcast_batter_date_idx  ON statcast_pitches(batter_id, game_date);

-- 5. UMPIRE FRAMING COMPOSITE
CREATE TABLE IF NOT EXISTS umpire_framing (
  id                  BIGSERIAL PRIMARY KEY,
  game_pk             INT REFERENCES games(game_pk),
  game_date           DATE NOT NULL,
  umpire_id           INT,
  umpire_name         TEXT,
  catcher_id          INT REFERENCES players(mlbam_id),
  catcher_name        TEXT,
  total_pitches       INT,
  called_strikes      INT,
  extra_strikes       NUMERIC(5,2),
  framing_runs        NUMERIC(6,3),
  strike_rate         NUMERIC(5,4),
  composite_score     NUMERIC(6,3),
  computed_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_pk, umpire_id, catcher_id)
);

CREATE INDEX IF NOT EXISTS framing_date_idx ON umpire_framing(game_date);
CREATE INDEX IF NOT EXISTS framing_ump_idx  ON umpire_framing(umpire_id);

-- 6. PROJECTIONS (model output)
CREATE TABLE IF NOT EXISTS projections (
  id              BIGSERIAL PRIMARY KEY,
  game_date       DATE NOT NULL,
  game_pk         INT,
  mlbam_id        INT REFERENCES players(mlbam_id),
  player_name     TEXT NOT NULL,
  stat_type       TEXT NOT NULL,
  projection      NUMERIC(6,2) NOT NULL,
  confidence      NUMERIC(4,3),
  model_version   TEXT,
  features        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_date, mlbam_id, stat_type)
);

CREATE INDEX IF NOT EXISTS proj_date_player_idx ON projections(game_date, mlbam_id);
CREATE INDEX IF NOT EXISTS proj_stat_idx        ON projections(stat_type);

-- 7. PICKS (model vs line)
CREATE TABLE IF NOT EXISTS picks (
  id              BIGSERIAL PRIMARY KEY,
  game_date       DATE NOT NULL,
  game_pk         INT,
  prop_id         BIGINT REFERENCES props(id),
  projection_id   BIGINT REFERENCES projections(id),
  mlbam_id        INT,
  player_name     TEXT NOT NULL,
  stat_type       TEXT NOT NULL,
  line            NUMERIC(5,1),
  projection      NUMERIC(6,2),
  edge            NUMERIC(6,3),
  direction       TEXT,
  grade           TEXT,
  published       BOOLEAN DEFAULT FALSE,
  result          TEXT,
  actual_value    NUMERIC(6,2),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_date, mlbam_id, stat_type)
);

CREATE INDEX IF NOT EXISTS picks_date_idx      ON picks(game_date);
CREATE INDEX IF NOT EXISTS picks_player_idx    ON picks(mlbam_id);
CREATE INDEX IF NOT EXISTS picks_published_idx ON picks(published);

-- 8. ACCURACY DASHBOARD (materialized summary)
CREATE TABLE IF NOT EXISTS accuracy_summary (
  id              BIGSERIAL PRIMARY KEY,
  period          TEXT NOT NULL,
  stat_type       TEXT,
  total_picks     INT DEFAULT 0,
  hits            INT DEFAULT 0,
  misses          INT DEFAULT 0,
  pushes          INT DEFAULT 0,
  hit_rate        NUMERIC(5,4),
  avg_edge        NUMERIC(6,3),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (period, stat_type)
);

-- 9. CLV TRACKING
CREATE TABLE IF NOT EXISTS clv_tracking (
  id              BIGSERIAL PRIMARY KEY,
  game_date       DATE NOT NULL,
  player_name     TEXT NOT NULL,
  market          TEXT NOT NULL,
  opening_price   INTEGER,
  closing_price   INTEGER,
  opening_line    NUMERIC,
  closing_line    NUMERIC,
  price_movement  INTEGER,
  clv_percent     NUMERIC,
  calculated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_date, player_name, market)
);

CREATE INDEX IF NOT EXISTS idx_clv_game_date ON clv_tracking(game_date);
CREATE INDEX IF NOT EXISTS idx_clv_player    ON clv_tracking(player_name);

-- 10. EMAIL SUBSCRIBERS
CREATE TABLE IF NOT EXISTS email_subscribers (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  source          TEXT DEFAULT 'website',
  subscribed_at   TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed    BOOLEAN DEFAULT FALSE
);

-- 11. PITCHER OVERRIDES
CREATE TABLE IF NOT EXISTS pitcher_overrides (
  id              BIGSERIAL PRIMARY KEY,
  game_pk         INT NOT NULL REFERENCES games(game_pk),
  game_date       DATE NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('home', 'away')),
  pitcher_id      INT NOT NULL,
  pitcher_name    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_pk, side)
);

CREATE INDEX IF NOT EXISTS overrides_date_idx ON pitcher_overrides(game_date);

-- 12. ROW LEVEL SECURITY
ALTER TABLE players          ENABLE ROW LEVEL SECURITY;
ALTER TABLE games            ENABLE ROW LEVEL SECURITY;
ALTER TABLE props            ENABLE ROW LEVEL SECURITY;
ALTER TABLE statcast_pitches ENABLE ROW LEVEL SECURITY;
ALTER TABLE umpire_framing   ENABLE ROW LEVEL SECURITY;
ALTER TABLE projections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE picks            ENABLE ROW LEVEL SECURITY;
ALTER TABLE accuracy_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE clv_tracking     ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitcher_overrides ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY public_read_picks ON picks
  FOR SELECT USING (published = TRUE);
CREATE POLICY public_read_accuracy ON accuracy_summary
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_projections ON projections
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_players ON players
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_games ON games
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_props ON props
  FOR SELECT USING (TRUE);
CREATE POLICY public_read_clv ON clv_tracking
  FOR SELECT USING (TRUE);

-- Baseline MLB — Supabase Database Schema
-- Run this in Supabase SQL Editor to create all tables

-- ───────────────────────────────────────────────────────────────
-- 1. PROPS  — raw prop lines from The Odds API
-- ───────────────────────────────────────────────────────────────
create table if not exists props (
  id              bigserial primary key,
  event_id        text        not null,
  game_date       date        not null,
  home_team       text,
  away_team       text,
  commence_time   timestamptz,
  bookmaker       text        not null,
  market          text        not null,
  player_name     text,
  label           text,        -- 'Over' | 'Under'
  line            numeric,
  odds            integer,
  created_at      timestamptz default now(),
  unique (event_id, bookmaker, market, player_name, label)
);

create index if not exists props_game_date_idx    on props (game_date);
create index if not exists props_player_name_idx  on props (player_name);
create index if not exists props_market_idx       on props (market);

-- ───────────────────────────────────────────────────────────────
-- 2. CATCHER FRAMING
-- ───────────────────────────────────────────────────────────────
create table if not exists catcher_framing (
  id            bigserial primary key,
  player_id     integer     not null,
  player_name   text,
  framing_runs  numeric,
  season        integer     not null,
  updated_at    timestamptz default now(),
  unique (player_id, season)
);

-- ───────────────────────────────────────────────────────────────
-- 3. UMPIRE TENDENCIES
-- ───────────────────────────────────────────────────────────────
create table if not exists umpire_tendencies (
  id                  bigserial primary key,
  umpire              text        not null,
  total_pitches       integer,
  edge_called_strikes numeric,
  edge_pitches        integer,
  edge_strike_pct     numeric,    -- higher = more pitcher-friendly
  as_of               date        not null,
  updated_at          timestamptz default now(),
  unique (umpire, as_of)
);

-- ───────────────────────────────────────────────────────────────
-- 4. PROJECTIONS  — model output (glass-box)
-- ───────────────────────────────────────────────────────────────
create table if not exists projections (
  id              bigserial primary key,
  game_date       date        not null,
  player_name     text        not null,
  market          text        not null,  -- e.g. 'batter_hits'
  projection      numeric     not null,  -- model’s number
  confidence      numeric,               -- 0–1 score
  reasoning       jsonb,                 -- glass-box factors
  created_at      timestamptz default now()
);

create index if not exists proj_game_date_idx   on projections (game_date);
create index if not exists proj_player_idx      on projections (player_name);

-- ───────────────────────────────────────────────────────────────
-- 5. ACCURACY LOG  — powers the public dashboard
-- ───────────────────────────────────────────────────────────────
create table if not exists accuracy_log (
  id              bigserial primary key,
  game_date       date        not null,
  player_name     text        not null,
  market          text        not null,
  projection      numeric     not null,
  line            numeric,
  actual_result   numeric,              -- filled in after game
  hit             boolean,              -- did Over/Under call win?
  created_at      timestamptz default now()
);

create index if not exists acc_game_date_idx on accuracy_log (game_date);
create index if not exists acc_market_idx    on accuracy_log (market);
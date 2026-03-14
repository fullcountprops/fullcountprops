// ==============================================================
// types/boxScore.ts
// ==============================================================
// Place at: frontend/app/types/boxScore.ts
// ==============================================================

export interface SimulationResult {
  game_id: string;
  player_id: string;
  player_name: string;
  team: string;
  prop_type: string;
  simulated_mean: number;
  simulated_median: number;
  sim_std?: number;
  sportsbook_line?: number;
  p_over?: number;
  p_under?: number;
  edge_pct?: number;
  kelly_stake?: number;
  confidence_tier?: string;
  distribution_json?: string;
  batting_order?: number;
  position?: string;
  role?: string;
}

export interface BatterLine {
  player_id: string;
  player_name: string;
  team: string;
  batting_order: number;
  position: string;
  AB: number;
  R: number;
  H: number;
  HR: number;
  RBI: number;
  BB: number;
  K: number;
  TB: number;
}

export interface PitcherLine {
  player_id: string;
  player_name: string;
  team: string;
  IP: number;
  H: number;
  R: number;
  ER: number;
  BB: number;
  K: number;
  HR: number;
}

export interface GameSummary {
  game_id: string;
  game_pk: number;
  game_date: string;
  game_time: string;
  home_team: string;
  away_team: string;
  venue: string;
  home_probable_pitcher: string;
  away_probable_pitcher: string;
  home_probable_pitcher_id: number;
  away_probable_pitcher_id: number;
  status: string;
}

export interface ProjectedBoxScore {
  game: GameSummary;
  away: {
    batters: BatterLine[];
    pitchers: PitcherLine[];
    totals: BatterLine;
  };
  home: {
    batters: BatterLine[];
    pitchers: PitcherLine[];
    totals: BatterLine;
  };
}

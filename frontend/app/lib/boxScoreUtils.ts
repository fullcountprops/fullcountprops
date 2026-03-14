// ==============================================================
// lib/boxScoreUtils.ts
// ==============================================================
// Place at: frontend/app/lib/boxScoreUtils.ts
//
// Pivots flat simulation_results rows (one row per prop_type per player)
// into structured batter lines and pitcher lines for display.
// ==============================================================

import type { SimulationResult, BatterLine, PitcherLine } from '../types/boxScore';

// Prop types that belong to batters vs pitchers
const BATTER_PROPS = new Set(['AB', 'PA', 'H', 'TB', 'HR', 'R', 'RBI', 'BB', 'K']);
const PITCHER_PROPS = new Set(['IP', 'P_H', 'P_ER', 'P_HR', 'P_R', 'P_BB', 'P_K']);

// Map prop_type to the display field name
const PITCHER_PROP_MAP: Record<string, keyof PitcherLine> = {
  'IP': 'IP',
  'P_H': 'H',
  'P_ER': 'ER',
  'P_HR': 'HR',
  'P_R': 'R',
  'P_BB': 'BB',
  'P_K': 'K',
};

/**
 * Determine if a simulation result row is a pitcher stat.
 * Handles both explicit role column and prop_type-based inference.
 */
function isPitcherRow(row: SimulationResult): boolean {
  if (row.role === 'pitcher') return true;
  if (row.role === 'batter') return false;
  return PITCHER_PROPS.has(row.prop_type);
}

/**
 * Pivot flat simulation_results rows into per-player batter lines.
 */
export function buildBatterLines(
  rows: SimulationResult[],
  team: string,
): BatterLine[] {
  const batterRows = rows.filter(
    (r) => r.team === team && !isPitcherRow(r) && BATTER_PROPS.has(r.prop_type),
  );

  // Group by player
  const byPlayer = new Map<string, Map<string, number>>();
  const playerMeta = new Map<string, {
    name: string;
    order: number;
    position: string;
  }>();

  for (const row of batterRows) {
    if (!byPlayer.has(row.player_id)) {
      byPlayer.set(row.player_id, new Map());
      playerMeta.set(row.player_id, {
        name: row.player_name,
        order: row.batting_order ?? 99,
        position: row.position ?? '',
      });
    }
    byPlayer.get(row.player_id)!.set(row.prop_type, row.simulated_mean);
  }

  // Build lines
  const lines: BatterLine[] = [];
  for (const [playerId, stats] of byPlayer) {
    const meta = playerMeta.get(playerId)!;
    lines.push({
      player_id: playerId,
      player_name: meta.name,
      team,
      batting_order: meta.order,
      position: meta.position,
      AB: round(stats.get('AB') ?? 0),
      R: round(stats.get('R') ?? 0),
      H: round(stats.get('H') ?? 0),
      HR: round(stats.get('HR') ?? 0),
      RBI: round(stats.get('RBI') ?? 0),
      BB: round(stats.get('BB') ?? 0),
      K: round(stats.get('K') ?? 0),
      TB: round(stats.get('TB') ?? 0),
    });
  }

  // Sort by batting order
  lines.sort((a, b) => a.batting_order - b.batting_order);
  return lines;
}

/**
 * Pivot flat simulation_results rows into per-player pitcher lines.
 */
export function buildPitcherLines(
  rows: SimulationResult[],
  team: string,
): PitcherLine[] {
  const pitcherRows = rows.filter(
    (r) => r.team === team && (isPitcherRow(r) || PITCHER_PROPS.has(r.prop_type)),
  );

  // Group by player
  const byPlayer = new Map<string, Map<string, number>>();
  const playerNames = new Map<string, string>();

  for (const row of pitcherRows) {
    if (!byPlayer.has(row.player_id)) {
      byPlayer.set(row.player_id, new Map());
      playerNames.set(row.player_id, row.player_name);
    }

    const fieldName = PITCHER_PROP_MAP[row.prop_type];
    if (fieldName) {
      byPlayer.get(row.player_id)!.set(fieldName, row.simulated_mean);
    }
    // Also handle case where pitcher K is stored as plain 'K' with role='pitcher'
    if (row.prop_type === 'K' && row.role === 'pitcher') {
      byPlayer.get(row.player_id)!.set('K', row.simulated_mean);
    }
    if (row.prop_type === 'BB' && row.role === 'pitcher') {
      byPlayer.get(row.player_id)!.set('BB', row.simulated_mean);
    }
  }

  const lines: PitcherLine[] = [];
  for (const [playerId, stats] of byPlayer) {
    lines.push({
      player_id: playerId,
      player_name: playerNames.get(playerId) ?? '',
      team,
      IP: round(stats.get('IP') ?? 0),
      H: round(stats.get('H') ?? 0),
      R: round(stats.get('R') ?? 0),
      ER: round(stats.get('ER') ?? 0),
      BB: round(stats.get('BB') ?? 0),
      K: round(stats.get('K') ?? 0),
      HR: round(stats.get('HR') ?? 0),
    });
  }

  return lines;
}

/**
 * Compute team batting totals from individual batter lines.
 */
export function computeTeamTotals(batters: BatterLine[], team: string): BatterLine {
  return {
    player_id: 'TEAM',
    player_name: 'Team Total',
    team,
    batting_order: 99,
    position: '',
    AB: round(sum(batters, 'AB')),
    R: round(sum(batters, 'R')),
    H: round(sum(batters, 'H')),
    HR: round(sum(batters, 'HR')),
    RBI: round(sum(batters, 'RBI')),
    BB: round(sum(batters, 'BB')),
    K: round(sum(batters, 'K')),
    TB: round(sum(batters, 'TB')),
  };
}

/**
 * Format IP for display. Baseball convention: 6.1 means 6 and 1/3 innings.
 * Since our data is decimal (6.33), convert to baseball notation.
 */
export function formatIP(ip: number): string {
  const full = Math.floor(ip);
  const fraction = ip - full;
  if (fraction < 0.17) return `${full}.0`;
  if (fraction < 0.5) return `${full}.1`;
  if (fraction < 0.84) return `${full}.2`;
  return `${full + 1}.0`;
}

/**
 * Format a projected stat for display.
 * Shows 1 decimal place for most stats, 0 for AB.
 */
export function formatStat(value: number, statType?: string): string {
  if (statType === 'AB') return value.toFixed(1);
  return value.toFixed(2);
}

// Helpers
function round(n: number, decimals = 2): number {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

function sum(lines: BatterLine[], key: keyof BatterLine): number {
  return lines.reduce((acc, line) => acc + (line[key] as number), 0);
}

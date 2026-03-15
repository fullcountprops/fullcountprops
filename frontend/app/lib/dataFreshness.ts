// ============================================================
// FullCountProps — Data Freshness Check
// ============================================================

import { SupabaseClient } from '@supabase/supabase-js'

export type FreshnessStatus = 'fresh' | 'stale' | 'missing'

export interface FreshnessResult {
  status: FreshnessStatus
  lastUpdated: string | null
  count: number
}

const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * Check whether projection data for a given game date is fresh, stale, or missing.
 *
 * - 'fresh'   — most recent updated_at is within the last 6 hours
 * - 'stale'   — most recent updated_at is older than 6 hours
 * - 'missing' — no rows found for that date, or a query error occurred
 */
export async function checkDataFreshness(
  supabase: SupabaseClient,
  gameDate: string,
): Promise<FreshnessResult> {
  try {
    // Fetch the most recently updated row for this game date
    const { data, error } = await supabase
      .from('projections')
      .select('updated_at')
      .eq('game_date', gameDate)
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      return { status: 'missing', lastUpdated: null, count: 0 }
    }

    // Fetch total row count for this date
    const { count } = await supabase
      .from('projections')
      .select('*', { count: 'exact', head: true })
      .eq('game_date', gameDate)

    const lastUpdated: string = data[0].updated_at
    const lastUpdatedMs = new Date(lastUpdated).getTime()
    const status: FreshnessStatus =
      Date.now() - lastUpdatedMs < STALE_THRESHOLD_MS ? 'fresh' : 'stale'

    return {
      status,
      lastUpdated,
      count: count ?? 0,
    }
  } catch {
    return { status: 'missing', lastUpdated: null, count: 0 }
  }
}

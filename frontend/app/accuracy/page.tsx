import { getPublicClient, isSupabaseConfigured } from '../lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// ─────────────────────────────────────────────────────────────────────────────
// Static backtest baseline — 2025 season (always shown as comparison)
// ─────────────────────────────────────────────────────────────────────────────
const BACKTEST_DATA = {
  label: 'Model Validation: 2025 Season Backtest',
  season: '2025',
  model: 'v1.0-glass-box',
  dateRange: '2025-04-01 to 2025-09-30',
  totalProjections: 4804,
  daysProcessed: 183,
  daysWithGames: 179,
  note: 'Projection accuracy only — no prop lines available for 2025 backtest period',
  projectionAccuracy: {
    meanAbsoluteError: 1.91,
    medianError: 1.62,
    within1k: 32.8,
    within2k: 58.6,
    within3k: 78.7,
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface AccuracyRow {
  stat_type: string
  total_picks: number
  hits: number
  misses: number
  pushes: number
  hit_rate: number
  avg_edge: number | null
  avg_clv: number | null
  updated_at: string
}

interface PickRow {
  id: number
  game_date: string
  player_name: string | null
  stat_type: string | null
  projected: number | null
  line: number | null
  actual: number | null
  grade: string | null
  edge: number | null
}

interface LiveStats {
  total: number
  hits: number
  misses: number
  pushes: number
  mae: number | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Data fetching — server side with fallback to empty on error
// ─────────────────────────────────────────────────────────────────────────────
async function getAccuracySummary(): Promise<AccuracyRow[]> {
  if (!isSupabaseConfigured()) return []
  try {
    const supabase = getPublicClient()
    const { data, error } = await supabase
      .from('accuracy_summary')
      .select('*')
      .order('total_picks', { ascending: false })

    if (error) {
      console.error('[AccuracyPage] accuracy_summary fetch error:', error.message)
      return []
    }
    return (data as AccuracyRow[]) || []
  } catch (e) {
    console.error('[AccuracyPage] accuracy_summary unexpected error:', e)
    return []
  }
}

async function getGradedPickStats(): Promise<LiveStats> {
  const fallback: LiveStats = { total: 0, hits: 0, misses: 0, pushes: 0, mae: null }
  if (!isSupabaseConfigured()) return fallback
  try {
    const supabase = getPublicClient()
    const { data, error } = await supabase
      .from('picks')
      .select('grade, projected, actual')
      .not('grade', 'is', null)

    if (error || !data) {
      console.error('[AccuracyPage] picks stats fetch error:', error?.message)
      return fallback
    }

    const hits = data.filter((p: any) => p.grade?.toLowerCase() === 'hit').length
    const misses = data.filter((p: any) => p.grade?.toLowerCase() === 'miss').length
    const pushes = data.filter((p: any) => p.grade?.toLowerCase() === 'push').length

    // Compute MAE from picks that have both projected and actual values
    const gradedWithValues = data.filter(
      (p: any) => p.projected != null && p.actual != null
    )
    let mae: number | null = null
    if (gradedWithValues.length > 0) {
      const totalAbsErr = gradedWithValues.reduce(
        (sum: number, p: any) => sum + Math.abs(Number(p.actual) - Number(p.projected)),
        0
      )
      mae = parseFloat((totalAbsErr / gradedWithValues.length).toFixed(2))
    }

    return { total: data.length, hits, misses, pushes, mae }
  } catch (e) {
    console.error('[AccuracyPage] picks stats unexpected error:', e)
    return fallback
  }
}

async function getRecentPicks(limit = 25): Promise<PickRow[]> {
  if (!isSupabaseConfigured()) return []
  try {
    const supabase = getPublicClient()
    const { data, error } = await supabase
      .from('picks')
      .select('id, game_date, player_name, stat_type, projected, line, actual, grade, edge')
      .not('grade', 'is', null)
      .order('game_date', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[AccuracyPage] recent picks fetch error:', error.message)
      return []
    }
    return (data as PickRow[]) || []
  } catch (e) {
    console.error('[AccuracyPage] recent picks unexpected error:', e)
    return []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────
export default async function AccuracyPage() {
  const [accuracyRows, liveStats, recentPicks] = await Promise.all([
    getAccuracySummary(),
    getGradedPickStats(),
    getRecentPicks(25),
  ])

  const hasLiveData = liveStats.total > 0 || accuracyRows.length > 0
  const d = BACKTEST_DATA
  const acc = d.projectionAccuracy

  const liveHitRate =
    liveStats.total > 0 && (liveStats.hits + liveStats.misses) > 0
      ? ((liveStats.hits / (liveStats.hits + liveStats.misses)) * 100).toFixed(1)
      : null

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Page header */}
      <h1 className="text-3xl font-bold mb-2">Model Accuracy</h1>
      <p className="text-slate-400 mb-8">
        Glass-box prop analytics — public accuracy tracking
      </p>

      {/* ── Live tracking banner ── */}
      {hasLiveData ? (
        <div className="bg-gradient-to-r from-green-900/50 to-emerald-900/50 border border-green-700/30 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-green-300">
            2026 Live Tracking &middot; {liveStats.total.toLocaleString()} graded picks
            {liveHitRate && <> &middot; {liveHitRate}% hit rate</>}
            {liveStats.mae != null && <> &middot; MAE {liveStats.mae} K</>}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {liveStats.hits} hits &middot; {liveStats.misses} misses &middot; {liveStats.pushes} pushes
          </p>
        </div>
      ) : (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-4 mb-6">
          <p className="text-sm text-slate-400">
            Live tracking begins Opening Day 2026. Showing 2025 backtest baseline below.
          </p>
        </div>
      )}

      {/* ── Backtest banner ── */}
      <div className="bg-gradient-to-r from-blue-900/50 to-emerald-900/50 border border-blue-700/30 rounded-lg p-4 mb-8">
        <p className="text-sm font-semibold text-blue-300">
          {d.label} &middot; {d.totalProjections.toLocaleString()} projections &middot; {d.dateRange}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {hasLiveData
            ? 'Historical baseline — compare live 2026 performance against 2025 backtest'
            : 'Live tracking begins Opening Day 2026'}
        </p>
      </div>

      {/* ── Summary metric cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="GRADED PICKS"
          value={liveStats.total > 0 ? liveStats.total.toLocaleString() : '--'}
          sub={liveStats.total > 0 ? '2026 Season' : 'Tracking begins Opening Day 2026'}
        />
        <StatCard
          label="HIT RATE"
          value={liveHitRate ? `${liveHitRate}%` : `${acc.within1k}%`}
          sub={
            liveHitRate
              ? `${liveStats.hits} of ${liveStats.hits + liveStats.misses}`
              : 'Backtest: within 1K'
          }
        />
        <StatCard
          label="MEAN ABS. ERROR"
          value={
            liveStats.mae != null ? `${liveStats.mae} K` : `${acc.meanAbsoluteError} K`
          }
          sub={liveStats.mae != null ? '2026 live data' : 'Backtest baseline'}
        />
        <StatCard
          label="WITHIN 2K"
          value={`${acc.within2k}%`}
          sub="Backtest baseline"
        />
      </div>

      {/* ── Win rate by stat type (live) ── */}
      {accuracyRows.length > 0 && (
        <>
          <h2 className="text-xl font-bold mb-4">Win Rate by Stat Type</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden mb-10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                    Prop Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                    Picks
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                    Hit Rate
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                    Avg Edge
                  </th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                    Avg CLV
                  </th>
                </tr>
              </thead>
              <tbody>
                {accuracyRows.map((row) => (
                  <tr
                    key={row.stat_type}
                    className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium">
                      {STAT_LABELS[row.stat_type] || row.stat_type}
                    </td>
                    <td className="px-4 py-3 text-slate-300">{row.total_picks}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.hit_rate >= 55
                            ? 'text-green-400 font-semibold'
                            : row.hit_rate >= 50
                            ? 'text-blue-400'
                            : 'text-red-400'
                        }
                      >
                        {row.hit_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.avg_edge != null ? `${row.avg_edge.toFixed(1)}%` : '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {row.avg_clv != null ? `${row.avg_clv.toFixed(1)}%` : '--'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Recent graded picks table ── */}
      {recentPicks.length > 0 && (
        <>
          <h2 className="text-xl font-bold mb-4">Recent Graded Picks</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden mb-10">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Player
                    </th>
                    <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Stat
                    </th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Line
                    </th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Projected
                    </th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Actual
                    </th>
                    <th className="text-center px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                      Grade
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentPicks.map((pick) => (
                    <tr
                      key={pick.id}
                      className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {pick.game_date
                          ? new Date(pick.game_date + 'T00:00:00').toLocaleDateString(
                              'en-US',
                              { month: 'short', day: 'numeric' }
                            )
                          : '--'}
                      </td>
                      <td className="px-4 py-3 font-medium whitespace-nowrap">
                        {pick.player_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-slate-300 text-xs">
                        {pick.stat_type ? (STAT_LABELS[pick.stat_type] || pick.stat_type) : '--'}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-400">
                        {pick.line != null ? pick.line.toFixed(1) : '--'}
                      </td>
                      <td className="px-4 py-3 text-center text-slate-300">
                        {pick.projected != null ? pick.projected.toFixed(1) : '--'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {pick.actual != null ? (
                          <span className="font-semibold">{pick.actual}</span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <GradeBadge grade={pick.grade} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ── Model Validation: 2025 Backtest ── */}
      <h2 className="text-xl font-bold mb-1">Model Validation</h2>
      <p className="text-sm text-slate-400 mb-4">
        2025 season backtest — {d.totalProjections.toLocaleString()} pitcher strikeout projections
        across {d.daysWithGames} game days. MAE baseline:{' '}
        <span className="text-white font-semibold">{acc.meanAbsoluteError} K</span>.
      </p>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                Accuracy Tier
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                Rate
              </th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase tracking-wider">
                Projections
              </th>
            </tr>
          </thead>
          <tbody>
            <TierRow
              label="Within 1 Strikeout"
              rate={acc.within1k}
              count={Math.round((d.totalProjections * acc.within1k) / 100)}
            />
            <TierRow
              label="Within 2 Strikeouts"
              rate={acc.within2k}
              count={Math.round((d.totalProjections * acc.within2k) / 100)}
            />
            <TierRow
              label="Within 3 Strikeouts"
              rate={acc.within3k}
              count={Math.round((d.totalProjections * acc.within3k) / 100)}
            />
          </tbody>
        </table>
      </div>

      {/* Backtest meta row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-10">
        <MetaCard label="Mean Abs. Error" value={`${acc.meanAbsoluteError} K`} />
        <MetaCard label="Median Error" value={`${acc.medianError} K`} />
        <MetaCard label="Season" value={d.season} />
        <MetaCard label="Model" value={d.model} />
      </div>

      <p className="text-center text-xs text-slate-500 mt-8">
        Data updates daily at 2 AM ET via GitHub Actions &middot;{' '}
        <a
          href="https://github.com/nrlefty5/baselinemlb"
          className="text-green-400 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          View Source on GitHub
        </a>
      </p>
      <p className="text-center text-xs text-slate-500 mt-1">
        Powered by Statcast, MLB Stats API, and The Odds API
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat label map
// ─────────────────────────────────────────────────────────────────────────────
const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Pitcher Strikeouts (K)',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_total_bases: 'Total Bases (TB)',
  batter_walks: 'Walks',
  batter_strikeouts: 'Batter Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
}

// ─────────────────────────────────────────────────────────────────────────────
// UI components
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{sub}</p>
    </div>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg p-3 text-center">
      <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-semibold text-slate-200">{value}</p>
    </div>
  )
}

function TierRow({
  label,
  rate,
  count,
}: {
  label: string
  rate: number
  count: number
}) {
  const barWidth = `${rate}%`
  return (
    <tr className="border-b border-slate-700/30">
      <td className="px-4 py-3">{label}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-slate-700/50 rounded-full h-1.5 max-w-[80px]">
            <div
              className="bg-green-500 h-1.5 rounded-full"
              style={{ width: barWidth }}
            />
          </div>
          <span className="text-green-400 font-medium">{rate}%</span>
        </div>
      </td>
      <td className="px-4 py-3 text-slate-400">{count.toLocaleString()}</td>
    </tr>
  )
}

function GradeBadge({ grade }: { grade: string | null }) {
  if (!grade) return <span className="text-slate-500">--</span>
  const lower = grade.toLowerCase()
  if (lower === 'hit') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-green-900/60 text-green-300 border border-green-700/40">
        HIT
      </span>
    )
  }
  if (lower === 'miss') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-900/60 text-red-300 border border-red-700/40">
        MISS
      </span>
    )
  }
  if (lower === 'push') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-700/60 text-slate-300 border border-slate-600/40">
        PUSH
      </span>
    )
  }
  return (
    <span className="text-slate-400 text-xs">{grade}</span>
  )
}

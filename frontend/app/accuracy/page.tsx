import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Backtest data — hardcoded from 2025 season validation (fallback when no live data)
const BACKTEST_DATA = {
  label: 'Model Validation: 2025 Season Backtest',
  season: '2025',
  model: 'v1.0-glass-box',
  dateRange: '2025-04-01 to 2025-09-30',
  totalProjections: 4804,
  daysProcessed: 183,
  daysWithGames: 179,
  gradedPicks: 0,
  note: 'Projection accuracy only — no prop lines available for 2025 backtest period',
  projectionAccuracy: {
    meanAbsoluteError: 1.91,
    medianError: 1.62,
    within1k: 32.8,
    within2k: 58.6,
    within3k: 78.7,
  },
}

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

async function getAccuracyData(): Promise<AccuracyRow[]> {
  if (!supabaseUrl || !supabaseAnonKey) return []
  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const { data, error } = await supabase
    .from('accuracy_summary')
    .select('*')
    .order('total_picks', { ascending: false })

  if (error) {
    console.error('Error fetching accuracy data:', error)
    return []
  }
  return (data as AccuracyRow[]) || []
}

async function getRecentPicks() {
  if (!supabaseUrl || !supabaseAnonKey) return { total: 0, hits: 0, misses: 0, pushes: 0 }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const { data, error } = await supabase
    .from('picks')
    .select('grade')
    .not('grade', 'is', null)

  if (error || !data) return { total: 0, hits: 0, misses: 0, pushes: 0 }

  const hits = data.filter((p: any) => p.grade?.toLowerCase() === 'hit').length
  const misses = data.filter((p: any) => p.grade?.toLowerCase() === 'miss').length
  const pushes = data.filter((p: any) => p.grade?.toLowerCase() === 'push').length

  return { total: data.length, hits, misses, pushes }
}

export default async function AccuracyPage() {
  const [accuracyRows, pickStats] = await Promise.all([
    getAccuracyData(),
    getRecentPicks(),
  ])

  const hasLiveData = accuracyRows.length > 0 || pickStats.total > 0
  const d = BACKTEST_DATA
  const acc = d.projectionAccuracy

  // Compute live overall hit rate
  const liveHitRate = pickStats.total > 0
    ? ((pickStats.hits / (pickStats.hits + pickStats.misses)) * 100).toFixed(1)
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-2">Model Accuracy</h1>
      <p className="text-slate-400 mb-8">Glass-box prop analytics — public accuracy tracking</p>

      {/* Live Stats Banner */}
      {hasLiveData && (
        <div className="bg-gradient-to-r from-green-900/50 to-emerald-900/50 border border-green-700/30 rounded-lg p-4 mb-6">
          <p className="text-sm font-semibold text-green-300">
            2026 Live Tracking &middot; {pickStats.total.toLocaleString()} graded picks
            {liveHitRate && <> &middot; {liveHitRate}% hit rate</>}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {pickStats.hits} hits &middot; {pickStats.misses} misses &middot; {pickStats.pushes} pushes
          </p>
        </div>
      )}

      {/* Backtest Banner */}
      <div className="bg-gradient-to-r from-blue-900/50 to-emerald-900/50 border border-blue-700/30 rounded-lg p-4 mb-8">
        <p className="text-sm font-semibold text-blue-300">
          {d.label} &middot; {d.totalProjections.toLocaleString()} projections &middot; {d.dateRange}
        </p>
        <p className="text-xs text-slate-400 mt-1">
          {hasLiveData ? 'Historical baseline comparison' : 'Live tracking begins Opening Day 2026'}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="GRADED PICKS"
          value={pickStats.total > 0 ? pickStats.total.toLocaleString() : '--'}
          sub={pickStats.total > 0 ? '2026 Season' : 'Tracking begins Opening Day 2026'}
        />
        <StatCard
          label="HIT RATE"
          value={liveHitRate ? `${liveHitRate}%` : `${acc.within1k}%`}
          sub={liveHitRate ? `${pickStats.hits} of ${pickStats.hits + pickStats.misses}` : 'Backtest: within 1K'}
        />
        <StatCard
          label="MEAN ABS. ERROR"
          value={`${acc.meanAbsoluteError} K`}
          sub="Backtest baseline"
        />
        <StatCard
          label="WITHIN 2K"
          value={`${acc.within2k}%`}
          sub="Backtest baseline"
        />
      </div>

      {/* Live Accuracy by Prop Market */}
      {accuracyRows.length > 0 && (
        <>
          <h2 className="text-xl font-bold mb-4">Hit Rate by Prop Market (Live)</h2>
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden mb-10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Prop Type</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Picks</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Hit Rate</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Avg Edge</th>
                  <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Avg CLV</th>
                </tr>
              </thead>
              <tbody>
                {accuracyRows.map((row) => (
                  <tr key={row.stat_type} className="border-b border-slate-700/30">
                    <td className="px-4 py-3">{STAT_LABELS[row.stat_type] || row.stat_type}</td>
                    <td className="px-4 py-3">{row.total_picks}</td>
                    <td className="px-4 py-3">
                      <span className={row.hit_rate >= 55 ? 'text-green-400' : row.hit_rate >= 50 ? 'text-blue-400' : 'text-red-400'}>
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

      {/* Backtest Accuracy */}
      <h2 className="text-xl font-bold mb-4">Backtest: Projection Accuracy</h2>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden mb-10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50">
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Accuracy Tier</th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Rate</th>
              <th className="text-left px-4 py-3 text-xs text-slate-400 uppercase">Projections</th>
            </tr>
          </thead>
          <tbody>
            <TierRow label="Within 1 Strikeout" rate={acc.within1k} count={Math.round(d.totalProjections * acc.within1k / 100)} />
            <TierRow label="Within 2 Strikeouts" rate={acc.within2k} count={Math.round(d.totalProjections * acc.within2k / 100)} />
            <TierRow label="Within 3 Strikeouts" rate={acc.within3k} count={Math.round(d.totalProjections * acc.within3k / 100)} />
          </tbody>
        </table>
      </div>

      <p className="text-center text-xs text-slate-500 mt-8">
        Data updates daily at 2 AM ET via GitHub Actions &middot;{' '}
        <a href="https://github.com/nrlefty5/baselinemlb" className="text-green-400 hover:underline" target="_blank" rel="noopener noreferrer">View Source on GitHub</a>
      </p>
      <p className="text-center text-xs text-slate-500 mt-1">Powered by Statcast, MLB Stats API, and The Odds API</p>
    </div>
  )
}

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Pitcher Strikeouts',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_total_bases: 'Total Bases',
  batter_walks: 'Walks',
  batter_strikeouts: 'Batter Strikeouts',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
      <p className="text-xs text-slate-400 uppercase mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{sub}</p>
    </div>
  )
}

function TierRow({ label, rate, count }: { label: string; rate: number; count: number }) {
  return (
    <tr className="border-b border-slate-700/30">
      <td className="px-4 py-3">{label}</td>
      <td className="px-4 py-3">{rate}%</td>
      <td className="px-4 py-3">{count.toLocaleString()}</td>
    </tr>
  )
}

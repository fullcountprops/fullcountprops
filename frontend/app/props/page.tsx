import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'

export const metadata: Metadata = {
  title: "Today's Props — FullCountProps",
  description:
    'MLB player prop lines with model edge percentages. Updated 4x daily. Over/under odds from major sportsbooks compared to FullCountProps projections.',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getTodaysProps() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return []
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('props')
    .select('*')
    .eq('game_date', today)
    .order('player_name', { ascending: true })
    .limit(200)

  if (error) {
    console.error('Error fetching props:', error)
    return []
  }
  return data || []
}

const MARKET_LABELS: Record<string, string> = {
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_strikeouts: 'Strikeouts',
  batter_walks: 'Walks',
  batter_total_bases: 'Total Bases',
  pitcher_strikeouts: 'Pitcher Ks',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_walks: 'Walks Allowed',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
}

function PropRow({ prop }: { prop: any }) {
  // Fix: use prop.stat_type (actual DB column), not prop.market_key
  const marketLabel = MARKET_LABELS[prop.stat_type] || prop.stat_type
  const hasEdge = prop.edge_pct && Math.abs(prop.edge_pct) >= 3
  const edgeColor = hasEdge
    ? prop.edge_pct > 0
      ? 'text-green-400'
      : 'text-red-400'
    : 'text-slate-500'

  return (
    <tr className="border-b border-gray-700 hover:bg-gray-750 transition-colors">
      <td className="py-3 px-4">
        <div className="font-medium text-white">{prop.player_name}</div>
        <div className="text-xs text-slate-500">{prop.source || ''}</div>
      </td>
      <td className="py-3 px-4 text-slate-300">{marketLabel}</td>
      <td className="py-3 px-4 text-center">
        <span className="font-semibold text-white">{prop.line}</span>
      </td>
      <td className="py-3 px-4 text-center">
        {prop.over_odds && (
          <span className={prop.over_odds > 0 ? 'text-green-400' : 'text-slate-300'}>
            {prop.over_odds > 0 ? '+' : ''}{prop.over_odds}
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-center">
        {prop.under_odds && (
          <span className={prop.under_odds > 0 ? 'text-green-400' : 'text-slate-300'}>
            {prop.under_odds > 0 ? '+' : ''}{prop.under_odds}
          </span>
        )}
      </td>
      <td className="py-3 px-4 text-center">
        {prop.edge_pct != null ? (
          <span className={`font-medium ${edgeColor}`}>
            {prop.edge_pct > 0 ? '+' : ''}{prop.edge_pct.toFixed(1)}%
          </span>
        ) : (
          <span className="text-slate-600">--</span>
        )}
      </td>
    </tr>
  )
}

export default async function PropsPage() {
  const props = await getTodaysProps()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  })

  // Fix: group by prop.stat_type (actual DB column), not prop.market_key
  const byMarket = props.reduce((acc: any, prop: any) => {
    const key = prop.stat_type || 'other'
    if (!acc[key]) acc[key] = []
    acc[key].push(prop)
    return acc
  }, {})

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Today&apos;s Props</h1>
        <p className="text-slate-400">
          {today} &bull; {props.length} lines tracked
        </p>
      </div>

      {props.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-semibold text-white mb-3">No props today</h2>
            <p className="text-slate-400 leading-relaxed mb-8">
              Daily props will appear here once the MLB season begins on March 27, 2026.
            </p>
            <a
              href="/pricing"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
            >
              Get Started Free
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(byMarket).map(([market, marketProps]: [string, any]) => (
            <section key={market}>
              <h2 className="text-lg font-semibold text-white mb-3 pb-2 border-b border-gray-700">
                {MARKET_LABELS[market] || market}
                <span className="ml-2 text-sm font-normal text-slate-400">
                  ({(marketProps as any[]).length})
                </span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-gray-700">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-800 text-left">
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Player</th>
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">Market</th>
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Line</th>
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Over</th>
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Under</th>
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Edge</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {(marketProps as any[]).map((prop: any, i: number) => (
                      <PropRow key={`${prop.player_name}-${prop.stat_type}-${i}`} prop={prop} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

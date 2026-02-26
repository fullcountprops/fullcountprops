import { createClient } from '@supabase/supabase-js'

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
  pitcher_strikeouts: 'Pitcher Ks',
  pitcher_hits_allowed: 'Hits Allowed',
  pitcher_walks: 'Walks Allowed',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
}

function PropRow({ prop }: { prop: any }) {
  const marketLabel = MARKET_LABELS[prop.market_key] || prop.market_key
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
        <div className="text-xs text-slate-500">{prop.team_abbr || ''}</div>
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
      <td className="py-3 px-4 text-center">
        {prop.grade ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            prop.grade === 'A' ? 'bg-green-900 text-green-300' :
            prop.grade === 'B' ? 'bg-blue-900 text-blue-300' :
            prop.grade === 'C' ? 'bg-yellow-900 text-yellow-300' :
            'bg-gray-700 text-slate-400'
          }`}>
            {prop.grade}
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

  const byMarket = props.reduce((acc: any, prop: any) => {
    const key = prop.market_key || 'other'
    if (!acc[key]) acc[key] = []
    acc[key].push(prop)
    return acc
  }, {})

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Today's Props</h1>
        <p className="text-slate-400">
          {today} &bull; {props.length} lines tracked
        </p>
      </div>

      {props.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-4">📊</div>
          <h2 className="text-xl font-semibold text-slate-300 mb-2">No props data yet</h2>
          <p className="text-slate-500">
            {!supabaseUrl
              ? 'Configure Supabase environment variables to load props.'
              : 'Prop lines are fetched 4x daily starting Opening Day 2026. Check back then!'}
          </p>
          <div className="mt-8 p-4 bg-gray-900 rounded-lg border border-gray-700 max-w-md mx-auto text-sm text-slate-400">
            <p className="font-medium text-slate-300 mb-2">What you'll see here:</p>
            <ul className="space-y-1 text-left">
              <li>• Player prop lines from The Odds API</li>
              <li>• Our model's edge % vs the market</li>
              <li>• Letter grades (A/B/C) for strongest plays</li>
              <li>• Updated 4x daily (8am, 10:30am, 4:30pm ET)</li>
            </ul>
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
                      <th className="py-2 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider text-center">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {(marketProps as any[]).map((prop: any, i: number) => (
                      <PropRow key={`${prop.player_name}-${prop.market_key}-${i}`} prop={prop} />
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

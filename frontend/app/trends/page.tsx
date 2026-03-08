import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import TrendsClient from './TrendsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Player Trends — Rolling Performance Analytics',
  description:
    'Track player performance trends over configurable rolling windows. See AVG, OPS, K%, BB%, HR/FB and more with visual trend indicators.',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getTrendsData() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { players: [], rollingStats: [] }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  // Fetch players with positions and teams
  const { data: players } = await supabase
    .from('players')
    .select('mlbam_id, full_name, team, position')
    .limit(500)

  // Fetch rolling stats — last 60 days
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0]
  const { data: rollingStats } = await supabase
    .from('player_rolling_stats')
    .select('*')
    .gte('stat_date', sixtyDaysAgo)
    .order('stat_date', { ascending: true })
    .limit(5000)

  return {
    players: players || [],
    rollingStats: rollingStats || [],
  }
}

export default async function TrendsPage() {
  const { players, rollingStats } = await getTrendsData()

  const daysUntil = (() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const target = new Date(2026, 2, 26)
    return Math.max(0, Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
  })()
  const isPreSeason = daysUntil > 0

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-blue-950/20 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-blue-500/8 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-10">
          <div className="text-sm text-blue-400 font-medium uppercase tracking-wider mb-2">
            Performance Analytics
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Player Trends
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl leading-relaxed">
            Track rolling performance metrics across configurable windows.
            Spot hot streaks, cold spells, and breakout candidates with visual trend indicators.
          </p>
        </div>
      </section>

      {/* Pre-season banner */}
      {isPreSeason && (
        <div className="max-w-6xl mx-auto px-4 mb-6">
          <div className="flex items-start gap-3 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl">
            <span className="text-yellow-400 text-lg shrink-0">&#9888;</span>
            <div>
              <p className="text-yellow-300 font-medium text-sm">
                Pre-Season &mdash; Opening Day is March 26, 2026 ({daysUntil} days away)
              </p>
              <p className="text-yellow-200/60 text-xs mt-1">
                Trend data will populate once the 2026 MLB season begins and games are played.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Client Component */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        <TrendsClient players={players} rollingStats={rollingStats} />
      </div>
    </div>
  )
}

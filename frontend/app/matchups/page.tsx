import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { Metadata } from 'next'
import MatchupsClient from './MatchupsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Batter vs Pitcher Matchup Tool | FullCountProps',
  description:
    'Select any MLB batter vs any pitcher and see probability distributions for hits, strikeouts, home runs, and walks using our multi-stat projection engine.',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getPlayers() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { batters: [], pitchers: [] }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const { data: players } = await supabase
    .from('players')
    .select('mlbam_id, full_name, team, position')
    .eq('active', true)
    .order('full_name', { ascending: true })
    .limit(3000)

  if (!players || players.length === 0) {
    return { batters: [], pitchers: [] }
  }

  const batters = players
    .filter((p: any) => p.position !== 'P' && p.position !== 'SP' && p.position !== 'RP')
    .map((p: any) => ({
      mlbam_id: p.mlbam_id,
      name: p.full_name,
      team: p.team || '?',
      position: p.position || '?',
    }))

  const pitchers = players
    .filter((p: any) => p.position === 'P' || p.position === 'SP' || p.position === 'RP')
    .map((p: any) => ({
      mlbam_id: p.mlbam_id,
      name: p.full_name,
      team: p.team || '?',
      position: p.position || '?',
    }))

  return { batters, pitchers }
}

export default async function MatchupsPage() {
  const { batters, pitchers } = await getPlayers()

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
          Home
        </Link>
        <span className="text-slate-600 mx-2">/</span>
        <span className="text-sm text-slate-300">Matchup Tool</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Batter vs Pitcher Matchup Tool</h1>
        <p className="text-slate-400">
          Select any batter and pitcher to see projected outcome distributions
          &bull; Powered by the v3.0 multi-stat projection engine
        </p>
      </div>

      {batters.length === 0 && pitchers.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-slate-300 mb-2">Player Data Unavailable</h2>
          <p className="text-slate-500 max-w-md mx-auto">
            {!supabaseUrl
              ? 'Configure Supabase environment variables to load player data.'
              : 'Player roster data will be available once the season pipeline runs.'}
          </p>
          <div className="mt-8 p-4 bg-gray-900 rounded-lg border border-gray-700 max-w-md mx-auto text-sm text-slate-400 text-left">
            <p className="font-medium text-slate-300 mb-2">Matchup tool features:</p>
            <ul className="space-y-1">
              <li>&bull; Select any batter vs any pitcher</li>
              <li>&bull; Poisson probability distributions for Hits, K, HR, BB</li>
              <li>&bull; Cumulative probability table (P(1+), P(2+), P(3+))</li>
              <li>&bull; Total bases and RBI projections</li>
              <li>&bull; Powered by multi-stat LightGBM + Statcast model</li>
            </ul>
          </div>
        </div>
      ) : (
        <MatchupsClient batters={batters} pitchers={pitchers} />
      )}
    </div>
  )
}

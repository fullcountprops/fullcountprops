import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import ProjectionsClient from './ProjectionsClient'

export const metadata: Metadata = {
  title: 'Model Projections — FullCountProps',
  description:
    'Daily MLB player stat projections from the FullCountProps LightGBM model. Pitcher strikeouts, batter total bases, hits, home runs, and more.',
}
import { checkDataFreshness } from '../lib/dataFreshness'
import StaleDataBanner from '../components/StaleDataBanner'

export const dynamic = 'force-dynamic'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getProjections(gameDate?: string) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return []
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = gameDate || new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('projections')
    .select('*')
    .eq('game_date', today)
    .order('confidence', { ascending: false })
    .limit(150)

  if (error) {
    console.error('Error fetching projections:', error)
    return []
  }
  if (!data || data.length === 0) { return [] }

  // Fetch team names from players table via mlbam_id
  const mlbamIds = data.map((p: any) => p.mlbam_id).filter(Boolean)
  if (mlbamIds.length > 0) {
    const { data: players } = await supabase
      .from('players')
      .select('mlbam_id, team')
      .in('mlbam_id', mlbamIds)
    const teamMap: Record<string, string> = {}
    players?.forEach((p: any) => { teamMap[p.mlbam_id] = p.team })
    data.forEach((proj: any) => { proj.team = teamMap[proj.mlbam_id] || null })
  }

  // Fetch today's props to calculate edge %
  const { data: props } = await supabase
    .from('props')
    .select('player_name, market_key, line, over_odds, under_odds, edge_pct')
    .eq('game_date', today)

  // Build a lookup for edge data: player_name + stat_type -> edge info
  if (props && props.length > 0) {
    const STAT_TO_MARKET: Record<string, string> = {
      pitcher_strikeouts: 'pitcher_strikeouts',
      pitcher_walks: 'pitcher_walks',
      batter_total_bases: 'batter_total_bases',
      batter_hits: 'batter_hits',
      batter_home_runs: 'batter_home_runs',
      batter_rbis: 'batter_rbis',
      batter_walks: 'batter_walks',
      batter_strikeouts: 'batter_strikeouts',
      batter_runs: 'batter_runs',
    }
    const edgeMap: Record<string, any> = {}
    for (const prop of props) {
      const key = `${prop.player_name}__${prop.market_key}`
      edgeMap[key] = prop
    }

    // Attach edge data to projections
    for (const proj of data) {
      const marketKey = STAT_TO_MARKET[proj.stat_type] || proj.stat_type
      const edgeKey = `${proj.player_name}__${marketKey}`
      const match = edgeMap[edgeKey]
      if (match) {
        proj._prop_line = match.line
        proj._prop_over_odds = match.over_odds
        proj._prop_under_odds = match.under_odds
        proj._edge_pct = match.edge_pct
        // Calculate our own edge if not pre-computed
        if (proj._edge_pct == null && match.line != null && proj.projection != null) {
          const diff = proj.projection - match.line
          proj._edge_pct = match.line > 0 ? (diff / match.line) * 100 : null
        }
      }
    }
  }

  return data || []
}

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Strikeouts',
  batter_total_bases: 'Total Bases',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_walks: 'Walks',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
  pitcher_hits_allowed: 'Hits Allowed',
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  let color: string
  let tier: string
  if (pct >= 85) {
    color = 'bg-emerald-900 text-emerald-200 border-emerald-600'
    tier = 'ELITE'
  } else if (pct >= 70) {
    color = 'bg-green-900 text-green-300 border-green-700'
    tier = 'HIGH'
  } else if (pct >= 55) {
    color = 'bg-blue-900 text-blue-300 border-blue-700'
    tier = 'MED'
  } else if (pct >= 40) {
    color = 'bg-yellow-900 text-yellow-300 border-yellow-700'
    tier = 'LOW'
  } else {
    color = 'bg-red-900/50 text-red-400 border-red-800'
    tier = 'V.LOW'
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${color}`}>
      {pct}% <span className="opacity-75">{tier}</span>
    </span>
  )
}

function EdgeBadge({ edge }: { edge: number | null }) {
  if (edge == null) return <span className="text-xs text-slate-600">--</span>
  const abs = Math.abs(edge)
  const color =
    edge >= 8 ? 'bg-green-900 text-green-300 border-green-700' :
    edge >= 3 ? 'bg-emerald-900 text-emerald-300 border-emerald-700' :
    edge <= -8 ? 'bg-red-900 text-red-300 border-red-700' :
    edge <= -3 ? 'bg-orange-900 text-orange-300 border-orange-700' :
    'bg-gray-700 text-slate-400 border-gray-600'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${color}`}>
      {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
    </span>
  )
}

function ProjectionCard({ proj }: { proj: any }) {
  const statLabel = STAT_LABELS[proj.stat_type] || proj.stat_type
  const projValue = proj.projection
  const conf = proj.confidence

  let features: any = {}
  try {
    features = typeof proj.features === 'string' ? JSON.parse(proj.features) : (proj.features || {})
  } catch {}

  const hasEdge = proj._edge_pct != null
  const hasLine = proj._prop_line != null

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-500 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <a href={`/players/${proj.mlbam_id}`} className="font-semibold text-white truncate block hover:text-blue-400 transition-colors">
            {proj.player_name}
          </a>
          <div className="text-xs text-slate-500 mt-0.5">
            {proj.team && <span className="mr-1">{proj.team} &bull;</span>}{statLabel}
            {features.venue && <span className="ml-1">&bull; {features.venue}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2">
          {hasEdge && <EdgeBadge edge={proj._edge_pct} />}
          {conf != null && <ConfidenceBadge score={conf} />}
        </div>
      </div>

      <div className="flex items-center justify-center gap-8 mt-3">
        <div className="text-center">
          <div className="text-3xl font-bold text-white">
            {projValue != null ? projValue.toFixed(1) : '--'}
          </div>
          <div className="text-xs text-slate-500 mt-1">Projected</div>
        </div>
        {hasLine && (
          <div className="text-center">
            <div className="text-3xl font-bold text-slate-400">
              {proj._prop_line}
            </div>
            <div className="text-xs text-slate-500 mt-1">Line</div>
          </div>
        )}
      </div>

      {/* Model factors - show v2.0 enhanced data */}
      <div className="mt-3 pt-3 border-t border-gray-700 grid grid-cols-2 gap-2 text-xs">
        {features.blended_k9 && (
          <div>
            <span className="text-slate-500">K/9:</span>
            <span className="text-slate-300 ml-1">{features.blended_k9}</span>
            {features.recent_k9 && (
              <span className="text-slate-600 ml-1">(14d: {features.recent_k9})</span>
            )}
          </div>
        )}
        {features.baseline_k9 && !features.blended_k9 && (
          <div>
            <span className="text-slate-500">K/9:</span>
            <span className="text-slate-300 ml-1">{features.baseline_k9}</span>
          </div>
        )}
        {features.park_adjustment && (
          <div>
            <span className="text-slate-500">Park:</span>
            <span className="text-slate-300 ml-1">{features.park_adjustment}</span>
          </div>
        )}
        {features.expected_innings && (
          <div>
            <span className="text-slate-500">Exp IP:</span>
            <span className="text-slate-300 ml-1">{features.expected_innings}</span>
          </div>
        )}
        {features.opponent && (
          <div>
            <span className="text-slate-500">vs:</span>
            <span className="text-slate-300 ml-1">{features.opponent}</span>
          </div>
        )}
        {features.umpire_name && (
          <div>
            <span className="text-slate-500">Ump:</span>
            <span className="text-slate-300 ml-1">{features.umpire_name}</span>
          </div>
        )}
        {features.opp_k_pct && (
          <div>
            <span className="text-slate-500">Opp K%:</span>
            <span className="text-slate-300 ml-1">{(features.opp_k_pct * 100).toFixed(1)}%</span>
          </div>
        )}
        {features.umpire_factor && features.umpire_factor !== 1.0 && (
          <div>
            <span className="text-slate-500">Ump factor:</span>
            <span className="text-slate-300 ml-1">{features.umpire_factor.toFixed(3)}</span>
          </div>
        )}
        {features.platoon_matchup && features.platoon_matchup !== 'unknown' && (
          <div>
            <span className="text-slate-500">Platoon:</span>
            <span className="text-slate-300 ml-1">{features.platoon_matchup} ({features.platoon_factor}x)</span>
          </div>
        )}
        {features.career_tb_per_pa && (
          <div>
            <span className="text-slate-500">TB/PA:</span>
            <span className="text-slate-300 ml-1">{features.career_tb_per_pa}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default async function ProjectionsPage() {
  const projections = await getProjections()

  const todayET = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const freshnessSupabase = createClient(supabaseUrl, supabaseAnonKey)
  const freshness = await checkDataFreshness(freshnessSupabase, todayET)

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  })

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Model Projections</h1>
        <p className="text-slate-400">
          {today} &bull; v3.0 Multi-Stat Model &bull; {projections.length} projections
        </p>
      </div>

      <StaleDataBanner status={freshness.status} lastUpdated={freshness.lastUpdated} />

      {projections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 px-4">
          <div className="max-w-md text-center">
            <h2 className="text-xl font-semibold text-white mb-3">No projections today</h2>
            <p className="text-slate-400 leading-relaxed mb-8">
              Projections are generated daily during the MLB regular season. Check back on Opening Day.
            </p>
            <a
              href="/methodology"
              className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
            >
              See Our Methodology
            </a>
          </div>
        </div>
      ) : (
        <ProjectionsClient projections={projections} />
      )}
    </div>
  )
}

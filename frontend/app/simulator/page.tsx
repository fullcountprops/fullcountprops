import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'K',
  batter_total_bases: 'TB',
  batter_hits: 'H',
  batter_home_runs: 'HR',
  batter_rbis: 'RBI',
  batter_walks: 'BB',
}

const STAT_FULL_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Strikeouts',
  batter_total_bases: 'Total Bases',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_walks: 'Walks',
}

interface SimResult {
  mlbam_id: number
  player_name: string
  stat_type: string
  sim_mean: number
  sim_median: number
  sim_std: number
  prop_line: number | null
  p_over: number | null
  p_under: number | null
  edge_pct: number | null
  kelly_stake: number | null
  kelly_fraction: number | null
  confidence_tier: string | null
  direction: string | null
  n_simulations: number
  feature_contributions: any
  game_pk: number
}

interface GameData {
  game_pk: number
  game_date: string
  game_time: string | null
  home_team: string
  away_team: string
  venue: string | null
  status: string | null
  home_probable_pitcher: string | null
  away_probable_pitcher: string | null
}

async function getSimulatorData() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { games: [], simByGame: {}, projByGame: {}, hasSimData: false }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = new Date().toISOString().split('T')[0]

  // Fetch games
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('game_date', today)
    .order('game_time', { ascending: true })

  // Try simulation_results first
  const { data: simResults } = await supabase
    .from('simulation_results')
    .select('*')
    .eq('game_date', today)
    .order('edge_pct', { ascending: false })

  // Fallback to projections + props
  let projections: any[] = []
  if (!simResults || simResults.length === 0) {
    const { data: projData } = await supabase
      .from('projections')
      .select('*')
      .eq('game_date', today)
      .order('confidence', { ascending: false })

    const { data: props } = await supabase
      .from('props')
      .select('*')
      .eq('game_date', today)

    projections = projData || []

    if (props && props.length > 0) {
      const propMap: Record<string, any> = {}
      for (const prop of props) {
        propMap[`${prop.player_name}__${prop.stat_type || prop.market_key}`] = prop
      }
      for (const proj of projections) {
        const match = propMap[`${proj.player_name}__${proj.stat_type}`]
        if (match) {
          proj._prop_line = match.line
          proj._over_odds = match.over_odds
          proj._under_odds = match.under_odds
          if (match.line && proj.projection) {
            const diff = proj.projection - match.line
            proj._edge_pct = match.line > 0 ? (diff / match.line) * 100 : 0
            proj._direction = diff > 0 ? 'OVER' : 'UNDER'
          }
        }
      }
    }
  }

  // Group by game
  const simByGame: Record<string, SimResult[]> = {}
  if (simResults) {
    for (const sim of simResults) {
      const gk = sim.game_pk?.toString() || 'unknown'
      if (!simByGame[gk]) simByGame[gk] = []
      simByGame[gk].push(sim)
    }
  }

  const projByGame: Record<string, any[]> = {}
  for (const proj of projections) {
    const gk = proj.game_pk?.toString() || 'unknown'
    if (!projByGame[gk]) projByGame[gk] = []
    projByGame[gk].push(proj)
  }

  return {
    games: games || [],
    simByGame,
    projByGame,
    hasSimData: !!simResults && simResults.length > 0,
  }
}

function ConfidenceTierBadge({ tier }: { tier: string | null }) {
  if (!tier) return <span className="text-xs text-slate-600">--</span>
  const styles: Record<string, string> = {
    A: 'bg-green-900/80 text-green-300 border-green-600',
    B: 'bg-blue-900/80 text-blue-300 border-blue-600',
    C: 'bg-gray-700/80 text-slate-400 border-gray-500',
  }
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md border text-xs font-bold ${styles[tier] || styles.C}`}>
      {tier}
    </span>
  )
}

function EdgeDisplay({ edge }: { edge: number | null }) {
  if (edge == null) return <span className="text-xs text-slate-600">--</span>
  const absEdge = Math.abs(edge)
  const color =
    absEdge >= 5
      ? 'text-green-400'
      : absEdge >= 2
      ? 'text-yellow-400'
      : 'text-slate-500'
  const bg =
    absEdge >= 5
      ? 'bg-green-900/30'
      : absEdge >= 2
      ? 'bg-yellow-900/20'
      : 'bg-gray-800/50'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${color} ${bg}`}>
      {edge > 0 ? '+' : ''}{edge.toFixed(1)}%
    </span>
  )
}

function ProbBar({ pOver, pUnder }: { pOver: number | null; pUnder: number | null }) {
  if (pOver == null || pUnder == null) return null
  const overPct = Math.round(pOver * 100)
  const underPct = Math.round(pUnder * 100)
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-green-400 font-mono w-10 text-right">{overPct}%</span>
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden flex">
        <div
          className="h-full bg-green-500 rounded-l-full"
          style={{ width: `${overPct}%` }}
        />
        <div
          className="h-full bg-red-500 rounded-r-full"
          style={{ width: `${underPct}%` }}
        />
      </div>
      <span className="text-red-400 font-mono w-10">{underPct}%</span>
    </div>
  )
}

function SimPlayerRow({ sim, isSimData }: { sim: any; isSimData: boolean }) {
  const statLabel = STAT_LABELS[sim.stat_type] || sim.stat_type
  const edge = isSimData ? sim.edge_pct : sim._edge_pct
  const propLine = isSimData ? sim.prop_line : sim._prop_line
  const pOver = isSimData ? sim.p_over : null
  const pUnder = isSimData ? sim.p_under : null
  const direction = isSimData ? sim.direction : sim._direction
  const kellyStake = isSimData ? sim.kelly_stake : null
  const tier = isSimData ? sim.confidence_tier : (
    sim.confidence >= 0.75 ? 'A' : sim.confidence >= 0.60 ? 'B' : 'C'
  )
  const projection = isSimData ? sim.sim_mean : sim.projection

  return (
    <div className="grid grid-cols-12 gap-2 items-center py-2.5 px-3 border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors text-sm">
      {/* Player + Stat */}
      <div className="col-span-3 min-w-0">
        <div className="font-medium text-white truncate">{sim.player_name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-gray-800 px-1.5 py-0.5 rounded">
            {statLabel}
          </span>
          {direction && (
            <span className={`text-[10px] font-bold ${direction === 'OVER' ? 'text-green-400' : 'text-red-400'}`}>
              {direction}
            </span>
          )}
        </div>
      </div>

      {/* Line */}
      <div className="col-span-1 text-center">
        <span className="text-slate-400 font-mono text-xs">
          {propLine != null ? propLine : '--'}
        </span>
      </div>

      {/* Projected / Sim Mean */}
      <div className="col-span-1 text-center">
        <span className="text-white font-bold font-mono">
          {projection != null ? Number(projection).toFixed(1) : '--'}
        </span>
      </div>

      {/* P(over) / P(under) bar */}
      <div className="col-span-3">
        {pOver != null && pUnder != null ? (
          <ProbBar pOver={pOver} pUnder={pUnder} />
        ) : (
          <span className="text-xs text-slate-600 block text-center">--</span>
        )}
      </div>

      {/* Edge */}
      <div className="col-span-2 text-center">
        <EdgeDisplay edge={edge != null ? Number(edge) : null} />
      </div>

      {/* Kelly */}
      <div className="col-span-1 text-center">
        <span className="text-xs text-slate-400 font-mono">
          {kellyStake != null ? `$${Number(kellyStake).toFixed(0)}` : '--'}
        </span>
      </div>

      {/* Tier */}
      <div className="col-span-1 flex justify-center">
        <ConfidenceTierBadge tier={tier} />
      </div>
    </div>
  )
}

function GameSimCard({
  game,
  sims,
  projs,
  hasSimData,
}: {
  game: GameData
  sims: SimResult[]
  projs: any[]
  hasSimData: boolean
}) {
  const gameTime = game.game_time
    ? new Date(`2000-01-01T${game.game_time}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
      }) + ' ET'
    : 'TBD'

  const players = hasSimData ? sims : projs
  const edgePlayers = players.filter((p: any) => {
    const e = hasSimData ? p.edge_pct : p._edge_pct
    return e != null && Math.abs(e) >= 2
  })

  return (
    <div className="bg-gray-900/60 border border-gray-800 rounded-xl overflow-hidden backdrop-blur-sm">
      {/* Game header */}
      <Link
        href={`/simulator/${game.game_pk}`}
        className="block hover:bg-gray-800/40 transition-colors"
      >
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-white">{game.away_team}</span>
              <span className="text-xs text-slate-600">@</span>
              <span className="text-base font-bold text-white">{game.home_team}</span>
            </div>
            {edgePlayers.length > 0 && (
              <span className="text-[10px] bg-green-900/50 text-green-400 border border-green-800/50 px-1.5 py-0.5 rounded-full font-medium">
                {edgePlayers.length} edge{edgePlayers.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>{gameTime}</span>
            <span className="text-slate-700">&bull;</span>
            <span className="truncate max-w-[140px]">{game.venue || 'TBD'}</span>
          </div>
        </div>

        {/* Starting pitchers */}
        {(game.away_probable_pitcher || game.home_probable_pitcher) && (
          <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between text-xs text-slate-400">
            <span>{game.away_probable_pitcher || 'SP TBD'}</span>
            <span className="text-slate-700">vs</span>
            <span>{game.home_probable_pitcher || 'SP TBD'}</span>
          </div>
        )}
      </Link>

      {/* Player sim results */}
      {players.length > 0 ? (
        <div>
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 items-center py-2 px-3 text-[10px] uppercase tracking-wider text-slate-600 font-semibold border-b border-gray-800/30">
            <div className="col-span-3">Player</div>
            <div className="col-span-1 text-center">Line</div>
            <div className="col-span-1 text-center">Sim</div>
            <div className="col-span-3 text-center">P(over) / P(under)</div>
            <div className="col-span-2 text-center">Edge</div>
            <div className="col-span-1 text-center">Kelly</div>
            <div className="col-span-1 text-center">Tier</div>
          </div>
          {players
            .sort((a: any, b: any) => {
              const eA = Math.abs(hasSimData ? (a.edge_pct || 0) : (a._edge_pct || 0))
              const eB = Math.abs(hasSimData ? (b.edge_pct || 0) : (b._edge_pct || 0))
              return eB - eA
            })
            .map((player: any, i: number) => (
              <SimPlayerRow
                key={`${player.player_name}-${player.stat_type}-${i}`}
                sim={player}
                isSimData={hasSimData}
              />
            ))}
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-slate-600">
          No simulation data for this game
        </div>
      )}
    </div>
  )
}

export default async function SimulatorPage() {
  const { games, simByGame, projByGame, hasSimData } = await getSimulatorData()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })

  // Count totals
  const allSims = Object.values(simByGame).flat()
  const allProjs = Object.values(projByGame).flat()
  const allPlayers = hasSimData ? allSims : allProjs
  const edgeCount = allPlayers.filter((p: any) => {
    const e = hasSimData ? p.edge_pct : p._edge_pct
    return e != null && Math.abs(e) >= 5
  }).length

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-3xl font-bold text-white">Monte Carlo Simulator</h1>
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-purple-900/50 text-purple-300 border border-purple-700/50 rounded-full">
            {hasSimData ? 'LIVE' : 'PREVIEW'}
          </span>
        </div>
        <p className="text-slate-400 text-sm">
          {today} &bull;{' '}
          {hasSimData
            ? `${allSims.length} simulated props across ${games.length} games`
            : `${allProjs.length} projections across ${games.length} games`}
          {edgeCount > 0 && (
            <span className="text-green-400 ml-1">
              &bull; {edgeCount} high-edge props
            </span>
          )}
        </p>
        <p className="text-xs text-slate-600 mt-1">
          {hasSimData
            ? '5,000 game simulations per matchup. Each at-bat resolved against pitcher/batter probability distributions.'
            : 'Monte Carlo simulation data populates once the engine is running. Showing point-estimate projections as preview.'}
        </p>
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Games</div>
          <div className="text-2xl font-bold text-white">{games.length}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Props Analyzed</div>
          <div className="text-2xl font-bold text-white">{allPlayers.length}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Edge Props</div>
          <div className="text-2xl font-bold text-green-400">{edgeCount}</div>
        </div>
        <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Simulations</div>
          <div className="text-2xl font-bold text-purple-400">
            {hasSimData ? `${(games.length * 5000).toLocaleString()}` : '--'}
          </div>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="flex items-center gap-4 mb-6 border-b border-gray-800 pb-3">
        <span className="text-sm font-semibold text-white border-b-2 border-blue-500 pb-3 -mb-3">
          Today&apos;s Slate
        </span>
        <Link
          href="/simulator/backtest"
          className="text-sm text-slate-500 hover:text-white transition-colors pb-3 -mb-3"
        >
          Backtest Results
        </Link>
      </div>

      {/* Games */}
      {games.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4 opacity-50">&#x1F3B0;</div>
          <h2 className="text-xl font-semibold text-slate-300 mb-2">No games on today&apos;s slate</h2>
          <p className="text-slate-500 max-w-md mx-auto text-sm">
            {!supabaseUrl
              ? 'Configure Supabase environment variables to load simulation data.'
              : 'The Monte Carlo simulator runs daily starting Opening Day 2026. Each game is simulated 5,000 times to produce full probability distributions for every player prop.'}
          </p>
          <div className="mt-8 p-4 bg-gray-900/60 rounded-xl border border-gray-800 max-w-lg mx-auto text-sm text-left">
            <p className="font-medium text-slate-300 mb-3">How it works:</p>
            <ul className="space-y-2 text-slate-500 text-xs">
              <li className="flex gap-2">
                <span className="text-purple-400 font-bold">1.</span>
                <span>Matchup model predicts per-AB outcome probabilities using Statcast, platoon splits, recent form, umpire/catcher factors</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400 font-bold">2.</span>
                <span>Full game simulation resolves every at-bat: lineup order, pitch counts, bullpen changes, runner advancement</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400 font-bold">3.</span>
                <span>5,000 iterations per game produce probability distributions for K, H, TB, HR</span>
              </li>
              <li className="flex gap-2">
                <span className="text-purple-400 font-bold">4.</span>
                <span>Distributions compared to sportsbook lines for P(over), P(under), and edge detection with Kelly sizing</span>
              </li>
            </ul>
          </div>
          <Link
            href="/simulator/backtest"
            className="inline-block mt-6 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-slate-300 hover:text-white hover:border-gray-500 transition-colors"
          >
            View Backtest Results &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {games.map((game: GameData) => {
            const gk = game.game_pk.toString()
            return (
              <GameSimCard
                key={game.game_pk}
                game={game}
                sims={simByGame[gk] || []}
                projs={projByGame[gk] || []}
                hasSimData={hasSimData}
              />
            )
          })}
        </div>
      )}

      {/* Edge legend */}
      <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-wider">Edge color:</span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span>&gt;5% (strong)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-yellow-500" />
          <span>2-5% (moderate)</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-gray-600" />
          <span>&lt;2% (weak)</span>
        </span>
        <span className="text-slate-700 ml-2">|</span>
        <span className="font-semibold uppercase tracking-wider">Tiers:</span>
        <span>A = high conf + data</span>
        <span>B = medium</span>
        <span>C = low/limited data</span>
      </div>
    </div>
  )
}

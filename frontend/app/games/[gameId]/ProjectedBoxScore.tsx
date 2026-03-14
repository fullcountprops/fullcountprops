'use client'

import Link from 'next/link'

interface ProjectedBoxScoreProps {
  game: any
  lineups: any[]
  projections: any[]
  props: any[]
}

const BATTER_STAT_COLS = [
  { key: 'batter_total_bases', label: 'TB', short: 'TB' },
  { key: 'batter_hits', label: 'Hits', short: 'H' },
  { key: 'batter_home_runs', label: 'HR', short: 'HR' },
  { key: 'batter_rbis', label: 'RBI', short: 'RBI' },
  { key: 'batter_walks', label: 'BB', short: 'BB' },
  { key: 'batter_strikeouts', label: 'K', short: 'K' },
  { key: 'batter_runs', label: 'R', short: 'R' },
]

const PITCHER_STAT_COLS = [
  { key: 'pitcher_strikeouts', label: 'Strikeouts', short: 'K' },
  { key: 'pitcher_walks', label: 'Walks', short: 'BB' },
    { key: 'pitcher_innings', label: 'Innings', short: 'IP' },
  { key: 'pitcher_hits_allowed', label: 'Hits Allowed', short: 'H' },
  { key: 'pitcher_home_runs', label: 'Home Runs', short: 'HR' },
  { key: 'pitcher_earned_runs', label: 'Earned Runs', short: 'ER' },
  { key: 'pitcher_runs', label: 'Runs', short: 'R' },
]

// Heat map: green for good, red for bad, relative to the range
function heatColor(value: number | null, min: number, max: number, invert = false): string {
  if (value == null || min === max) return ''
  const pct = (value - min) / (max - min)
  const adjusted = invert ? 1 - pct : pct
  if (adjusted >= 0.75) return 'bg-green-900/40 text-green-300'
  if (adjusted >= 0.5) return 'bg-green-900/20 text-green-400'
  if (adjusted <= 0.15) return 'bg-red-900/30 text-red-400'
  if (adjusted <= 0.30) return 'bg-red-900/15 text-red-300'
  return ''
}

function LineupTable({
  title,
  teamAbbr,
  batters,
  projMap,
  propMap,
  statRanges,
}: {
  title: string
  teamAbbr: string
  batters: any[]
  projMap: Record<string, Record<string, any>>
  propMap: Record<string, Record<string, any>>
  statRanges: Record<string, { min: number; max: number }>
}) {
  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-700 text-xs font-bold text-slate-300">
          {teamAbbr}
        </span>
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-800 text-left">
              <th className="py-2 px-3 text-xs font-medium text-slate-400 w-8">#</th>
              <th className="py-2 px-3 text-xs font-medium text-slate-400">Player</th>
              <th className="py-2 px-3 text-xs font-medium text-slate-400 text-center">Pos</th>
              <th className="py-2 px-3 text-xs font-medium text-slate-400 text-center">Bats</th>
              {BATTER_STAT_COLS.map(col => (
                <th key={col.key} className="py-2 px-3 text-xs font-medium text-slate-400 text-center" title={col.label}>
                  {col.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {batters.map((batter, i) => {
              const playerId = String(batter.mlbam_id)
              const playerProjs = projMap[playerId] || {}
              const playerProps = propMap[(batter.full_name || '').toLowerCase()] || {}

              return (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="py-2 px-3 text-xs text-slate-500 font-mono">{batter.batting_order || i + 1}</td>
                  <td className="py-2 px-3">
                    <Link
                      href={`/players/${batter.mlbam_id}`}
                      className="text-sm text-white hover:text-blue-400 transition-colors font-medium"
                    >
                      {batter.full_name}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-center text-xs text-slate-400">{batter.position}</td>
                  <td className="py-2 px-3 text-center text-xs text-slate-400">{batter.bats || '--'}</td>
                  {BATTER_STAT_COLS.map(col => {
                    const proj = playerProjs[col.key]
                    const propData = playerProps[col.key]
                    const value = proj?.projection ?? null
                    const range = statRanges[col.key] || { min: 0, max: 1 }
                    const isK = col.key === 'batter_strikeouts'
                    const cellColor = heatColor(value, range.min, range.max, isK)

                    return (
                      <td
                        key={col.key}
                        className={`py-2 px-3 text-center text-sm font-mono ${cellColor}`}
                        title={propData ? `Line: ${propData.line}` : undefined}
                      >
                        {value != null ? (
                          <span className="relative group cursor-default">
                            {value.toFixed(1)}
                            {propData && propData.line != null && (
                              <span className="absolute -top-1 -right-2 text-[10px] text-slate-500">
                                {value > propData.line ? '>' : '<'}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-700">--</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PitcherCard({
  label,
  pitcherName,
  pitcherId,
  projections,
}: {
  label: string
  pitcherName: string | null
  pitcherId: number | null
  projections: Record<string, any>
}) {
  if (!pitcherName) return null

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">{label}</div>
      <div className="flex items-center justify-between">
        <div>
          {pitcherId ? (
            <Link href={`/players/${pitcherId}`} className="text-white font-semibold hover:text-blue-400 transition-colors">
              {pitcherName}
            </Link>
          ) : (
            <span className="text-white font-semibold">{pitcherName}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {PITCHER_STAT_COLS.map(col => {
            const proj = projections[col.key]
            return proj ? (
              <div key={col.key} className="text-center">
                <div className="text-lg font-bold text-white">{proj.projection?.toFixed(1)}</div>
                <div className="text-[10px] text-slate-500">{col.short}</div>
              </div>
            ) : null
          })}
          {projections['pitcher_strikeouts']?.confidence != null && (
            <div className="text-center">
              <div className={`text-lg font-bold ${
                projections['pitcher_strikeouts'].confidence >= 0.7 ? 'text-green-400' :
                projections['pitcher_strikeouts'].confidence >= 0.5 ? 'text-blue-400' :
                'text-yellow-400'
              }`}>
                {Math.round(projections['pitcher_strikeouts'].confidence * 100)}%
              </div>
              <div className="text-[10px] text-slate-500">Conf</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProjectedBoxScore({
  game,
  lineups,
  projections,
  props,
}: ProjectedBoxScoreProps) {
  // Build projection lookup: mlbam_id -> { stat_type -> projection }
  const projMap: Record<string, Record<string, any>> = {}
  for (const proj of projections) {
    const key = String(proj.mlbam_id)
    if (!projMap[key]) projMap[key] = {}
    projMap[key][proj.stat_type] = proj
  }

  // Build props lookup: player_name (lowercase) -> { stat_type -> prop }
  const propMap: Record<string, Record<string, any>> = {}
  for (const prop of props) {
    const name = (prop.player_name || '').toLowerCase()
    if (!propMap[name]) propMap[name] = {}
    const statType = prop.market_key || prop.stat_type
    propMap[name][statType] = prop
  }

  // Split lineups by side
  const homeBatters = lineups.filter(l => l.side === 'home').sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))
  const awayBatters = lineups.filter(l => l.side === 'away').sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))

  // Compute stat ranges for heat mapping
  const allBatterIds = lineups.map(l => String(l.mlbam_id))
  const statRanges: Record<string, { min: number; max: number }> = {}
  for (const col of BATTER_STAT_COLS) {
    const values = allBatterIds
      .map(id => projMap[id]?.[col.key]?.projection)
      .filter((v): v is number => v != null)
    if (values.length > 0) {
      statRanges[col.key] = { min: Math.min(...values), max: Math.max(...values) }
    }
  }

  // Build pitcher projection maps
  const homePitcherProjs: Record<string, any> = {}
  const awayPitcherProjs: Record<string, any> = {}
  if (game.home_probable_pitcher_id) {
    const key = String(game.home_probable_pitcher_id)
    if (projMap[key]) {
      Object.assign(homePitcherProjs, projMap[key])
    }
  }
  if (game.away_probable_pitcher_id) {
    const key = String(game.away_probable_pitcher_id)
    if (projMap[key]) {
      Object.assign(awayPitcherProjs, projMap[key])
    }
  }

  const hasLineups = homeBatters.length > 0 || awayBatters.length > 0

  return (
    <div>
      {/* Section Header */}
      <h2 className="text-xl font-semibold text-white mb-6 pb-2 border-b border-gray-700">
        Projected Box Score
        {!hasLineups && (
          <span className="ml-2 text-sm font-normal text-yellow-400">
            Lineups not yet confirmed
          </span>
        )}
      </h2>

      {/* Pitcher Matchup Cards */}
      <div className="grid gap-4 sm:grid-cols-2 mb-8">
        <PitcherCard
          label={`${game.away_team} Starter`}
          pitcherName={game.away_probable_pitcher}
          pitcherId={game.away_probable_pitcher_id}
          projections={awayPitcherProjs}
        />
        <PitcherCard
          label={`${game.home_team} Starter`}
          pitcherName={game.home_probable_pitcher}
          pitcherId={game.home_probable_pitcher_id}
          projections={homePitcherProjs}
        />
      </div>

      {hasLineups ? (
        <>
          {/* Away Team Lineup */}
          {awayBatters.length > 0 && (
            <LineupTable
              title={`${game.away_team} Batting Order`}
              teamAbbr={game.away_team?.slice(0, 3).toUpperCase() || 'AWY'}
              batters={awayBatters}
              projMap={projMap}
              propMap={propMap}
              statRanges={statRanges}
            />
          )}

          {/* Home Team Lineup */}
          {homeBatters.length > 0 && (
            <LineupTable
              title={`${game.home_team} Batting Order`}
              teamAbbr={game.home_team?.slice(0, 3).toUpperCase() || 'HME'}
              batters={homeBatters}
              projMap={projMap}
              propMap={propMap}
              statRanges={statRanges}
            />
          )}
        </>
      ) : (
        <div className="text-center py-12 bg-gray-800/50 rounded-lg border border-gray-700">
          <div className="text-3xl mb-3">📋</div>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">Lineups Pending</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">
            Projected box scores populate once batting orders are confirmed, typically 1-3 hours before first pitch.
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 p-4 bg-gray-900/50 rounded-lg border border-gray-800 text-xs text-slate-500">
        <p className="font-medium text-slate-400 mb-1">Reading the box score:</p>
        <ul className="space-y-0.5">
          <li><span className="inline-block w-3 h-3 rounded bg-green-900/40 mr-1"></span> Green = above-average projection for this game</li>
          <li><span className="inline-block w-3 h-3 rounded bg-red-900/30 mr-1"></span> Red = below-average projection for this game</li>
          <li>&bull; Click any player name to see their full profile, matchup data, and trends</li>
          <li>&bull; <span className="text-slate-400">&gt;</span> or <span className="text-slate-400">&lt;</span> indicator shows if projection is above/below the sportsbook line</li>
        </ul>
      </div>
    </div>
  )
}

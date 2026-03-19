'use client'

import { useState } from 'react'

/* ── Types ──────────────────────────────────────────────────────── */

interface BatterMatchup {
  mlbam_id: number
  full_name: string
  batting_order: number
  proj_hits: number
  proj_strikeouts: number
  proj_total_bases: number
  proj_home_runs: number
  proj_walks: number
  proj_rbis: number
}

interface PitcherGame {
  game_pk: number
  game_date: string
  game_time: string | null
  venue: string | null
  pitcher_name: string
  pitcher_mlbam_id: number | null
  pitcher_team: string
  opponent_team: string
  side: 'home' | 'away'
  proj_strikeouts: number | null
  proj_walks: number | null
  proj_earned_runs: number | null
  proj_outs: number | null
  proj_hits_allowed: number | null
  confidence: number | null
  batters: BatterMatchup[]
}

interface PitcherPreviewClientProps {
  games: PitcherGame[]
  gameDate: string
}

/* ── Helpers ─────────────────────────────────────────────────── */

function getGrade(projected: number, avgLine: number): { letter: string; color: string } {
  if (avgLine === 0) return { letter: '--', color: 'text-slate-500' }
  const ratio = projected / avgLine
  if (ratio >= 1.4) return { letter: 'A+', color: 'text-green-400' }
  if (ratio >= 1.2) return { letter: 'A', color: 'text-green-400' }
  if (ratio >= 1.05) return { letter: 'B', color: 'text-emerald-400' }
  if (ratio >= 0.95) return { letter: 'C', color: 'text-yellow-400' }
  if (ratio >= 0.8) return { letter: 'D', color: 'text-orange-400' }
  return { letter: 'F', color: 'text-red-400' }
}

function getKGrade(projK: number | null): { letter: string; color: string } {
  if (projK == null) return { letter: '--', color: 'text-slate-500' }
  if (projK >= 8) return { letter: 'A+', color: 'text-green-400' }
  if (projK >= 7) return { letter: 'A', color: 'text-green-400' }
  if (projK >= 6) return { letter: 'B', color: 'text-emerald-400' }
  if (projK >= 5) return { letter: 'C', color: 'text-yellow-400' }
  if (projK >= 4) return { letter: 'D', color: 'text-orange-400' }
  return { letter: 'F', color: 'text-red-400' }
}

function getWHIPGrade(whip: number | null): { letter: string; color: string } {
  if (whip == null) return { letter: '--', color: 'text-slate-500' }
  // Lower is better for WHIP
  if (whip <= 0.95) return { letter: 'A+', color: 'text-green-400' }
  if (whip <= 1.1) return { letter: 'A', color: 'text-green-400' }
  if (whip <= 1.25) return { letter: 'B', color: 'text-emerald-400' }
  if (whip <= 1.4) return { letter: 'C', color: 'text-yellow-400' }
  if (whip <= 1.6) return { letter: 'D', color: 'text-orange-400' }
  return { letter: 'F', color: 'text-red-400' }
}

function getWinProbGrade(winProb: number): { letter: string; color: string } {
  if (winProb >= 0.65) return { letter: 'A', color: 'text-green-400' }
  if (winProb >= 0.55) return { letter: 'B', color: 'text-emerald-400' }
  if (winProb >= 0.45) return { letter: 'C', color: 'text-yellow-400' }
  if (winProb >= 0.35) return { letter: 'D', color: 'text-orange-400' }
  return { letter: 'F', color: 'text-red-400' }
}

function getBatterGrade(stat: number, thresholds: [number, number, number, number, number]): { letter: string; color: string } {
  const [ap, a, b, c, d] = thresholds
  if (stat >= ap) return { letter: 'A+', color: 'text-green-400' }
  if (stat >= a) return { letter: 'A', color: 'text-green-400' }
  if (stat >= b) return { letter: 'B', color: 'text-emerald-400' }
  if (stat >= c) return { letter: 'C', color: 'text-yellow-400' }
  if (stat >= d) return { letter: 'D', color: 'text-orange-400' }
  return { letter: 'F', color: 'text-red-400' }
}

function estimateWHIP(game: PitcherGame): number | null {
  const ip = game.proj_outs != null ? game.proj_outs / 3 : null
  const ha = game.proj_hits_allowed
  const bb = game.proj_walks
  if (ip == null || ip === 0 || ha == null || bb == null) return null
  return (ha + bb) / ip
}

function estimateWinProb(game: PitcherGame): number {
  // Simple estimate: lower ERA-like and higher K → higher win prob
  const k = game.proj_strikeouts ?? 5
  const er = game.proj_earned_runs ?? 3.5
  // Logistic-ish estimate centered at ~50%
  const signal = (k - 5) * 0.04 + (3.5 - er) * 0.08
  return Math.max(0.2, Math.min(0.8, 0.5 + signal))
}

/* ── Components ──────────────────────────────────────────────── */

function PitcherCard({ game }: { game: PitcherGame }) {
  const [expanded, setExpanded] = useState(false)

  const whip = estimateWHIP(game)
  const winProb = estimateWinProb(game)
  const kGrade = getKGrade(game.proj_strikeouts)
  const whipGrade = getWHIPGrade(whip)
  const winGrade = getWinProbGrade(winProb)

  const gameTime = game.game_time
    ? new Date(`2000-01-01T${game.game_time}`).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      }) + ' ET'
    : 'TBD'

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <a
              href={game.pitcher_mlbam_id ? `/players/${game.pitcher_mlbam_id}` : '#'}
              className="text-lg font-semibold text-white hover:text-blue-400 transition-colors"
            >
              {game.pitcher_name}
            </a>
            <div className="text-xs text-slate-500 mt-0.5">
              {game.pitcher_team} {game.side === 'home' ? 'vs' : '@'} {game.opponent_team}
              {game.venue && <> &bull; {game.venue}</>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">{gameTime}</div>
            {game.confidence != null && (
              <div className="text-xs text-slate-500 mt-0.5">
                Conf: {Math.round(game.confidence * 100)}%
              </div>
            )}
          </div>
        </div>

        {/* Summary Grades */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="text-center p-2 bg-gray-900/60 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">Proj K</div>
            <div className="text-xl font-bold text-white">
              {game.proj_strikeouts?.toFixed(1) ?? '--'}
            </div>
            <div className={`text-xs font-semibold mt-0.5 ${kGrade.color}`}>
              {kGrade.letter}
            </div>
          </div>
          <div className="text-center p-2 bg-gray-900/60 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">WHIP</div>
            <div className="text-xl font-bold text-white">
              {whip?.toFixed(2) ?? '--'}
            </div>
            <div className={`text-xs font-semibold mt-0.5 ${whipGrade.color}`}>
              {whipGrade.letter}
            </div>
          </div>
          <div className="text-center p-2 bg-gray-900/60 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">Proj ER</div>
            <div className="text-xl font-bold text-white">
              {game.proj_earned_runs?.toFixed(1) ?? '--'}
            </div>
            <div className={`text-xs font-semibold mt-0.5 ${getGrade(3.5, game.proj_earned_runs ?? 3.5).color}`}>
              {game.proj_earned_runs != null
                ? getGrade(3.5, game.proj_earned_runs).letter
                : '--'}
            </div>
          </div>
          <div className="text-center p-2 bg-gray-900/60 rounded-lg">
            <div className="text-xs text-slate-500 mb-1">Win %</div>
            <div className="text-xl font-bold text-white">
              {(winProb * 100).toFixed(0)}%
            </div>
            <div className={`text-xs font-semibold mt-0.5 ${winGrade.color}`}>
              {winGrade.letter}
            </div>
          </div>
        </div>

        {/* Expand / Collapse */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-4 w-full text-center text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          {expanded ? 'Hide Matchup Details' : `Show Matchup Grades (${game.batters.length} batters)`}
        </button>
      </div>

      {/* Expanded Batter Matchups */}
      {expanded && game.batters.length > 0 && (
        <div className="border-t border-gray-700">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-900 text-left">
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 w-8">#</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500">Batter</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">Hits</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">K</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">TB</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">HR</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">BB</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">RBI</th>
                  <th className="py-2 px-3 text-xs font-medium text-slate-500 text-center">Grade</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {game.batters
                  .sort((a, b) => a.batting_order - b.batting_order)
                  .map((batter) => {
                    // Composite grade: weighted average of individual stat grades
                    const hitGrade = getBatterGrade(batter.proj_hits, [1.8, 1.4, 1.0, 0.7, 0.4])
                    const kGradeB = getBatterGrade(batter.proj_strikeouts, [1.8, 1.4, 1.0, 0.7, 0.4])
                    const tbGrade = getBatterGrade(batter.proj_total_bases, [3.0, 2.2, 1.5, 1.0, 0.5])
                    const hrGrade = getBatterGrade(batter.proj_home_runs, [0.5, 0.35, 0.2, 0.1, 0.05])

                    // Overall composite: higher hits/TB/HR and lower K is better
                    const composite = batter.proj_hits * 0.3 + batter.proj_total_bases * 0.25 +
                      batter.proj_home_runs * 2 + batter.proj_rbis * 0.2 -
                      batter.proj_strikeouts * 0.15
                    const overallGrade = getBatterGrade(composite, [2.0, 1.5, 1.0, 0.5, 0.2])

                    return (
                      <tr key={batter.mlbam_id} className="hover:bg-gray-800/50">
                        <td className="py-2 px-3 text-xs text-slate-500 font-mono">
                          {batter.batting_order}
                        </td>
                        <td className="py-2 px-3">
                          <a
                            href={`/players/${batter.mlbam_id}`}
                            className="text-sm text-white hover:text-blue-400 transition-colors"
                          >
                            {batter.full_name}
                          </a>
                        </td>
                        <td className={`py-2 px-3 text-center text-sm font-mono ${hitGrade.color}`}>
                          {batter.proj_hits.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 text-center text-sm font-mono ${kGradeB.color}`}>
                          {batter.proj_strikeouts.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 text-center text-sm font-mono ${tbGrade.color}`}>
                          {batter.proj_total_bases.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 text-center text-sm font-mono ${hrGrade.color}`}>
                          {batter.proj_home_runs.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-center text-sm font-mono text-slate-300">
                          {batter.proj_walks.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-center text-sm font-mono text-slate-300">
                          {batter.proj_rbis.toFixed(2)}
                        </td>
                        <td className={`py-2 px-3 text-center text-sm font-bold ${overallGrade.color}`}>
                          {overallGrade.letter}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 bg-gray-900/50 text-xs text-slate-600">
            Grades based on projected per-game stat rates vs league-average thresholds.
          </div>
        </div>
      )}

      {expanded && game.batters.length === 0 && (
        <div className="border-t border-gray-700 p-4 text-center text-sm text-slate-500">
          Lineup not yet available for this game.
        </div>
      )}
    </div>
  )
}

/* ── Main Client ─────────────────────────────────────────────── */

export default function PitcherPreviewClient({ games, gameDate }: PitcherPreviewClientProps) {
  const [filter, setFilter] = useState<'all' | 'high-k' | 'low-whip'>('all')

  const filtered = games.filter((g) => {
    if (filter === 'high-k') return (g.proj_strikeouts ?? 0) >= 6
    if (filter === 'low-whip') {
      const whip = estimateWHIP(g)
      return whip != null && whip <= 1.2
    }
    return true
  })

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {[
          { id: 'all' as const, label: 'All Starters' },
          { id: 'high-k' as const, label: 'High K (6+)' },
          { id: 'low-whip' as const, label: 'Low WHIP (< 1.20)' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
              filter === f.id
                ? 'bg-green-600 text-white'
                : 'bg-gray-800 text-slate-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-sm text-slate-500 mb-4">
        Showing {filtered.length} of {games.length} starting pitchers
      </p>

      {/* Pitcher Cards */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No pitchers match the selected filter.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((game) => (
            <PitcherCard key={`${game.game_pk}-${game.pitcher_mlbam_id}`} game={game} />
          ))}
        </div>
      )}
    </div>
  )
}

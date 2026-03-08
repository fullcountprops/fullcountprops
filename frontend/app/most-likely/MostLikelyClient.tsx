'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

interface MostLikelyClientProps {
  projections: any[]
  props: any[]
}

const STAT_CONFIGS: {
  key: string
  label: string
  shortLabel: string
  thresholds: { label: string; k: number }[]
  color: string
}[] = [
  {
    key: 'batter_home_runs',
    label: 'Home Runs',
    shortLabel: 'HR',
    thresholds: [{ label: '1+ HR', k: 1 }],
    color: 'text-red-400',
  },
  {
    key: 'batter_hits',
    label: 'Hits',
    shortLabel: 'H',
    thresholds: [
      { label: '1+ Hit', k: 1 },
      { label: '2+ Hits', k: 2 },
    ],
    color: 'text-blue-400',
  },
  {
    key: 'pitcher_strikeouts',
    label: 'Strikeouts',
    shortLabel: 'K',
    thresholds: [
      { label: '5+ K', k: 5 },
      { label: '7+ K', k: 7 },
    ],
    color: 'text-purple-400',
  },
  {
    key: 'batter_total_bases',
    label: 'Total Bases',
    shortLabel: 'TB',
    thresholds: [
      { label: '2+ TB', k: 2 },
      { label: '3+ TB', k: 3 },
    ],
    color: 'text-emerald-400',
  },
  {
    key: 'batter_rbis',
    label: 'RBIs',
    shortLabel: 'RBI',
    thresholds: [{ label: '1+ RBI', k: 1 }],
    color: 'text-amber-400',
  },
  {
    key: 'batter_walks',
    label: 'Walks',
    shortLabel: 'BB',
    thresholds: [{ label: '1+ BB', k: 1 }],
    color: 'text-cyan-400',
  },
  {
    key: 'batter_runs',
    label: 'Runs',
    shortLabel: 'R',
    thresholds: [{ label: '1+ R', k: 1 }],
    color: 'text-green-400',
  },
]

// Poisson P(X >= k)
function poissonAtLeast(lambda: number, k: number): number {
  if (lambda <= 0) return 0
  let cdf = 0
  for (let i = 0; i < k; i++) {
    cdf += (Math.pow(lambda, i) * Math.exp(-lambda)) / factorial(i)
  }
  return Math.max(0, Math.min(1, 1 - cdf))
}

function factorial(n: number): number {
  if (n <= 1) return 1
  let result = 1
  for (let i = 2; i <= n; i++) result *= i
  return result
}

function probBgColor(p: number): string {
  if (p >= 0.75) return 'bg-green-900/40 border-green-700/50'
  if (p >= 0.6) return 'bg-emerald-900/30 border-emerald-700/40'
  if (p >= 0.45) return 'bg-blue-900/30 border-blue-700/40'
  if (p >= 0.3) return 'bg-yellow-900/20 border-yellow-700/30'
  return 'bg-slate-800/50 border-slate-700/50'
}

function probTextColor(p: number): string {
  if (p >= 0.75) return 'text-green-400'
  if (p >= 0.6) return 'text-emerald-400'
  if (p >= 0.45) return 'text-blue-400'
  if (p >= 0.3) return 'text-yellow-400'
  return 'text-slate-500'
}

// Build a prop lookup: "playerName_lower|stat_type" -> prop
function buildPropMap(props: any[]): Record<string, any> {
  const map: Record<string, any> = {}
  for (const p of props) {
    const name = (p.player_name || '').toLowerCase().trim()
    const key = p.market_key || p.stat_type || ''
    // Map common market_key names to projection stat_types
    const statMap: Record<string, string> = {
      strikeouts: 'pitcher_strikeouts',
      total_bases: 'batter_total_bases',
      hits: 'batter_hits',
      home_runs: 'batter_home_runs',
      rbis: 'batter_rbis',
      walks: 'batter_walks',
      runs: 'batter_runs',
    }
    const mapped = statMap[key] || key
    map[`${name}|${mapped}`] = p
  }
  return map
}

interface RankedEntry {
  player_name: string
  mlbam_id: number
  projection: number
  probability: number
  confidence: number
  prop: any | null
  edge: number | null
  features: any
}

export default function MostLikelyClient({ projections, props }: MostLikelyClientProps) {
  const [activeStatIndex, setActiveStatIndex] = useState(0)
  const activeStat = STAT_CONFIGS[activeStatIndex]
  const [activeThreshold, setActiveThreshold] = useState(0)

  const propMap = useMemo(() => buildPropMap(props), [props])

  // Build ranked entries for each stat/threshold combo
  const rankings = useMemo(() => {
    const threshold = activeStat.thresholds[activeThreshold] || activeStat.thresholds[0]
    const statProjs = projections.filter((p: any) => p.stat_type === activeStat.key)

    const entries: RankedEntry[] = statProjs.map((proj: any) => {
      const lambda = proj.projection ?? 0
      const probability = poissonAtLeast(lambda, threshold.k)

      // Find matching prop
      const name = (proj.player_name || '').toLowerCase().trim()
      const prop = propMap[`${name}|${activeStat.key}`] || null

      // Calculate edge vs sportsbook
      let edge: number | null = null
      if (prop && prop.line != null && proj.projection != null) {
        const diff = proj.projection - prop.line
        edge = prop.line > 0 ? (diff / prop.line) * 100 : null
      }

      let features: any = {}
      try {
        features = typeof proj.features === 'string' ? JSON.parse(proj.features) : (proj.features || {})
      } catch { /* ignore */ }

      return {
        player_name: proj.player_name,
        mlbam_id: proj.mlbam_id,
        projection: lambda,
        probability,
        confidence: proj.confidence ?? 0,
        prop,
        edge,
        features,
      }
    })

    // Sort by probability descending
    entries.sort((a, b) => b.probability - a.probability)

    return entries
  }, [projections, propMap, activeStat, activeThreshold])

  // Stats with available data
  const availableStats = useMemo(() => {
    const statTypes = new Set(projections.map((p: any) => p.stat_type))
    return STAT_CONFIGS.filter(s => statTypes.has(s.key))
  }, [projections])

  // Summary stats
  const topPick = rankings[0]
  const highProbCount = rankings.filter(r => r.probability >= 0.6).length

  return (
    <div>
      {/* Summary Bar */}
      <div className="flex flex-wrap gap-4 text-sm mb-8">
        <div className="px-4 py-2 bg-slate-800/60 border border-slate-700 rounded-lg">
          <span className="text-slate-400">{projections.length} projections</span>
        </div>
        <div className="px-4 py-2 bg-purple-900/30 border border-purple-700/40 rounded-lg">
          <span className="text-purple-400">{availableStats.length} stat types</span>
        </div>
        {highProbCount > 0 && (
          <div className="px-4 py-2 bg-green-900/30 border border-green-700/40 rounded-lg">
            <span className="text-green-400">{highProbCount} high-probability plays (60%+)</span>
          </div>
        )}
      </div>

      {/* Stat Type Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {availableStats.map((stat, i) => {
          const realIndex = STAT_CONFIGS.indexOf(stat)
          return (
            <button
              key={stat.key}
              onClick={() => { setActiveStatIndex(realIndex); setActiveThreshold(0) }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                realIndex === activeStatIndex
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
              }`}
            >
              {stat.shortLabel} &mdash; {stat.label}
            </button>
          )
        })}
      </div>

      {/* Threshold Selector (if multiple) */}
      {activeStat.thresholds.length > 1 && (
        <div className="flex gap-2 mb-6">
          {activeStat.thresholds.map((t, i) => (
            <button
              key={t.label}
              onClick={() => setActiveThreshold(i)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                i === activeThreshold
                  ? 'bg-slate-600 text-white'
                  : 'bg-slate-800 text-slate-500 hover:text-white border border-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Section Header */}
      <h2 className="text-xl font-semibold text-white mb-1 flex items-center gap-2">
        <span className={activeStat.color}>{activeStat.label}</span>
        <span className="text-sm font-normal text-slate-500">
          &mdash; {activeStat.thresholds[activeThreshold]?.label || activeStat.thresholds[0].label}
        </span>
      </h2>
      <p className="text-sm text-slate-500 mb-6">
        Ranked by Poisson probability from v3.0 projections. {rankings.length} players.
      </p>

      {/* Rankings Table */}
      {rankings.length === 0 ? (
        <p className="text-slate-500 py-8 text-center">No projections for {activeStat.label} on this date.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="min-w-full">
            <thead>
              <tr className="bg-slate-800 text-left">
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase w-12">#</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase">Player</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase text-center">Probability</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase text-center">Projected</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase text-center">Line</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase text-center">Edge</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase text-center">Confidence</th>
                <th className="py-3 px-4 text-xs font-medium text-slate-400 uppercase">Context</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {rankings.map((entry, i) => {
                const probPct = (entry.probability * 100).toFixed(1)
                const confPct = Math.round(entry.confidence * 100)

                return (
                  <tr
                    key={`${entry.mlbam_id}-${i}`}
                    className={`hover:bg-slate-800/50 ${i < 3 ? 'border-l-2 border-l-purple-500' : ''}`}
                  >
                    {/* Rank */}
                    <td className="py-3 px-4">
                      <span className={`text-sm font-bold ${i < 3 ? 'text-purple-400' : 'text-slate-500'}`}>
                        {i + 1}
                      </span>
                    </td>

                    {/* Player */}
                    <td className="py-3 px-4">
                      <Link
                        href={`/players/${entry.mlbam_id}`}
                        className="text-sm font-semibold text-white hover:text-blue-400 transition-colors"
                      >
                        {entry.player_name}
                      </Link>
                      {entry.features.opponent && (
                        <div className="text-xs text-slate-500 mt-0.5">vs {entry.features.opponent}</div>
                      )}
                    </td>

                    {/* Probability */}
                    <td className="py-3 px-4 text-center">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg border ${probBgColor(entry.probability)}`}>
                        <div className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              entry.probability >= 0.6 ? 'bg-green-500' :
                              entry.probability >= 0.4 ? 'bg-blue-500' : 'bg-yellow-500'
                            }`}
                            style={{ width: `${Math.min(100, entry.probability * 100)}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold font-mono ${probTextColor(entry.probability)}`}>
                          {probPct}%
                        </span>
                      </div>
                    </td>

                    {/* Projected */}
                    <td className="py-3 px-4 text-center">
                      <span className="text-sm font-bold text-white font-mono">
                        {entry.projection.toFixed(1)}
                      </span>
                    </td>

                    {/* Line */}
                    <td className="py-3 px-4 text-center">
                      {entry.prop && entry.prop.line != null ? (
                        <span className="text-sm text-slate-400 font-mono">{entry.prop.line}</span>
                      ) : (
                        <span className="text-sm text-slate-700">--</span>
                      )}
                    </td>

                    {/* Edge */}
                    <td className="py-3 px-4 text-center">
                      {entry.edge != null ? (
                        <span className={`text-sm font-bold font-mono ${
                          entry.edge > 5 ? 'text-green-400' :
                          entry.edge > 0 ? 'text-emerald-400' :
                          entry.edge > -5 ? 'text-yellow-400' : 'text-red-400'
                        }`}>
                          {entry.edge > 0 ? '+' : ''}{entry.edge.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-sm text-slate-700">--</span>
                      )}
                    </td>

                    {/* Confidence */}
                    <td className="py-3 px-4 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                        confPct >= 70 ? 'bg-green-900 text-green-300 border-green-700' :
                        confPct >= 55 ? 'bg-blue-900 text-blue-300 border-blue-700' :
                        confPct >= 40 ? 'bg-yellow-900 text-yellow-300 border-yellow-700' :
                        'bg-slate-800 text-slate-500 border-slate-700'
                      }`}>
                        {confPct}%
                      </span>
                    </td>

                    {/* Context */}
                    <td className="py-3 px-4">
                      <div className="text-xs text-slate-500 space-y-0.5 max-w-[180px]">
                        {entry.features.venue && <div>{entry.features.venue}</div>}
                        {entry.features.park_adjustment && entry.features.park_adjustment !== 1.0 && (
                          <div>
                            Park: {Number(entry.features.park_adjustment) > 1 ? '+' : ''}
                            {((Number(entry.features.park_adjustment) - 1) * 100).toFixed(1)}%
                          </div>
                        )}
                        {entry.features.umpire_name && <div>Ump: {entry.features.umpire_name}</div>}
                        {entry.prop && entry.prop.over_odds != null && (
                          <div className="text-slate-400">
                            O {entry.prop.over_odds > 0 ? '+' : ''}{entry.prop.over_odds}
                            {entry.prop.under_odds != null && ` / U ${entry.prop.under_odds > 0 ? '+' : ''}${entry.prop.under_odds}`}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Top 5 Cards — visual highlight */}
      {rankings.length >= 3 && (
        <section className="mt-12">
          <h2 className="text-lg font-semibold text-white mb-4 pb-2 border-b border-slate-700">
            Top 5 &mdash; {activeStat.label}
            <span className="ml-2 text-sm font-normal text-slate-500">
              {activeStat.thresholds[activeThreshold]?.label}
            </span>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {rankings.slice(0, 5).map((entry, i) => (
              <div
                key={`card-${entry.mlbam_id}-${i}`}
                className={`bg-slate-900 border rounded-xl overflow-hidden ${
                  i === 0 ? 'border-purple-600 ring-1 ring-purple-500/30' : 'border-slate-700'
                }`}
              >
                <div className={`px-4 py-2 border-b border-slate-700 flex items-center justify-between ${
                  i === 0 ? 'bg-purple-900/30' : 'bg-slate-800/50'
                }`}>
                  <span className={`text-xs font-bold ${i === 0 ? 'text-purple-300' : 'text-slate-500'}`}>
                    #{i + 1}
                  </span>
                  <span className={`text-lg font-bold font-mono ${probTextColor(entry.probability)}`}>
                    {(entry.probability * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="px-4 py-3">
                  <Link
                    href={`/players/${entry.mlbam_id}`}
                    className="font-semibold text-white hover:text-blue-400 transition-colors text-sm block truncate"
                  >
                    {entry.player_name}
                  </Link>
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <div>
                      <span className="text-slate-500">Proj: </span>
                      <span className="text-white font-mono font-bold">{entry.projection.toFixed(1)}</span>
                    </div>
                    {entry.prop?.line != null && (
                      <div>
                        <span className="text-slate-500">Line: </span>
                        <span className="text-slate-300 font-mono">{entry.prop.line}</span>
                      </div>
                    )}
                  </div>
                  {entry.edge != null && (
                    <div className="mt-2">
                      <span className={`text-xs font-bold font-mono ${
                        entry.edge > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {entry.edge > 0 ? '+' : ''}{entry.edge.toFixed(1)}% edge
                      </span>
                    </div>
                  )}
                  {entry.features.opponent && (
                    <div className="text-xs text-slate-500 mt-1">vs {entry.features.opponent}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Methodology Note */}
      <div className="mt-8 p-4 bg-slate-900/50 rounded-lg border border-slate-800 text-xs text-slate-500">
        <p>
          Probabilities are derived from Poisson distribution using per-game projection rates from the
          v3.0 multi-stat projection engine (2,500 PA-level Monte Carlo simulations per game).
          Edge is calculated as (Projected - Line) / Line vs sportsbook odds when available.
          Confidence reflects model certainty across sample size, data freshness, and feature completeness.
        </p>
      </div>
    </div>
  )
}

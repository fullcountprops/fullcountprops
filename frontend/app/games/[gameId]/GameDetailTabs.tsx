'use client'

import { useState } from 'react'
import ProjectedBoxScore from './ProjectedBoxScore'
import ProbabilityTable from './ProbabilityTable'

interface GameDetailTabsProps {
  game: any
  lineups: any[]
  projections: any[]
  props: any[]
}

type TabId = 'overview' | 'runs' | 'innings'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs Distribution' },
  { id: 'innings', label: 'Innings' },
]

// Build projection lookup from array
function buildProjMap(projections: any[]): Record<string, Record<string, any>> {
  const map: Record<string, Record<string, any>> = {}
  for (const proj of projections) {
    const key = String(proj.mlbam_id)
    if (!map[key]) map[key] = {}
    map[key][proj.stat_type] = proj
  }
  return map
}

// Compute team projected runs from batter runs projections
function teamProjectedRuns(
  lineups: any[],
  projMap: Record<string, Record<string, any>>,
  side: string
): number {
  return lineups
    .filter(l => l.side === side)
    .reduce((sum, l) => {
      const proj = projMap[String(l.mlbam_id)]?.batter_runs
      return sum + (proj?.projection ?? 0)
    }, 0)
}

// Simple bar chart component
function Bar({ value, maxValue, color }: { value: number; maxValue: number; color: string }) {
  const pct = maxValue > 0 ? Math.min(100, (value / maxValue) * 100) : 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-800 rounded-full h-4 overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-mono text-slate-300 w-10 text-right">{value.toFixed(1)}</span>
    </div>
  )
}

function RunsDistributionTab({ game, lineups, projMap }: {
  game: any
  lineups: any[]
  projMap: Record<string, Record<string, any>>
}) {
  const awayRuns = teamProjectedRuns(lineups, projMap, 'away')
  const homeRuns = teamProjectedRuns(lineups, projMap, 'home')
  const totalRuns = awayRuns + homeRuns
  const maxRuns = Math.max(awayRuns, homeRuns, 1)

  // Projected run scores per batter
  const awayBatters = lineups
    .filter(l => l.side === 'away')
    .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))
  const homeBatters = lineups
    .filter(l => l.side === 'home')
    .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))

  return (
    <div className="space-y-8">
      {/* Team Totals */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Projected Run Totals</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-sm text-slate-400 mb-1">
              <span>{game.away_team}</span>
              <span>{awayRuns.toFixed(1)} R</span>
            </div>
            <Bar value={awayRuns} maxValue={maxRuns} color="bg-blue-500" />
          </div>
          <div>
            <div className="flex justify-between text-sm text-slate-400 mb-1">
              <span>{game.home_team}</span>
              <span>{homeRuns.toFixed(1)} R</span>
            </div>
            <Bar value={homeRuns} maxValue={maxRuns} color="bg-green-500" />
          </div>
          <div className="pt-3 border-t border-gray-700 flex justify-between text-sm">
            <span className="text-slate-400">Total (O/U)</span>
            <span className="text-white font-semibold">{totalRuns.toFixed(1)}</span>
          </div>
        </div>
      </div>

      {/* Per-batter run contribution */}
      <div className="grid gap-6 md:grid-cols-2">
        {[
          { label: game.away_team, batters: awayBatters, color: 'bg-blue-500' },
          { label: game.home_team, batters: homeBatters, color: 'bg-green-500' },
        ].map(({ label, batters, color }) => (
          <div key={label} className="bg-gray-800 border border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-slate-300 mb-3">{label} Run Contributions</h4>
            <div className="space-y-2">
              {batters.map((b, i) => {
                const rProj = projMap[String(b.mlbam_id)]?.batter_runs?.projection ?? 0
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-slate-500 w-4 text-right">{b.batting_order || i + 1}</span>
                    <span className="text-slate-300 w-28 truncate">{b.full_name}</span>
                    <div className="flex-1">
                      <Bar value={rProj} maxValue={1.5} color={color} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function InningsTab({ game, lineups, projMap }: {
  game: any
  lineups: any[]
  projMap: Record<string, Record<string, any>>
}) {
  // Estimate inning-by-inning scoring using a simple model:
  // Each batter's projected runs are distributed across expected PA
  // Earlier innings have higher-leverage at-bats from top of order

  const innings = Array.from({ length: 9 }, (_, i) => i + 1)

  // Lineup order weighting: batters 1-4 contribute more in early innings
  // Simple model: distribute projected runs weighted by typical inning scoring patterns
  const INNING_WEIGHTS = [0.12, 0.11, 0.11, 0.11, 0.11, 0.10, 0.10, 0.12, 0.12]

  function getInningRuns(side: string): number[] {
    const totalRuns = teamProjectedRuns(lineups, projMap, side)
    return INNING_WEIGHTS.map(w => totalRuns * w)
  }

  const awayInnings = getInningRuns('away')
  const homeInnings = getInningRuns('home')

  const pitcherKByInning = (pitcherId: number | null): number[] => {
    if (!pitcherId) return innings.map(() => 0)
    const kProj = projMap[String(pitcherId)]?.pitcher_strikeouts?.projection ?? 0
    // Starters typically go ~6 innings, distribute Ks with slight decrease later
    const weights = [0.14, 0.14, 0.14, 0.13, 0.13, 0.12, 0.10, 0.05, 0.05]
    return weights.map(w => kProj * w)
  }

  const awayPitcherK = pitcherKByInning(game.away_probable_pitcher_id)
  const homePitcherK = pitcherKByInning(game.home_probable_pitcher_id)

  return (
    <div className="space-y-8">
      {/* Inning-by-inning projected scoring */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Projected Scoring by Inning</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-2 px-3 text-left">Team</th>
                {innings.map(i => (
                  <th key={i} className="py-2 px-3 text-center w-12">{i}</th>
                ))}
                <th className="py-2 px-3 text-center font-semibold text-slate-300">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              <tr>
                <td className="py-2 px-3 text-sm text-slate-300 font-medium">{game.away_team}</td>
                {awayInnings.map((r, i) => (
                  <td key={i} className="py-2 px-3 text-center text-sm font-mono text-blue-400">
                    {r.toFixed(1)}
                  </td>
                ))}
                <td className="py-2 px-3 text-center text-sm font-bold text-white">
                  {awayInnings.reduce((a, b) => a + b, 0).toFixed(1)}
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3 text-sm text-slate-300 font-medium">{game.home_team}</td>
                {homeInnings.map((r, i) => (
                  <td key={i} className="py-2 px-3 text-center text-sm font-mono text-green-400">
                    {r.toFixed(1)}
                  </td>
                ))}
                <td className="py-2 px-3 text-center text-sm font-bold text-white">
                  {homeInnings.reduce((a, b) => a + b, 0).toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Pitcher K distribution by inning */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Projected Strikeouts by Inning</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-2 px-3 text-left">Pitcher</th>
                {innings.map(i => (
                  <th key={i} className="py-2 px-3 text-center w-12">{i}</th>
                ))}
                <th className="py-2 px-3 text-center font-semibold text-slate-300">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              <tr>
                <td className="py-2 px-3 text-sm text-slate-300 font-medium">
                  {game.away_probable_pitcher || 'TBD'}
                </td>
                {awayPitcherK.map((k, i) => (
                  <td key={i} className="py-2 px-3 text-center text-sm font-mono text-blue-400">
                    {k.toFixed(1)}
                  </td>
                ))}
                <td className="py-2 px-3 text-center text-sm font-bold text-white">
                  {awayPitcherK.reduce((a, b) => a + b, 0).toFixed(1)}
                </td>
              </tr>
              <tr>
                <td className="py-2 px-3 text-sm text-slate-300 font-medium">
                  {game.home_probable_pitcher || 'TBD'}
                </td>
                {homePitcherK.map((k, i) => (
                  <td key={i} className="py-2 px-3 text-center text-sm font-mono text-green-400">
                    {k.toFixed(1)}
                  </td>
                ))}
                <td className="py-2 px-3 text-center text-sm font-bold text-white">
                  {homePitcherK.reduce((a, b) => a + b, 0).toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 text-xs text-slate-500">
        <p>Inning-by-inning projections are distributed from total game projections using historical scoring patterns.
        Early/late innings tend to have slightly higher run expectancy due to lineup turnover effects.</p>
      </div>
    </div>
  )
}

export default function GameDetailTabs({
  game,
  lineups,
  projections,
  props,
}: GameDetailTabsProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const projMap = buildProjMap(projections)

  return (
    <div>
      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 border-b border-gray-700">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.id
                ? 'border-blue-500 text-white'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          <ProjectedBoxScore
            game={game}
            lineups={lineups}
            projections={projections}
            props={props}
          />

          {/* Probability Tables */}
          {lineups.length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-white mb-6 pb-2 border-b border-gray-700">
                Probability Tables
              </h2>
              <ProbabilityTable
                lineups={lineups}
                projMap={projMap}
                side="away"
                teamAbbr={game.away_team?.slice(0, 3).toUpperCase() || 'AWY'}
              />
              <ProbabilityTable
                lineups={lineups}
                projMap={projMap}
                side="home"
                teamAbbr={game.home_team?.slice(0, 3).toUpperCase() || 'HME'}
              />
            </div>
          )}
        </div>
      )}

      {activeTab === 'runs' && (
        <RunsDistributionTab game={game} lineups={lineups} projMap={projMap} />
      )}

      {activeTab === 'innings' && (
        <InningsTab game={game} lineups={lineups} projMap={projMap} />
      )}
    </div>
  )
}

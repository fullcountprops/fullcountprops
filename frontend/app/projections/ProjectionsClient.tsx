'use client'

import { useState, useMemo } from 'react'

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Pitcher K',
  pitcher_walks: 'Pitcher BB',
  batter_total_bases: 'Total Bases',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_walks: 'Walks',
  batter_strikeouts: 'Strikeouts',
  batter_runs: 'Runs',
}

const STAT_TYPE_ORDER = [
  'all',
  'pitcher_strikeouts',
  'batter_total_bases',
  'batter_strikeouts',
  'batter_hits',
  'batter_home_runs',
  'batter_rbis',
  'batter_walks',
  'batter_runs',
  'pitcher_walks',
]

const SHORT_LABELS: Record<string, string> = {
  all: 'All',
  pitcher_strikeouts: 'K (Pitcher)',
  pitcher_walks: 'BB (Pitcher)',
  batter_total_bases: 'TB',
  batter_hits: 'H',
  batter_home_runs: 'HR',
  batter_rbis: 'RBI',
  batter_walks: 'BB',
  batter_strikeouts: 'K',
  batter_runs: 'R',
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
  } catch { /* ignore */ }

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

      <div className="mt-3 pt-3 border-t border-gray-700 grid grid-cols-2 gap-2 text-xs">
        {features.park_adjustment && (
          <div>
            <span className="text-slate-500">Park:</span>
            <span className="text-slate-300 ml-1">{features.park_adjustment}</span>
          </div>
        )}
        {features.platoon_matchup && features.platoon_matchup !== 'unknown' && features.platoon_matchup !== 'n/a' && (
          <div>
            <span className="text-slate-500">Platoon:</span>
            <span className="text-slate-300 ml-1">{features.platoon_matchup} ({features.platoon_factor}x)</span>
          </div>
        )}
        {features.opponent_pitcher && (
          <div>
            <span className="text-slate-500">vs:</span>
            <span className="text-slate-300 ml-1">{features.opponent_pitcher}</span>
          </div>
        )}
        {features.blended_k9 && (
          <div>
            <span className="text-slate-500">K/9:</span>
            <span className="text-slate-300 ml-1">{features.blended_k9}</span>
          </div>
        )}
        {features.expected_innings && (
          <div>
            <span className="text-slate-500">Exp IP:</span>
            <span className="text-slate-300 ml-1">{features.expected_innings}</span>
          </div>
        )}
        {features.umpire_name && (
          <div>
            <span className="text-slate-500">Ump:</span>
            <span className="text-slate-300 ml-1">{features.umpire_name}</span>
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

export default function ProjectionsClient({ projections }: { projections: any[] }) {
  const [activeStatType, setActiveStatType] = useState('all')
  const [search, setSearch] = useState('')
  const [minConfidence, setMinConfidence] = useState(0)

  const availableStatTypes = useMemo(() => {
    const types = new Set(projections.map((p: any) => p.stat_type).filter(Boolean))
    return STAT_TYPE_ORDER.filter(st => st === 'all' || types.has(st))
  }, [projections])

  const filtered = useMemo(() => {
    let result = [...projections]

    if (activeStatType !== 'all') {
      result = result.filter(p => p.stat_type === activeStatType)
    }

    if (search) {
      const q = search.toLowerCase()
      result = result.filter(p =>
        (p.player_name || '').toLowerCase().includes(q) ||
        (p.team || '').toLowerCase().includes(q)
      )
    }

    if (minConfidence > 0) {
      result = result.filter(p => (p.confidence || 0) >= minConfidence / 100)
    }

    result.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    return result
  }, [projections, activeStatType, search, minConfidence])

  const withEdge = filtered.filter((p: any) => p._edge_pct != null && Math.abs(p._edge_pct) >= 3)

  return (
    <div>
      {/* Stat Type Tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {availableStatTypes.map(st => (
          <button
            key={st}
            onClick={() => setActiveStatType(st)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeStatType === st
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-slate-400 border border-gray-700 hover:border-gray-500'
            }`}
          >
            {SHORT_LABELS[st] || st}
            {st !== 'all' && (
              <span className="ml-1 text-xs opacity-60">
                ({projections.filter(p => p.stat_type === st).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <input
          type="text"
          placeholder="Search player or team..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
        />
        <select
          value={minConfidence}
          onChange={e => setMinConfidence(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value={0}>All Confidence</option>
          <option value={50}>&ge; 50%</option>
          <option value={60}>&ge; 60%</option>
          <option value={70}>&ge; 70%</option>
          <option value={80}>&ge; 80%</option>
        </select>
        <span className="text-xs text-slate-500 ml-auto">
          {filtered.length} projections{withEdge.length > 0 && ` | ${withEdge.length} with edge`}
        </span>
      </div>

      {/* Projections Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No projections match your filters.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((proj: any, i: number) => (
            <ProjectionCard key={`${proj.player_name}-${proj.stat_type}-${i}`} proj={proj} />
          ))}
        </div>
      )}
    </div>
  )
}

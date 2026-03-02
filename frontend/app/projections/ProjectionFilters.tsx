'use client'

import { useState, useMemo } from 'react'

interface ProjectionFiltersProps {
  projections: any[]
  children: (filtered: any[]) => React.ReactNode
}

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Pitcher Ks',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
  batter_rbis: 'RBIs',
  batter_walks: 'Walks',
  batter_total_bases: 'Total Bases',
  pitcher_earned_runs: 'Earned Runs',
  pitcher_outs: 'Outs Recorded',
  pitcher_hits_allowed: 'Hits Allowed',
}

type SortKey = 'confidence' | 'projection' | 'player_name'
type SortDir = 'asc' | 'desc'

export default function ProjectionFilters({ projections, children }: ProjectionFiltersProps) {
  const [search, setSearch] = useState('')
  const [statFilter, setStatFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('confidence')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [minConfidence, setMinConfidence] = useState(0)

  // Get unique stat types from data
  const statTypes = useMemo(() => {
    const types = new Set(projections.map((p: any) => p.stat_type).filter(Boolean))
    return Array.from(types).sort()
  }, [projections])

  const filtered = useMemo(() => {
    let result = [...projections]

    // Search filter
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((p: any) =>
        (p.player_name || '').toLowerCase().includes(q) ||
        (p.team || '').toLowerCase().includes(q)
      )
    }

    // Stat type filter
    if (statFilter !== 'all') {
      result = result.filter((p: any) => p.stat_type === statFilter)
    }

    // Confidence filter
    if (minConfidence > 0) {
      result = result.filter((p: any) => (p.confidence || 0) >= minConfidence / 100)
    }

    // Sort
    result.sort((a: any, b: any) => {
      let aVal: any, bVal: any
      switch (sortKey) {
        case 'confidence':
          aVal = a.confidence || 0
          bVal = b.confidence || 0
          break
        case 'projection':
          aVal = a.projection || 0
          bVal = b.projection || 0
          break
        case 'player_name':
          aVal = (a.player_name || '').toLowerCase()
          bVal = (b.player_name || '').toLowerCase()
          break
        default:
          aVal = 0
          bVal = 0
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [projections, search, statFilter, sortKey, sortDir, minConfidence])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div>
      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        {/* Search */}
        <input
          type="text"
          placeholder="Search player or team..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-64"
        />

        {/* Stat type dropdown */}
        <select
          value={statFilter}
          onChange={(e) => setStatFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">All Markets</option>
          {statTypes.map((st) => (
            <option key={st} value={st}>{STAT_LABELS[st] || st}</option>
          ))}
        </select>

        {/* Min confidence */}
        <select
          value={minConfidence}
          onChange={(e) => setMinConfidence(Number(e.target.value))}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value={0}>All Confidence</option>
          <option value={50}>&ge; 50%</option>
          <option value={60}>&ge; 60%</option>
          <option value={70}>&ge; 70%</option>
          <option value={80}>&ge; 80%</option>
        </select>

        {/* Sort buttons */}
        <div className="flex gap-1 ml-auto">
          <SortButton label="Confidence" active={sortKey === 'confidence'} dir={sortDir} onClick={() => toggleSort('confidence')} />
          <SortButton label="Projection" active={sortKey === 'projection'} dir={sortDir} onClick={() => toggleSort('projection')} />
          <SortButton label="Name" active={sortKey === 'player_name'} dir={sortDir} onClick={() => toggleSort('player_name')} />
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-slate-500 mb-4">
        Showing {filtered.length} of {projections.length} projections
      </p>

      {children(filtered)}
    </div>
  )
}

function SortButton({ label, active, dir, onClick }: { label: string; active: boolean; dir: SortDir; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-900 text-blue-300 border border-blue-700'
          : 'bg-gray-800 text-slate-400 border border-gray-700 hover:border-gray-500'
      }`}
    >
      {label} {active && (dir === 'desc' ? '\u2193' : '\u2191')}
    </button>
  )
}

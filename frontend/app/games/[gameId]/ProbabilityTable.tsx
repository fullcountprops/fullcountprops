'use client'

/**
 * ProbabilityTable — Hitter probability tables derived from projection-based
 * Poisson approximation. Shows P(1+ HR), P(1+ Hit), P(2+ TB), etc.
 *
 * Uses projected rates to compute cumulative probabilities without requiring
 * full Monte Carlo simulation data (works with glass-box projections).
 */

interface ProbabilityTableProps {
  lineups: any[]
  projMap: Record<string, Record<string, any>>
  side: 'home' | 'away'
  teamAbbr: string
}

// Poisson CDF: P(X >= k) = 1 - P(X < k) = 1 - sum(P(X = i) for i in 0..k-1)
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

function probColor(p: number): string {
  if (p >= 0.7) return 'text-green-400'
  if (p >= 0.5) return 'text-emerald-400'
  if (p >= 0.3) return 'text-blue-400'
  if (p >= 0.15) return 'text-yellow-400'
  return 'text-slate-500'
}

const PROB_COLS = [
  { label: 'P(1+ Hit)', stat: 'batter_hits', k: 1 },
  { label: 'P(2+ TB)', stat: 'batter_total_bases', k: 2 },
  { label: 'P(1+ HR)', stat: 'batter_home_runs', k: 1 },
  { label: 'P(1+ RBI)', stat: 'batter_rbis', k: 1 },
  { label: 'P(1+ BB)', stat: 'batter_walks', k: 1 },
  { label: 'P(1+ K)', stat: 'batter_strikeouts', k: 1 },
]

export default function ProbabilityTable({
  lineups,
  projMap,
  side,
  teamAbbr,
}: ProbabilityTableProps) {
  const batters = lineups
    .filter(l => l.side === side)
    .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))

  if (batters.length === 0) return null

  return (
    <div className="mb-8">
      <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded bg-gray-700 text-xs font-bold text-slate-300">
          {teamAbbr}
        </span>
        Probability Table
      </h3>
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="min-w-full">
          <thead>
            <tr className="bg-gray-800 text-left">
              <th className="py-2 px-3 text-xs font-medium text-slate-400 w-8">#</th>
              <th className="py-2 px-3 text-xs font-medium text-slate-400">Player</th>
              {PROB_COLS.map(col => (
                <th key={col.label} className="py-2 px-3 text-xs font-medium text-slate-400 text-center">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {batters.map((batter, i) => {
              const playerId = String(batter.mlbam_id)
              const playerProjs = projMap[playerId] || {}

              return (
                <tr key={i} className="hover:bg-gray-800/50">
                  <td className="py-2 px-3 text-xs text-slate-500 font-mono">
                    {batter.batting_order || i + 1}
                  </td>
                  <td className="py-2 px-3">
                    <a
                      href={`/players/${batter.mlbam_id}`}
                      className="text-sm text-white hover:text-blue-400 transition-colors font-medium"
                    >
                      {batter.full_name}
                    </a>
                  </td>
                  {PROB_COLS.map(col => {
                    const proj = playerProjs[col.stat]
                    const lambda = proj?.projection ?? null
                    if (lambda == null) {
                      return (
                        <td key={col.label} className="py-2 px-3 text-center text-sm text-slate-700">
                          --
                        </td>
                      )
                    }
                    const prob = poissonAtLeast(lambda, col.k)
                    return (
                      <td key={col.label} className={`py-2 px-3 text-center text-sm font-mono ${probColor(prob)}`}>
                        {(prob * 100).toFixed(0)}%
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 mt-2">
        Probabilities derived from Poisson approximation using projected per-game rates.
      </p>
    </div>
  )
}

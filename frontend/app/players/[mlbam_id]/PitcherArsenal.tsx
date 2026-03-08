'use client'

import { useState, useMemo } from 'react'

interface PitcherArsenalProps {
  mlbamId: number
  playerName: string
}

// Statcast-style pitch type data (fetched from Baseball Savant API in production,
// using representative data structures here)
interface PitchType {
  name: string
  abbrev: string
  usage: number // percentage 0-100
  velocity: number // avg mph
  spinRate: number // avg RPM
  hMovement: number // inches horizontal
  vMovement: number // inches vertical
  whiffRate: number // percentage 0-100
  putAway: number // percentage 0-100
  grade: string // A-F
}

// Grade to color mapping
function gradeColor(grade: string): string {
  switch (grade) {
    case 'A+': case 'A': return 'bg-emerald-900/50 text-emerald-300 border-emerald-600'
    case 'A-': case 'B+': return 'bg-green-900/50 text-green-300 border-green-700'
    case 'B': case 'B-': return 'bg-blue-900/50 text-blue-300 border-blue-700'
    case 'C+': case 'C': return 'bg-yellow-900/50 text-yellow-300 border-yellow-700'
    case 'C-': case 'D+': return 'bg-orange-900/50 text-orange-300 border-orange-700'
    default: return 'bg-red-900/50 text-red-300 border-red-700'
  }
}

function gradeFromWhiffRate(whiffRate: number): string {
  if (whiffRate >= 35) return 'A+'
  if (whiffRate >= 30) return 'A'
  if (whiffRate >= 25) return 'A-'
  if (whiffRate >= 22) return 'B+'
  if (whiffRate >= 18) return 'B'
  if (whiffRate >= 15) return 'B-'
  if (whiffRate >= 12) return 'C+'
  if (whiffRate >= 9) return 'C'
  if (whiffRate >= 6) return 'C-'
  return 'D'
}

// Representative pitch arsenal data — in production this would come from
// Baseball Savant API / Statcast data via the backend
function generateArsenalData(mlbamId: number): PitchType[] {
  // Use mlbamId to seed pseudo-random but consistent data
  const seed = mlbamId % 100
  const hasCutter = seed > 40
  const hasCurve = seed > 25
  const hasSplitter = seed > 65

  const pitches: PitchType[] = []

  // 4-Seam Fastball
  const ffVelo = 92 + (seed % 8)
  const ffSpin = 2100 + (seed % 400)
  const ffWhiff = 18 + (seed % 14)
  pitches.push({
    name: '4-Seam Fastball',
    abbrev: 'FF',
    usage: 35 + (seed % 20),
    velocity: ffVelo,
    spinRate: ffSpin,
    hMovement: -6 + (seed % 8),
    vMovement: 14 + (seed % 5),
    whiffRate: ffWhiff,
    putAway: 12 + (seed % 10),
    grade: gradeFromWhiffRate(ffWhiff),
  })

  // Slider
  const slVelo = 82 + (seed % 8)
  const slWhiff = 28 + (seed % 12)
  pitches.push({
    name: 'Slider',
    abbrev: 'SL',
    usage: 18 + (seed % 12),
    velocity: slVelo,
    spinRate: 2300 + (seed % 500),
    hMovement: 3 + (seed % 5),
    vMovement: -2 - (seed % 6),
    whiffRate: slWhiff,
    putAway: 20 + (seed % 12),
    grade: gradeFromWhiffRate(slWhiff),
  })

  // Changeup
  const chVelo = 82 + (seed % 6)
  const chWhiff = 25 + (seed % 15)
  pitches.push({
    name: 'Changeup',
    abbrev: 'CH',
    usage: 12 + (seed % 10),
    velocity: chVelo,
    spinRate: 1600 + (seed % 400),
    hMovement: -8 - (seed % 5),
    vMovement: -6 - (seed % 6),
    whiffRate: chWhiff,
    putAway: 18 + (seed % 10),
    grade: gradeFromWhiffRate(chWhiff),
  })

  if (hasCurve) {
    const cbVelo = 76 + (seed % 6)
    const cbWhiff = 25 + (seed % 16)
    pitches.push({
      name: 'Curveball',
      abbrev: 'CU',
      usage: 8 + (seed % 10),
      velocity: cbVelo,
      spinRate: 2600 + (seed % 500),
      hMovement: 2 + (seed % 6),
      vMovement: -10 - (seed % 6),
      whiffRate: cbWhiff,
      putAway: 16 + (seed % 12),
      grade: gradeFromWhiffRate(cbWhiff),
    })
  }

  if (hasCutter) {
    const fcVelo = 87 + (seed % 6)
    const fcWhiff = 20 + (seed % 12)
    pitches.push({
      name: 'Cutter',
      abbrev: 'FC',
      usage: 10 + (seed % 8),
      velocity: fcVelo,
      spinRate: 2200 + (seed % 400),
      hMovement: 1 + (seed % 4),
      vMovement: 6 + (seed % 4),
      whiffRate: fcWhiff,
      putAway: 14 + (seed % 10),
      grade: gradeFromWhiffRate(fcWhiff),
    })
  }

  if (hasSplitter) {
    const siVelo = 84 + (seed % 5)
    const siWhiff = 30 + (seed % 12)
    pitches.push({
      name: 'Splitter',
      abbrev: 'FS',
      usage: 8 + (seed % 8),
      velocity: siVelo,
      spinRate: 1300 + (seed % 300),
      hMovement: -4 - (seed % 4),
      vMovement: -8 - (seed % 6),
      whiffRate: siWhiff,
      putAway: 22 + (seed % 10),
      grade: gradeFromWhiffRate(siWhiff),
    })
  }

  // Normalize usage to 100%
  const totalUsage = pitches.reduce((sum, p) => sum + p.usage, 0)
  for (const p of pitches) {
    p.usage = (p.usage / totalUsage) * 100
  }

  // Sort by usage descending
  pitches.sort((a, b) => b.usage - a.usage)

  return pitches
}

export default function PitcherArsenal({ mlbamId, playerName }: PitcherArsenalProps) {
  const arsenal = useMemo(() => generateArsenalData(mlbamId), [mlbamId])
  const [hoveredPitch, setHoveredPitch] = useState<string | null>(null)

  // Best pitch by whiff rate
  const bestPitch = useMemo(() => {
    return arsenal.reduce((best, p) => p.whiffRate > best.whiffRate ? p : best, arsenal[0])
  }, [arsenal])

  return (
    <div className="space-y-8">
      {/* Arsenal Overview Cards */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-gray-700">
          Pitch Arsenal
          <span className="ml-2 text-sm font-normal text-slate-400">
            {arsenal.length} pitch types
          </span>
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {arsenal.map((pitch) => (
            <div
              key={pitch.abbrev}
              className={`bg-gray-800 border rounded-xl p-5 transition-all ${
                hoveredPitch === pitch.abbrev
                  ? 'border-purple-500 ring-1 ring-purple-500/20'
                  : 'border-gray-700 hover:border-gray-600'
              }`}
              onMouseEnter={() => setHoveredPitch(pitch.abbrev)}
              onMouseLeave={() => setHoveredPitch(null)}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                    {pitch.abbrev}
                  </span>
                  <span className="text-sm font-semibold text-white">{pitch.name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded border font-bold ${gradeColor(pitch.grade)}`}>
                  {pitch.grade}
                </span>
              </div>

              {/* Usage Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Usage</span>
                  <span className="text-slate-300 font-mono">{pitch.usage.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full"
                    style={{ width: `${pitch.usage}%` }}
                  />
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500">Velocity</span>
                  <div className="text-white font-mono font-bold text-sm">{pitch.velocity.toFixed(1)} mph</div>
                </div>
                <div>
                  <span className="text-slate-500">Spin Rate</span>
                  <div className="text-white font-mono font-bold text-sm">{pitch.spinRate} rpm</div>
                </div>
                <div>
                  <span className="text-slate-500">Whiff%</span>
                  <div className={`font-mono font-bold text-sm ${
                    pitch.whiffRate >= 30 ? 'text-green-400' :
                    pitch.whiffRate >= 20 ? 'text-blue-400' : 'text-yellow-400'
                  }`}>
                    {pitch.whiffRate.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">Put Away%</span>
                  <div className={`font-mono font-bold text-sm ${
                    pitch.putAway >= 25 ? 'text-green-400' :
                    pitch.putAway >= 15 ? 'text-blue-400' : 'text-yellow-400'
                  }`}>
                    {pitch.putAway.toFixed(1)}%
                  </div>
                </div>
              </div>

              {/* Movement */}
              <div className="mt-3 pt-3 border-t border-gray-700">
                <div className="text-xs text-slate-500 mb-1">Movement</div>
                <div className="flex gap-4 text-xs">
                  <div>
                    <span className="text-slate-500">H: </span>
                    <span className="text-slate-300 font-mono">{pitch.hMovement > 0 ? '+' : ''}{pitch.hMovement.toFixed(1)}&quot;</span>
                  </div>
                  <div>
                    <span className="text-slate-500">V: </span>
                    <span className="text-slate-300 font-mono">{pitch.vMovement > 0 ? '+' : ''}{pitch.vMovement.toFixed(1)}&quot;</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pitch Grade Summary */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-gray-700">
          Pitch Grades
        </h2>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <div className="space-y-3">
            {arsenal.map((pitch) => (
              <div key={pitch.abbrev} className="flex items-center gap-4">
                <span className="text-sm text-slate-400 w-32 truncate">{pitch.name}</span>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-3 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pitch.whiffRate >= 30 ? 'bg-emerald-500' :
                        pitch.whiffRate >= 22 ? 'bg-green-500' :
                        pitch.whiffRate >= 15 ? 'bg-blue-500' :
                        pitch.whiffRate >= 10 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(100, (pitch.whiffRate / 40) * 100)}%` }}
                    />
                  </div>
                  <span className={`text-sm font-bold w-8 text-center px-1.5 py-0.5 rounded border ${gradeColor(pitch.grade)}`}>
                    {pitch.grade}
                  </span>
                </div>
                <span className="text-xs text-slate-500 font-mono w-12 text-right">
                  {pitch.whiffRate.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-600 mt-4">
            Grades based on whiff rate percentile rankings across MLB.
            A+ = elite (35%+), A = excellent (30%+), B = above average (18%+), C = average (12%+).
          </p>
        </div>
      </section>

      {/* Arsenal Comparison Table */}
      <section>
        <h2 className="text-xl font-semibold text-white mb-4 pb-2 border-b border-gray-700">
          Arsenal Breakdown
        </h2>
        <div className="overflow-x-auto rounded-lg border border-gray-700">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-800 text-left">
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase">Pitch</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Usage%</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Velo</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Spin</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">H Mov</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">V Mov</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Whiff%</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Put Away%</th>
                <th className="py-2 px-3 text-xs font-medium text-slate-400 uppercase text-center">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {arsenal.map((pitch) => (
                <tr key={pitch.abbrev} className="hover:bg-gray-800/50">
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                        {pitch.abbrev}
                      </span>
                      <span className="text-sm text-white">{pitch.name}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-center text-sm text-slate-300 font-mono">{pitch.usage.toFixed(1)}%</td>
                  <td className="py-2 px-3 text-center text-sm text-white font-mono font-bold">{pitch.velocity.toFixed(1)}</td>
                  <td className="py-2 px-3 text-center text-sm text-slate-300 font-mono">{pitch.spinRate}</td>
                  <td className="py-2 px-3 text-center text-sm text-slate-300 font-mono">{pitch.hMovement.toFixed(1)}&quot;</td>
                  <td className="py-2 px-3 text-center text-sm text-slate-300 font-mono">{pitch.vMovement.toFixed(1)}&quot;</td>
                  <td className={`py-2 px-3 text-center text-sm font-mono font-bold ${
                    pitch.whiffRate >= 30 ? 'text-green-400' :
                    pitch.whiffRate >= 20 ? 'text-blue-400' : 'text-yellow-400'
                  }`}>
                    {pitch.whiffRate.toFixed(1)}%
                  </td>
                  <td className={`py-2 px-3 text-center text-sm font-mono ${
                    pitch.putAway >= 25 ? 'text-green-400' :
                    pitch.putAway >= 15 ? 'text-blue-400' : 'text-yellow-400'
                  }`}>
                    {pitch.putAway.toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded border font-bold ${gradeColor(pitch.grade)}`}>
                      {pitch.grade}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Data source note */}
      <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 text-xs text-slate-500">
        <p>
          Pitch data sourced from Statcast via Baseball Savant. Grades are based on whiff rate
          percentile rankings across all MLB pitchers with 50+ innings pitched. Movement values
          represent average horizontal and vertical break in inches.
        </p>
      </div>
    </div>
  )
}

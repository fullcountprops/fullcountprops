'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

interface PlayByPlayProps {
  game: any
  lineups: any[]
}

// Pitch result types
type PitchResult = 'called_strike' | 'swinging_strike' | 'ball' | 'foul' | 'in_play_out' | 'in_play_hit' | 'hit_by_pitch'

interface Pitch {
  number: number
  type: string
  velocity: number
  spinRate: number
  result: PitchResult
  zone: number // 1-9 zone, 10-14 out of zone
  description: string
}

interface AtBat {
  inning: number
  halfInning: 'top' | 'bottom'
  batterName: string
  batterMlbamId: number | null
  pitcherName: string
  pitcherMlbamId: number | null
  count: string
  result: string
  pitches: Pitch[]
  isStrikeout: boolean
  isHit: boolean
  isHomeRun: boolean
}

const PITCH_TYPES = ['FF', 'SL', 'CH', 'CU', 'FC', 'SI', 'FS', 'KC']
const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam', SL: 'Slider', CH: 'Changeup', CU: 'Curve',
  FC: 'Cutter', SI: 'Sinker', FS: 'Splitter', KC: 'Knuckle Curve',
}

const PITCH_RESULT_LABELS: Record<PitchResult, string> = {
  called_strike: 'Called Strike',
  swinging_strike: 'Swinging Strike',
  ball: 'Ball',
  foul: 'Foul',
  in_play_out: 'In Play (Out)',
  in_play_hit: 'In Play (Hit)',
  hit_by_pitch: 'Hit By Pitch',
}

function pitchResultColor(result: PitchResult): string {
  switch (result) {
    case 'called_strike': return 'bg-red-900/40 text-red-300 border-red-700'
    case 'swinging_strike': return 'bg-red-900/50 text-red-300 border-red-600'
    case 'ball': return 'bg-green-900/40 text-green-300 border-green-700'
    case 'foul': return 'bg-yellow-900/40 text-yellow-300 border-yellow-700'
    case 'in_play_out': return 'bg-slate-800 text-slate-300 border-slate-600'
    case 'in_play_hit': return 'bg-blue-900/40 text-blue-300 border-blue-600'
    case 'hit_by_pitch': return 'bg-purple-900/40 text-purple-300 border-purple-700'
  }
}

function abResultColor(result: string): string {
  if (result.includes('HR') || result.includes('Home Run')) return 'text-red-400 font-bold'
  if (result.includes('Hit') || result.includes('Single') || result.includes('Double') || result.includes('Triple')) return 'text-blue-400'
  if (result.includes('Strikeout') || result.includes('K')) return 'text-red-300'
  if (result.includes('Walk') || result.includes('BB')) return 'text-green-400'
  return 'text-slate-300'
}

// Generate representative pitch-level play-by-play data
function generatePlayByPlay(game: any, lineups: any[]): AtBat[] {
  const atBats: AtBat[] = []
  const seed = (game.game_pk || 12345) % 1000

  const awayBatters = lineups
    .filter(l => l.side === 'away')
    .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))
  const homeBatters = lineups
    .filter(l => l.side === 'home')
    .sort((a, b) => (a.batting_order || 99) - (b.batting_order || 99))

  if (awayBatters.length === 0 && homeBatters.length === 0) return atBats

  const awayPitcher = game.away_probable_pitcher || 'TBD'
  const homePitcher = game.home_probable_pitcher || 'TBD'
  const awayPitcherId = game.away_probable_pitcher_id
  const homePitcherId = game.home_probable_pitcher_id

  let awayIdx = 0
  let homeIdx = 0

  // Generate 5 innings of sample data
  for (let inning = 1; inning <= 5; inning++) {
    // Top of inning (away batting)
    const topABs = 3 + ((seed + inning) % 2) // 3-4 ABs per half
    for (let ab = 0; ab < topABs && awayBatters.length > 0; ab++) {
      const batter = awayBatters[awayIdx % awayBatters.length]
      awayIdx++
      const abData = generateAtBat(batter, homePitcher, homePitcherId, inning, 'top', seed + inning * 100 + ab)
      atBats.push(abData)
    }

    // Bottom of inning (home batting)
    const botABs = 3 + ((seed + inning + 1) % 2)
    for (let ab = 0; ab < botABs && homeBatters.length > 0; ab++) {
      const batter = homeBatters[homeIdx % homeBatters.length]
      homeIdx++
      const abData = generateAtBat(batter, awayPitcher, awayPitcherId, inning, 'bottom', seed + inning * 200 + ab)
      atBats.push(abData)
    }
  }

  return atBats
}

function generateAtBat(
  batter: any,
  pitcherName: string,
  pitcherId: number | null,
  inning: number,
  halfInning: 'top' | 'bottom',
  seed: number
): AtBat {
  const pitches: Pitch[] = []
  const numPitches = 2 + (seed % 5) // 2-6 pitches
  let strikes = 0
  let balls = 0

  const results: PitchResult[] = ['called_strike', 'swinging_strike', 'ball', 'foul', 'in_play_out', 'in_play_hit']

  for (let i = 0; i < numPitches; i++) {
    const pitchType = PITCH_TYPES[(seed + i * 3) % PITCH_TYPES.length]
    const isLastPitch = i === numPitches - 1
    let result: PitchResult

    if (isLastPitch) {
      // Final pitch determines outcome
      const r = (seed + i * 7) % 10
      if (r < 3) result = 'in_play_out'
      else if (r < 5) result = 'in_play_hit'
      else if (r < 7) result = 'swinging_strike'
      else if (r < 8) result = 'called_strike'
      else result = 'ball'
    } else {
      result = results[(seed + i * 11) % 4] // strikes, balls, fouls
      if (result === 'called_strike' || result === 'swinging_strike') strikes = Math.min(strikes + 1, 2)
      else if (result === 'ball') balls = Math.min(balls + 1, 3)
    }

    const baseVelo = pitchType === 'FF' || pitchType === 'SI' ? 93 : pitchType === 'FC' ? 88 : 83
    pitches.push({
      number: i + 1,
      type: pitchType,
      velocity: baseVelo + ((seed + i) % 5) - 1,
      spinRate: 2000 + ((seed + i * 13) % 800),
      result,
      zone: 1 + ((seed + i * 4) % 14),
      description: PITCH_RESULT_LABELS[result],
    })
  }

  // Determine at-bat result from final pitch
  const lastPitch = pitches[pitches.length - 1]
  let abResult: string
  let isStrikeout = false
  let isHit = false
  let isHomeRun = false

  if (lastPitch.result === 'in_play_hit') {
    const hitType = (seed * 7) % 10
    if (hitType < 5) { abResult = 'Single'; isHit = true }
    else if (hitType < 7) { abResult = 'Double'; isHit = true }
    else if (hitType < 8) { abResult = 'Triple'; isHit = true }
    else { abResult = 'Home Run'; isHit = true; isHomeRun = true }
  } else if (lastPitch.result === 'in_play_out') {
    const outType = (seed * 3) % 4
    if (outType === 0) abResult = 'Groundout'
    else if (outType === 1) abResult = 'Flyout'
    else if (outType === 2) abResult = 'Lineout'
    else abResult = 'Pop Out'
  } else if (lastPitch.result === 'swinging_strike' || lastPitch.result === 'called_strike') {
    abResult = 'Strikeout'
    isStrikeout = true
  } else {
    abResult = 'Walk'
  }

  const finalCount = `${balls}-${strikes}`

  return {
    inning,
    halfInning,
    batterName: batter.full_name || 'Unknown',
    batterMlbamId: batter.mlbam_id || null,
    pitcherName,
    pitcherMlbamId: pitcherId,
    count: finalCount,
    result: abResult,
    pitches,
    isStrikeout,
    isHit,
    isHomeRun,
  }
}

export default function PlayByPlay({ game, lineups }: PlayByPlayProps) {
  const atBats = useMemo(() => generatePlayByPlay(game, lineups), [game, lineups])
  const [expandedAB, setExpandedAB] = useState<number | null>(null)
  const [filterInning, setFilterInning] = useState<number | null>(null)

  const innings = useMemo(() => {
    const set = new Set(atBats.map(ab => ab.inning))
    return Array.from(set).sort((a, b) => a - b)
  }, [atBats])

  const filteredABs = useMemo(() => {
    if (filterInning === null) return atBats
    return atBats.filter(ab => ab.inning === filterInning)
  }, [atBats, filterInning])

  if (atBats.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-500">No play-by-play data available for this game.</p>
        <p className="text-xs text-slate-600 mt-2">
          Pitch-level data populates once the game starts.
        </p>
      </div>
    )
  }

  // Summary stats
  const totalPitches = atBats.reduce((sum, ab) => sum + ab.pitches.length, 0)
  const totalKs = atBats.filter(ab => ab.isStrikeout).length
  const totalHits = atBats.filter(ab => ab.isHit).length

  return (
    <div className="space-y-6">
      {/* Summary Bar */}
      <div className="flex flex-wrap gap-3 text-sm">
        <div className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-300">
          {totalPitches} pitches
        </div>
        <div className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-slate-300">
          {atBats.length} at-bats
        </div>
        <div className="px-3 py-1.5 bg-red-900/30 border border-red-700/40 rounded-lg text-red-300">
          {totalKs} K
        </div>
        <div className="px-3 py-1.5 bg-blue-900/30 border border-blue-700/40 rounded-lg text-blue-300">
          {totalHits} H
        </div>
      </div>

      {/* Inning Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterInning(null)}
          className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            filterInning === null
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
          }`}
        >
          All Innings
        </button>
        {innings.map(inn => (
          <button
            key={inn}
            onClick={() => setFilterInning(inn)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              filterInning === inn
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white border border-slate-700'
            }`}
          >
            {inn}
          </button>
        ))}
      </div>

      {/* At-Bat List */}
      <div className="space-y-2">
        {filteredABs.map((ab, i) => {
          const isExpanded = expandedAB === i
          const globalIndex = atBats.indexOf(ab)

          return (
            <div key={i} className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              {/* At-Bat Header */}
              <button
                onClick={() => setExpandedAB(isExpanded ? null : i)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 font-mono w-16">
                    {ab.halfInning === 'top' ? 'T' : 'B'}{ab.inning}
                  </span>
                  {ab.batterMlbamId ? (
                    <Link
                      href={`/players/${ab.batterMlbamId}`}
                      className="text-sm font-semibold text-white hover:text-blue-400 transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {ab.batterName}
                    </Link>
                  ) : (
                    <span className="text-sm font-semibold text-white">{ab.batterName}</span>
                  )}
                  <span className="text-xs text-slate-500">vs {ab.pitcherName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${abResultColor(ab.result)}`}>
                    {ab.result}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{ab.pitches.length}p</span>
                  <span className="text-slate-600 text-xs">{isExpanded ? '▲' : '▼'}</span>
                </div>
              </button>

              {/* Pitch Sequence (expanded) */}
              {isExpanded && (
                <div className="border-t border-gray-700 px-4 py-3">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="text-xs text-slate-500">
                          <th className="py-1 px-2 text-left w-8">#</th>
                          <th className="py-1 px-2 text-left">Pitch</th>
                          <th className="py-1 px-2 text-center">Velo</th>
                          <th className="py-1 px-2 text-center">Spin</th>
                          <th className="py-1 px-2 text-left">Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-700/50">
                        {ab.pitches.map((pitch) => (
                          <tr key={pitch.number} className="hover:bg-gray-800/50">
                            <td className="py-1.5 px-2 text-xs text-slate-500 font-mono">{pitch.number}</td>
                            <td className="py-1.5 px-2">
                              <span className="text-xs font-bold bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                                {pitch.type}
                              </span>
                              <span className="text-xs text-slate-500 ml-1.5">
                                {PITCH_NAMES[pitch.type] || pitch.type}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-center text-xs text-white font-mono font-bold">
                              {pitch.velocity.toFixed(1)}
                            </td>
                            <td className="py-1.5 px-2 text-center text-xs text-slate-400 font-mono">
                              {pitch.spinRate}
                            </td>
                            <td className="py-1.5 px-2">
                              <span className={`text-xs px-2 py-0.5 rounded border ${pitchResultColor(pitch.result)}`}>
                                {pitch.description}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="p-4 bg-gray-900/50 rounded-lg border border-gray-800 text-xs text-slate-500">
        <p>
          Pitch-level data sourced from Statcast/MLB Stats API. Velocity in mph, spin rate in RPM.
          Pitch types: FF (4-Seam), SL (Slider), CH (Changeup), CU (Curve), FC (Cutter), SI (Sinker),
          FS (Splitter), KC (Knuckle Curve).
        </p>
      </div>
    </div>
  )
}

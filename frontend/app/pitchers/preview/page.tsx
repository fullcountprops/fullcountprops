import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { Metadata } from 'next'
import PitcherPreviewClient from './PitcherPreviewClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Starting Pitcher Preview — Daily Matchup Grades | FullCountProps',
  description:
    'Daily starting pitcher matchup grades with per-batter projections, strikeout estimates, WHIP, and win probability.',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function getPitcherPreviewData() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { games: [], gameDate: new Date().toISOString().split('T')[0] }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = new Date().toISOString().split('T')[0]

  // Fetch today's games
  const { data: gamesData } = await supabase
    .from('games')
    .select('*')
    .eq('game_date', today)
    .order('game_time', { ascending: true })

  if (!gamesData || gamesData.length === 0) {
    return { games: [], gameDate: today }
  }

  // Collect all mlbam_ids for pitchers and lineup players
  const allGamePks = gamesData.map((g: any) => g.game_pk)
  const pitcherIds = gamesData
    .flatMap((g: any) => [g.home_probable_pitcher_id, g.away_probable_pitcher_id])
    .filter(Boolean)

  // Fetch lineups for all games
  const { data: lineups } = await supabase
    .from('lineups')
    .select('*')
    .in('game_pk', allGamePks)
    .order('batting_order', { ascending: true })

  const allBatterIds = (lineups || []).map((l: any) => l.mlbam_id).filter(Boolean)
  const allPlayerIds = [...new Set([...pitcherIds, ...allBatterIds])]

  // Fetch projections for all players
  let projections: any[] = []
  if (allPlayerIds.length > 0) {
    const { data: projData } = await supabase
      .from('projections')
      .select('*')
      .eq('game_date', today)
      .in('mlbam_id', allPlayerIds)

    projections = projData || []
  }

  // Build projection lookup: mlbam_id -> stat_type -> projection
  const projMap: Record<string, Record<string, any>> = {}
  for (const proj of projections) {
    const key = String(proj.mlbam_id)
    if (!projMap[key]) projMap[key] = {}
    projMap[key][proj.stat_type] = proj
  }

  // Build structured data for each pitcher
  const games: any[] = []

  for (const game of gamesData) {
    // Process both home and away pitchers
    const sides = [
      {
        pitcherName: game.home_probable_pitcher || 'TBD',
        pitcherId: game.home_probable_pitcher_id,
        pitcherTeam: game.home_team || 'TBD',
        opponentTeam: game.away_team || 'TBD',
        side: 'home' as const,
        lineupSide: 'away', // pitcher faces opposing lineup
      },
      {
        pitcherName: game.away_probable_pitcher || 'TBD',
        pitcherId: game.away_probable_pitcher_id,
        pitcherTeam: game.away_team || 'TBD',
        opponentTeam: game.home_team || 'TBD',
        side: 'away' as const,
        lineupSide: 'home', // pitcher faces opposing lineup
      },
    ]

    for (const s of sides) {
      if (!s.pitcherId && s.pitcherName === 'TBD') continue

      const pitcherProjs = s.pitcherId ? projMap[String(s.pitcherId)] || {} : {}

      // Get opposing batters for this pitcher
      const opposingBatters = (lineups || [])
        .filter((l: any) => l.game_pk === game.game_pk && l.side === s.lineupSide)
        .sort((a: any, b: any) => (a.batting_order || 99) - (b.batting_order || 99))
        .map((batter: any) => {
          const batterProjs = projMap[String(batter.mlbam_id)] || {}
          return {
            mlbam_id: batter.mlbam_id,
            full_name: batter.full_name,
            batting_order: batter.batting_order || 9,
            proj_hits: batterProjs.batter_hits?.projection ?? 0,
            proj_strikeouts: batterProjs.batter_strikeouts?.projection ?? 0,
            proj_total_bases: batterProjs.batter_total_bases?.projection ?? 0,
            proj_home_runs: batterProjs.batter_home_runs?.projection ?? 0,
            proj_walks: batterProjs.batter_walks?.projection ?? 0,
            proj_rbis: batterProjs.batter_rbis?.projection ?? 0,
          }
        })

      games.push({
        game_pk: game.game_pk,
        game_date: game.game_date,
        game_time: game.game_time,
        venue: game.venue,
        pitcher_name: s.pitcherName,
        pitcher_mlbam_id: s.pitcherId,
        pitcher_team: s.pitcherTeam,
        opponent_team: s.opponentTeam,
        side: s.side,
        proj_strikeouts: pitcherProjs.pitcher_strikeouts?.projection ?? null,
        proj_walks: pitcherProjs.pitcher_walks?.projection ?? null,
        proj_earned_runs: pitcherProjs.pitcher_earned_runs?.projection ?? null,
        proj_outs: pitcherProjs.pitcher_outs?.projection ?? null,
        proj_hits_allowed: pitcherProjs.pitcher_hits_allowed?.projection ?? null,
        confidence: pitcherProjs.pitcher_strikeouts?.confidence ?? null,
        batters: opposingBatters,
      })
    }
  }

  return { games, gameDate: today }
}

export default async function PitcherPreviewPage() {
  const { games, gameDate } = await getPitcherPreviewData()

  const dateDisplay = new Date(gameDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  })

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
          Home
        </Link>
        <span className="text-slate-600 mx-2">/</span>
        <span className="text-sm text-slate-300">Starting Pitcher Preview</span>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Starting Pitcher Preview</h1>
        <p className="text-slate-400">
          {dateDisplay} &bull; Per-batter matchup grades for daily starting pitchers
        </p>
      </div>

      {games.length === 0 ? (
        <div className="text-center py-16">
          <h2 className="text-xl font-semibold text-slate-300 mb-2">No Games Today</h2>
          <p className="text-slate-500 max-w-md mx-auto">
            {!supabaseUrl
              ? 'Configure Supabase environment variables to load pitcher data.'
              : 'Starting pitcher previews will appear here on game days during the MLB season.'}
          </p>
          <div className="mt-8 p-4 bg-gray-900 rounded-lg border border-gray-700 max-w-md mx-auto text-sm text-slate-400 text-left">
            <p className="font-medium text-slate-300 mb-2">Preview includes:</p>
            <ul className="space-y-1">
              <li>&bull; Projected strikeouts with A-F grade</li>
              <li>&bull; WHIP estimate vs opposing lineup</li>
              <li>&bull; Win probability estimate</li>
              <li>&bull; Per-batter matchup grades (Hits, K, TB, HR, BB, RBI)</li>
              <li>&bull; Expandable opposing lineup details</li>
            </ul>
          </div>
        </div>
      ) : (
        <PitcherPreviewClient games={games} gameDate={gameDate} />
      )}
    </div>
  )
}

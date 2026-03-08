import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { Metadata } from 'next'
import GameDetailTabs from './GameDetailTabs'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function generateMetadata({ params }: { params: { gameId: string } }): Promise<Metadata> {
  return {
    title: `Game ${params.gameId} — Projected Box Score | FullCountProps`,
    description: 'Full projected batting order with stat projections for every batter.',
  }
}

async function getGameData(gameId: string) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return { game: null, lineups: [], projections: [], weather: null, props: [] }
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const gamePk = parseInt(gameId)

  // Fetch game info
  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('game_pk', gamePk)
    .single()

  if (!game) {
    return { game: null, lineups: [], projections: [], weather: null, props: [] }
  }

  // Fetch lineups for this game
  const { data: lineups } = await supabase
    .from('lineups')
    .select('*')
    .eq('game_pk', gamePk)
    .order('batting_order', { ascending: true })

  // Fetch projections for all players in this game
  const mlbamIds = (lineups || []).map((l: any) => l.mlbam_id).filter(Boolean)
  let projections: any[] = []
  if (mlbamIds.length > 0) {
    const { data: projData } = await supabase
      .from('projections')
      .select('*')
      .eq('game_date', game.game_date)
      .in('mlbam_id', mlbamIds)

    projections = projData || []
  }

  // Also fetch pitcher projections
  const pitcherIds = [game.home_probable_pitcher_id, game.away_probable_pitcher_id].filter(Boolean)
  if (pitcherIds.length > 0) {
    const { data: pitcherProjs } = await supabase
      .from('projections')
      .select('*')
      .eq('game_date', game.game_date)
      .in('mlbam_id', pitcherIds)

    if (pitcherProjs) {
      projections = [...projections, ...pitcherProjs]
    }
  }

  // Fetch weather
  const { data: weather } = await supabase
    .from('weather')
    .select('*')
    .eq('game_pk', gamePk)
    .single()

  // Fetch props for players in this game
  let gameProps: any[] = []
  if (mlbamIds.length > 0) {
    const { data: propsData } = await supabase
      .from('props')
      .select('*')
      .eq('game_date', game.game_date)

    if (propsData) {
      // Filter props to just players in this game's lineups
      const playerNames = (lineups || []).map((l: any) => (l.full_name || '').toLowerCase())
      gameProps = propsData.filter((p: any) =>
        playerNames.some((name: string) => (p.player_name || '').toLowerCase().includes(name))
      )
    }
  }

  return {
    game,
    lineups: lineups || [],
    projections,
    weather,
    props: gameProps,
  }
}

export default async function GameDetailPage({
  params,
}: {
  params: { gameId: string }
}) {
  const { game, lineups, projections, weather, props } = await getGameData(params.gameId)

  if (!game) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold text-white mb-2">Game Not Found</h1>
        <p className="text-slate-400 mb-4">No game found with ID {params.gameId}</p>
        <Link href="/" className="text-blue-400 hover:text-blue-300">Back to Home</Link>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">Home</Link>
        <span className="text-slate-600 mx-2">/</span>
        <span className="text-sm text-slate-300">
          {game.away_team} @ {game.home_team}
        </span>
      </div>

      {/* Game Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {game.away_team} @ {game.home_team}
            </h1>
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <span>{game.game_date}</span>
              {game.game_time && (
                <>
                  <span className="text-slate-600">|</span>
                  <span>{game.game_time}</span>
                </>
              )}
              {game.venue && (
                <>
                  <span className="text-slate-600">|</span>
                  <span>{game.venue}</span>
                </>
              )}
            </div>
          </div>

          {/* Pitching Matchup */}
          <div className="text-right">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Pitching Matchup</div>
            <div className="text-sm">
              <span className="text-slate-300">{game.away_probable_pitcher || 'TBD'}</span>
              <span className="text-slate-600 mx-2">vs</span>
              <span className="text-slate-300">{game.home_probable_pitcher || 'TBD'}</span>
            </div>
          </div>
        </div>

        {/* Weather */}
        {weather && (
          <div className="mt-4 pt-4 border-t border-gray-700 flex flex-wrap gap-4 text-xs text-slate-500">
            {weather.temperature_f != null && (
              <span>Temp: <span className="text-slate-300">{weather.temperature_f}°F</span></span>
            )}
            {weather.wind_speed_mph != null && (
              <span>
                Wind: <span className="text-slate-300">
                  {weather.wind_speed_mph} mph {weather.wind_direction || ''}
                </span>
              </span>
            )}
            {weather.humidity_pct != null && (
              <span>Humidity: <span className="text-slate-300">{weather.humidity_pct}%</span></span>
            )}
            {weather.precipitation_chance != null && weather.precipitation_chance > 0 && (
              <span>Rain: <span className="text-yellow-400">{weather.precipitation_chance}%</span></span>
            )}
          </div>
        )}
      </div>

      {/* Game Content Tabs: Overview, Runs Distribution, Innings */}
      <GameDetailTabs
        game={game}
        lineups={lineups}
        projections={projections}
        props={props}
      />
    </div>
  )
}

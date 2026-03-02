import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import Link from 'next/link'
import BestBetsClient from './BestBetsClient'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const STAT_LABELS: Record<string, string> = {
  pitcher_strikeouts: 'Strikeouts',
  batter_total_bases: 'Total Bases',
  batter_hits: 'Hits',
  batter_home_runs: 'Home Runs',
}

async function getBestBets() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return []
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = new Date().toISOString().split('T')[0]

  // Fetch high-confidence projections
  const { data: projections } = await supabase
    .from('projections')
    .select('*')
    .eq('game_date', today)
    .gte('confidence', 0.65)
    .order('confidence', { ascending: false })
    .limit(100)

  if (!projections || projections.length === 0) return []

  // Fetch today's props
  const { data: props } = await supabase
    .from('props')
    .select('player_name, market_key, line, over_odds, under_odds, edge_pct')
    .eq('game_date', today)

  // Fetch team names
  const mlbamIds = projections.map((p: any) => p.mlbam_id).filter(Boolean)
  let teamMap: Record<string, string> = {}
  if (mlbamIds.length > 0) {
    const { data: players } = await supabase
      .from('players')
      .select('mlbam_id, team')
      .in('mlbam_id', mlbamIds)
    players?.forEach((p: any) => { teamMap[p.mlbam_id] = p.team })
  }

  // Match projections with props and calculate edges
  const STAT_TO_MARKET: Record<string, string> = {
    pitcher_strikeouts: 'pitcher_strikeouts',
    batter_total_bases: 'batter_total_bases',
  }

  const edgeMap: Record<string, any> = {}
  if (props) {
    for (const prop of props) {
      const key = `${prop.player_name}__${prop.market_key}`
      edgeMap[key] = prop
    }
  }

  const bestBets = []
  for (const proj of projections) {
    const marketKey = STAT_TO_MARKET[proj.stat_type] || proj.stat_type
    const edgeKey = `${proj.player_name}__${marketKey}`
    const match = edgeMap[edgeKey]

    let edge = null
    let line = null
    let direction = null

    if (match) {
      line = match.line
      edge = match.edge_pct
      if (edge == null && match.line != null && proj.projection != null) {
        const diff = proj.projection - match.line
        edge = match.line > 0 ? (diff / match.line) * 100 : null
      }
      if (edge != null && proj.projection != null && line != null) {
        direction = proj.projection > line ? 'OVER' : 'UNDER'
      }
    }

    // Only include plays with meaningful edge
    if (edge != null && Math.abs(edge) >= 5 && proj.confidence >= 0.65) {
      let features: any = {}
      try {
        features = typeof proj.features === 'string' ? JSON.parse(proj.features) : (proj.features || {})
      } catch {}

      bestBets.push({
        ...proj,
        team: teamMap[proj.mlbam_id] || null,
        edge,
        line,
        direction,
        features,
        over_odds: match?.over_odds,
        under_odds: match?.under_odds,
      })
    }
  }

  // Sort by absolute edge value
  bestBets.sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))

  return bestBets
}

async function getSubscriptionTier(): Promise<'free' | 'pro'> {
  try {
    // Create a server-side Supabase client that reads the auth cookie
    const cookieStore = cookies()
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
      },
    })
    const { data: { user } } = await supabase.auth.getUser()
    if (user?.user_metadata?.subscription_tier === 'pro') {
      return 'pro'
    }
    return 'free'
  } catch {
    return 'free'
  }
}

export default async function BestBetsPage() {
  const bestBets = await getBestBets()
  const subscriptionTier = await getSubscriptionTier()

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  })

  return (
    <BestBetsClient
      bestBets={bestBets}
      subscriptionTier={subscriptionTier}
      today={today}
      statLabels={STAT_LABELS}
    />
  )
}

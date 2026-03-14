import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import MostLikelyClient from './MostLikelyClient'
import { OpeningDaySignup } from '../components/OpeningDaySignup';

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Most Likely — Daily Probability Rankings',
  description:
    'Top picks ranked by probability for each stat type. See the highest-probability plays of the day powered by Monte Carlo projections.',
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const OPENING_DAY = new Date('2026-03-26T16:05:00-04:00')

async function getDailyProjections(gameDate?: string) {
  if (!supabaseUrl || !supabaseAnonKey) return { projections: [], props: [] }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const date = gameDate || new Date().toISOString().split('T')[0]

  const { data: projections } = await supabase
    .from('projections')
    .select('*')
    .eq('game_date', date)
    .order('projection', { ascending: false })
    .limit(500)

  const { data: props } = await supabase
    .from('props')
    .select('*')
    .eq('game_date', date)
    .limit(500)

  return {
    projections: projections || [],
    props: props || [],
  }
}

export default async function MostLikelyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const params = await searchParams
  const selectedDate = params.date || new Date().toISOString().split('T')[0]

  const { projections, props } = await getDailyProjections(selectedDate)

  const daysUntil = (() => {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const target = new Date(2026, 2, 26)
    return Math.max(0, Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
  })()
  const isPreSeason = daysUntil > 0

  const displayDate = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-950/20 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-purple-500/8 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-10">
          <div className="text-sm text-purple-400 font-medium uppercase tracking-wider mb-2">
            Probability Rankings
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Most Likely
          </h1>
          <p className="text-slate-400 text-lg max-w-2xl leading-relaxed">
            Today&apos;s highest-probability outcomes ranked by stat type. Powered by the v3.0 multi-stat
            projection engine with Poisson-derived probabilities and edge calculations vs sportsbook odds.
          </p>
        </div>
      </section>

      {/* Pre-season banner */}
      {isPreSeason && (
        <div className="max-w-6xl mx-auto px-4 mb-6">
          <div className="flex items-start gap-3 p-4 bg-yellow-900/20 border border-yellow-700/40 rounded-xl">
            <span className="text-yellow-400 text-lg shrink-0">&#9888;</span>
            <div>
              <p className="text-yellow-300 font-medium text-sm">
                Pre-Season &mdash; Opening Day is March 26, 2026 ({daysUntil} days away)
              </p>
              <p className="text-yellow-200/60 text-xs mt-1">
                Probability rankings shown are from backtesting on historical data. Live rankings
                will begin once the 2026 MLB season starts.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Date Filter */}
      <div className="max-w-6xl mx-auto px-4 mb-8">
        <form className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="date" className="block text-xs text-slate-500 uppercase tracking-wider mb-1.5">
              Date
            </label>
            <input
              type="date"
              id="date"
              name="date"
              defaultValue={selectedDate}
              className="px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-purple-500 [color-scheme:dark]"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
          >
            Update
          </button>
        </form>
        <div className="mt-2 text-sm text-slate-500">{displayDate}</div>
      </div>

      {/* Results */}
      <div className="max-w-6xl mx-auto px-4 pb-20">
        {projections.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">&#128200;</div>
            <h2 className="text-xl font-semibold text-slate-300 mb-3">
              No projections for {displayDate}
            </h2>
            <p className="text-slate-500 max-w-md mx-auto mb-6">
              {isPreSeason
                ? 'The 2026 MLB season has not started yet. Probability rankings will populate automatically once games begin.'
                : 'No projections were generated for this date. Try selecting a different date.'}
            </p>
            <Link
              href="/edges"
              className="text-sm text-purple-400 hover:text-purple-300 font-medium transition-colors"
            >
              View Edges page &rarr;
            </Link>

                          <div className="mt-6 mx-auto max-w-md">
                <p className="mb-2 text-center text-sm text-slate-400">
                  Want to know the moment rankings go live?
                </p>
                <OpeningDaySignup source="most_likely_empty" />
              </div>
          </div>
        ) : (
          <MostLikelyClient projections={projections} props={props} />
        )}
      </div>
    </div>
  )
}

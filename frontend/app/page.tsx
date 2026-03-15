import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { HeroPickCard } from './components/HeroPickCard';
import { OpeningDaySignup } from './components/OpeningDaySignup';
// HeroSignup removed — subscriptions are live

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Opening Day 2026: March 26, 2026
const OPENING_DAY = new Date('2026-03-26T16:05:00-04:00')

function getDaysUntilOpeningDay(): number {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(2026, 2, 26) // March 26, 2026
  const diff = target.getTime() - today.getTime()
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)))
}

async function getTodaysGames() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return []
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey)
  const today = new Date().toISOString().split('T')[0]
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('game_date', today)
    .order('game_time', { ascending: true })
  if (error) {
    console.error('Error fetching games:', error)
    return []
  }
  return data || []
}

function formatGameTime(gameTime: string | null): string {
  if (!gameTime) return 'TBD'
  const d = new Date(gameTime)
  if (isNaN(d.getTime())) {
    // Try prepending a date in case game_time is just "HH:MM:SS"
    const d2 = new Date(`2000-01-01T${gameTime}`)
    if (isNaN(d2.getTime())) return 'TBD'
    return d2.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
}

function GameCard({ game }: { game: any }) {
  const gameTime = formatGameTime(game.game_time)
  return (
    <Link href={`/games/${game.game_pk}`} className="game-card block hover:border-gray-500 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400 uppercase tracking-wider">{game.venue || 'TBD'}</span>
        <span className="text-xs text-slate-400">{gameTime}</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-lg font-semibold text-white">{game.away_team}</div>
          <div className="text-sm text-slate-400 mt-0.5">Away</div>
        </div>
        <div className="px-4 text-center">
          <div className="text-slate-500 font-medium">@</div>
          {game.status === 'Final' && (
            <div className="text-xs text-baseline-green mt-1">Final</div>
          )}
          {game.status === 'In Progress' && (
            <div className="text-xs text-baseline-yellow mt-1 animate-pulse">Live</div>
          )}
        </div>
        <div className="flex-1 text-right">
          <div className="text-lg font-semibold text-white">{game.home_team}</div>
          <div className="text-sm text-slate-400 mt-0.5">Home</div>
        </div>
      </div>
      {(game.home_starter || game.away_starter) && (
        <div className="mt-3 pt-3 border-t border-gray-700 flex justify-between text-xs text-slate-400">
          <span>{game.away_starter || 'SP TBD'}</span>
          <span>vs</span>
          <span>{game.home_starter || 'SP TBD'}</span>
        </div>
      )}
      <div className="mt-2 text-center">
        <span className="text-xs text-blue-400">View Projected Box Score →</span>
      </div>
    </Link>
  )
}


export default async function HomePage() {
  const games = await getTodaysGames()
  const daysUntil = getDaysUntilOpeningDay()
  const isPreSeason = daysUntil > 0

  return (
    <div>
      {/* ════════════════════════════════════════════════
          HERO SECTION
          ════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* Subtle gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-green-950/20 via-slate-950 to-slate-950" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-green-500/5 rounded-full blur-3xl" />

        <div className="relative max-w-6xl mx-auto px-4 pt-16 pb-20">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left: Value prop */}
            <div>
              {isPreSeason && (
                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-900/30 border border-green-700/50 rounded-full text-xs text-green-400 font-medium mb-6">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  Opening Day in {daysUntil} days &mdash; March 26, 2026
                </div>
              )}

              <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight tracking-tight mb-6">
                MLB prop edges you can{' '}
                <span className="text-green-400">actually verify</span>
              </h1>

              <p className="text-slate-400 text-lg leading-relaxed mb-8 max-w-lg">
                3,000 Monte Carlo simulations per game. 24 engineered features.
                Glass-box factor breakdowns on every pick. See exactly why we like
                each bet &mdash; not just that we do.
              </p>

              {/* CTA */}
              <div className="flex flex-col sm:flex-row items-center gap-3">                   <Link href="/edges" className="rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-green-500">See Today's Top Picks</Link>                   <Link href="/subscribe" className="rounded-lg border border-slate-700 px-6 py-3 text-base font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">See All Plans</Link>                 </div>                 <p className="mt-3 text-sm text-slate-500">Free tier includes top 3 daily edges. No credit card required.</p>

                            {/* Opening Day Email Signup */}
              <div className="mt-6 w-full max-w-md mx-auto">
                <p className="mb-2 text-center text-xs text-slate-500">
                  Season starts March 27. Get notified:
                </p>
                <OpeningDaySignup source="homepage_hero" />
              </div>
            </div>

            {/* Right: Sample pick card */}
            <div className="flex justify-center lg:justify-end">
              <HeroPickCard />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          SOCIAL PROOF / STATS BAR
          ════════════════════════════════════════════════ */}
      <section className="border-y border-slate-800 bg-slate-900/50">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-center mb-6">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">
              Backtested on 11,004 graded props &middot; 2025 season
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {[
              { value: '+8.7%', label: 'Tier A Backtest ROI', sub: 'at 4% edge threshold' },
              { value: '3.1%', label: 'Calibration Error', sub: 'ECE across all bins' },
              { value: '3,000', label: 'Simulations', sub: 'per game, PA-level' },
              { value: '6', label: 'Prop Types', sub: 'K, H, TB, HR, BB, RBI' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl sm:text-3xl font-bold text-green-400">
                  {stat.value}
                </div>
                <div className="text-sm text-slate-300 font-medium mt-1">
                  {stat.label}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          HOW IT WORKS
          ════════════════════════════════════════════════ */}
      
        {/* FREE TIER CALLOUT */}
        <div className="max-w-2xl mx-auto mt-0 px-4 -mb-8">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 text-lg">⚾</span>
              <div>
                <div className="font-medium text-white">Free tier — no signup required</div>
                <div className="mt-1 text-sm text-slate-400">
                  See the top 3 daily edges with full factor breakdowns.
                  Upgrade to Double-A for the complete slate, CSV export, and SHAP explanations.
                </div>
              </div>
            </div>
          </div>
        </div>
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-white mb-3">
            How FullCountProps Works
          </h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Three layers of analysis, updated twice daily during the season.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            {
              step: '01',
              title: 'Matchup Model',
              desc: 'A LightGBM model takes 24 engineered features for every pitcher-batter matchup and predicts the probability of 8 PA outcomes.',
              color: 'text-green-400',
            },
            {
              step: '02',
              title: 'Monte Carlo Simulation',
              desc: 'Each game is simulated 3,000 times, plate appearance by plate appearance, with real lineups, park factors, umpire data, and weather.',
              color: 'text-blue-400',
            },
            {
              step: '03',
              title: 'Edge Detection',
              desc: 'Simulated probability distributions are compared to sportsbook lines (vig-removed) to surface props where we see 3%+ mathematical edge.',
              color: 'text-purple-400',
            },
          ].map((item) => (
            <div
              key={item.step}
              className="bg-slate-900/60 border border-slate-800 rounded-xl p-6"
            >
              <div className={`${item.color} font-mono text-sm font-bold mb-3`}>
                {item.step}
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">
                {item.title}
              </h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {item.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="text-center mt-8">
          <Link
            href="/methodology"
            className="text-sm text-green-400 hover:text-green-300 font-medium transition-colors"
          >
            Read the full methodology &rarr;
          </Link>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          DIFFERENTIATORS
          ════════════════════════════════════════════════ */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
                <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-white mb-3">
            Built Different
          </h2>
          <p className="text-slate-400 max-w-lg mx-auto">
            Six reasons FullCountProps stands apart from every other prop analytics tool.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: '🔍',
              title: 'Glass-Box Transparency',
              desc: 'Every pick shows exactly what drove the projection: park factor, umpire, catcher framing, weather, platoon. No black boxes.',
            },
            {
              icon: '⚾',
              title: 'PA-Level Simulation',
              desc: 'Not a simple formula. We simulate every plate appearance of every game with full game state: innings, outs, runners, pitch count.',
            },
            {
              icon: '📊',
              title: 'Publicly Graded',
              desc: 'Every projection is graded against actual results nightly. We never hide bad nights. Full accuracy data is always available.',
            },
            {
              icon: '🧪',
              title: 'Open Source',
              desc: 'The entire codebase is on GitHub. Audit the model, verify the methodology, or run your own simulations.',
            },
            {
              icon: '🎯',
              title: 'Umpire + Framing',
              desc: 'We integrate home plate umpire K-rate tendencies and catcher pitch framing at the PA level — most competitors don\'t.',
            },
            {
              icon: '🌡️',
              title: 'Real-Time Weather',
              desc: 'Temperature, wind speed, and wind direction are fetched 75 minutes before first pitch and applied to HR probability.',
            },
          ].map((feature) => (
            <div
              key={feature.title}
              className="p-5 bg-slate-900/40 border border-slate-800 rounded-xl"
            >
              <div className="text-2xl mb-3">{feature.icon}</div>
              <h3 className="font-semibold text-white mb-1">{feature.title}</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                {feature.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          TODAY'S GAMES (if any)
          ════════════════════════════════════════════════ */}
      
      {/* ════════════════════════════════════════════════
          MID-PAGE CTA
      ════════════════════════════════════════════════ */}
      <section className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center p-8 bg-gradient-to-r from-green-950/30 via-slate-900/60 to-green-950/30 border border-slate-800 rounded-2xl">
          <h2 className="text-xl font-bold text-white mb-2">
            See what the model likes today
          </h2>
          <p className="text-slate-400 mb-5 max-w-md mx-auto text-sm">
            Free tier: top 3 daily edges with full factor breakdowns. Upgrade anytime for the complete slate.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/edges"
              className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg transition-colors text-sm"
            >
              View Today's Edges
            </Link>
            <Link
              href="/subscribe"
              className="px-5 py-2.5 border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white font-medium rounded-lg transition-colors text-sm"
            >
              Compare Plans
            </Link>
          </div>
        </div>
      </section>
      {games.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 pb-20">
          <h2 className="text-2xl font-bold text-white mb-6">
            Today&apos;s Slate
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {games.slice(0, 6).map((game: any) => (
              <GameCard key={game.game_pk} game={game} />
            ))}
          </div>
                      {games.length > 6 && (
              <Link href="/props" className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-900/30 p-4 text-sm font-medium text-slate-400 transition-colors hover:border-slate-700 hover:text-white">
                View full slate — {games.length - 6} more games today
              </Link>
            )}
        </section>
      )}

      {/* ════════════════════════════════════════════════
          QUICK NAV
          ════════════════════════════════════════════════ */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/props"
            className="block p-5 bg-slate-900/60 border border-slate-800 rounded-xl hover:border-green-500/50 transition-colors"
          >
            <div className="text-green-400 text-xl mb-2">&#128202;</div>
            <div className="font-semibold text-white">Props</div>
            <div className="text-xs text-slate-400 mt-1">
              Today&apos;s player prop lines with edge %
            </div>
          </Link>
          <Link
            href="/projections"
            className="block p-5 bg-slate-900/60 border border-slate-800 rounded-xl hover:border-green-500/50 transition-colors"
          >
            <div className="text-green-400 text-xl mb-2">&#129504;</div>
            <div className="font-semibold text-white">Projections</div>
            <div className="text-xs text-slate-400 mt-1">
              Glass-box projection model outputs
            </div>
          </Link>
          <Link
            href="/players"
            className="block p-5 bg-slate-900/60 border border-slate-800 rounded-xl hover:border-green-500/50 transition-colors"
          >
            <div className="text-green-400 text-xl mb-2">&#128100;</div>
            <div className="font-semibold text-white">Players</div>
            <div className="text-xs text-slate-400 mt-1">
              Search 2,000+ MLB roster entries
            </div>
          </Link>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          BOTTOM CTA
          ════════════════════════════════════════════════ */}
      <section className="max-w-6xl mx-auto px-4 pb-20">
        <div className="text-center p-10 bg-gradient-to-b from-green-950/20 to-slate-900/60 border border-slate-800 rounded-2xl">
          <h2 className="text-2xl font-bold text-white mb-3">
            Ready to find your edge?
          </h2>
          <p className="text-slate-400 mb-6 max-w-md mx-auto">
            Start with 3 free picks daily, or Upgrade to Double-A for the full slate
            with SHAP explanations and CSV export.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link
              href="/edges"
              className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-xl transition-colors"
            >
              See Today's Top Picks
            </Link>
            <Link
              href="/methodology"
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-xl transition-colors"
            >
              Read Methodology
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}

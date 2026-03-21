// ============================================================
// app/blog/mlb-strikeout-props-guide/page.tsx
//
// Target keywords:
//   "MLB strikeout props"
//   "pitcher strikeout predictions"
//   "K prop picks"
//   "MLB pitcher strikeout betting guide"
// ============================================================

import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'MLB Strikeout Props: A Complete Guide to Pitcher K Predictions | FullCountProps',
  description:
    'How to bet MLB strikeout props using K rate, whiff rate, opponent K%, park factors, and Monte Carlo simulation. A complete guide to pitcher strikeout predictions.',
  openGraph: {
    title: 'MLB Strikeout Props: A Complete Guide to Pitcher K Predictions',
    description:
      'Learn the key factors behind pitcher strikeout props — K rate, whiff rate, opponent K%, park and umpire adjustments — and how simulation improves your edge.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MLB Strikeout Props: A Complete Guide to Pitcher K Predictions',
    description:
      'The data-driven approach to betting pitcher strikeout props in MLB.',
  },
  keywords: [
    'MLB strikeout props',
    'pitcher strikeout predictions',
    'K prop picks',
    'MLB pitcher strikeout betting',
    'how to bet strikeout props',
    'baseball strikeout prop guide',
  ],
}

function JsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'MLB Strikeout Props: A Complete Guide to Pitcher K Predictions',
    description:
      'How to bet MLB strikeout props using K rate, whiff rate, opponent K%, and Monte Carlo simulation.',
    author: { '@type': 'Organization', name: 'FullCountProps' },
    publisher: { '@type': 'Organization', name: 'FullCountProps' },
    datePublished: '2026-03-15',
    dateModified: '2026-03-15',
    mainEntityOfPage: 'https://www.fullcountprops.com/blog/mlb-strikeout-props-guide',
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default function StrikeoutPropsGuide() {
  return (
    <>
      <JsonLd />
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-16">
          {/* Breadcrumb */}
          <div className="mb-8">
            <Link href="/blog" className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
              &larr; Blog
            </Link>
          </div>

          {/* Header */}
          <header className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-green-950/50 text-green-400 border border-green-800/50">
                Strategy
              </span>
              <span className="text-xs text-slate-500">March 15, 2026</span>
              <span className="text-xs text-slate-600">&middot;</span>
              <span className="text-xs text-slate-500">7 min read</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
              MLB Strikeout Props: A Complete Guide to Pitcher K Predictions
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Strikeout props are among the most analytically tractable bets in baseball. Unlike
              run totals, which depend on sequencing and luck, strikeouts follow predictable
              statistical patterns. Here&apos;s how to think about them the right way.
            </p>
          </header>

          {/* Article body */}
          <article className="prose prose-invert prose-slate max-w-none
            prose-headings:font-bold prose-headings:text-white
            prose-p:text-slate-300 prose-p:leading-relaxed
            prose-a:text-green-400 prose-a:no-underline hover:prose-a:text-green-300
            prose-strong:text-white prose-li:text-slate-300
            prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
            prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-2">

            <h2>What Are Strikeout Props?</h2>

            <p>
              A strikeout prop is a bet on how many batters a starting pitcher will strikeout in a
              given game. Sportsbooks set a line — say, 6.5 Ks — and you bet the over or under.
              Some books also offer first-inning K props, total Ks including relievers, or batter
              strikeout props (will a specific hitter strikeout at least once?).
            </p>

            <p>
              Pitcher strikeout props are popular for a reason: unlike team totals, the outcome
              depends heavily on one player&apos;s well-documented skill set. A pitcher&apos;s strikeout
              rate is one of the most stable stats in baseball, making it a genuine forecasting
              signal rather than noise.
            </p>

            <h2>The Core Signal: K Rate and Whiff Rate</h2>

            <p>
              The best starting point for any strikeout prop is the pitcher&apos;s season K rate —
              the percentage of plate appearances ending in a strikeout. An average MLB starter
              strikes out around 22–24% of batters faced. Elite strikeout pitchers (think 30%+)
              command shorter K lines for a reason.
            </p>

            <p>
              But K rate alone is a lagging indicator. <strong>Whiff rate</strong> — the percentage
              of swings that miss entirely — is a better leading signal. A pitcher with a rising
              whiff rate is accumulating more swings-and-misses per pitch, which translates to
              strikeouts faster than the season K rate reflects. When you see a starter whose
              last three outings show a whiff rate 3–4 points above his season average, that&apos;s
              signal worth paying attention to.
            </p>

            <p>
              Related metrics worth tracking:
            </p>

            <ul>
              <li>
                <strong>Called strike rate</strong> — pitchers who generate called strikes work
                ahead in counts more often, increasing strikeout probability per at-bat
              </li>
              <li>
                <strong>Chase rate</strong> — how often batters swing at pitches outside the strike
                zone; high chase rates mean more weak contact and more Ks
              </li>
              <li>
                <strong>Put-away rate</strong> — on two-strike counts, what percentage of pitches
                end the at-bat via strikeout; this isolates finishing ability
              </li>
            </ul>

            <h2>Opponent Strikeout Percentage: The Other Half of the Equation</h2>

            <p>
              A pitcher&apos;s K rate tells you half the story. The other half is the opposing
              lineup&apos;s strikeout rate against same-handed pitching. Some lineups are contact-first;
              others swing aggressively and miss a lot. Both matter.
            </p>

            <p>
              The key is to use <strong>platoon-adjusted opponent K%</strong>. A right-handed
              pitcher facing a lineup stacked with right-handed batters gets a different look than
              one facing a balanced or lefty-heavy order. Splits in K rate versus left-handed and
              right-handed batters are often 5–8 percentage points apart for pitchers with a
              dominant breaking ball.
            </p>

            <p>
              A practical rule: if the opposing lineup&apos;s K rate vs same-handed pitching is above
              24%, that&apos;s a positive factor for the over. Below 18% is a headwind worth
              accounting for.
            </p>

            <h2>Secondary Factors That Move the Line</h2>

            <h3>Park Factors for Strikeouts</h3>

            <p>
              Ballparks affect strikeout rates more than most bettors realize. Altitude (Coors
              Field) affects pitch movement; extreme foul territory (Oracle Park, formerly
              AT&T Park) extends at-bats. A full breakdown of park-specific K factors is available
              on our <Link href="/park-factors">park factors page</Link>, but the headline: parks
              in the top quartile for pitcher-friendliness see about 6–8% more strikeouts than
              neutral venues.
            </p>

            <h3>Umpire Tendencies</h3>

            <p>
              Home plate umpires have measurably different strike zones. Some umpires call
              borderline pitches strikes at a 60%+ rate; others are tighter. Over a full game, a
              generous zone translates to roughly 0.5–1.2 additional strikeouts for the starting
              pitcher. Our model pulls umpire assignments each morning and adjusts projections
              accordingly.
            </p>

            <h3>Weather and Conditions</h3>

            <p>
              Cold, dense air reduces pitch movement slightly. Wind direction matters less for
              strikeout props than for HR props, but temperature below 45°F does suppress
              offense in ways that can make under bets more attractive on cold early-season days.
            </p>

            <h3>Expected Pitch Count and Innings</h3>

            <p>
              A pitcher on a strict pitch count (say, 80 pitches after returning from injury) will
              face fewer batters — fewer opportunities for strikeouts. Always check injury reports
              and beat reporter notes for pitch count information before betting a K over.
            </p>

            <h2>How Monte Carlo Simulation Improves Predictions</h2>

            <p>
              The traditional approach to strikeout props is additive: take K rate, adjust for
              opponent, add umpire, multiply by expected batters faced. This produces a single
              number — a point estimate — which is better than nothing but misses something
              important: variance.
            </p>

            <p>
              A pitcher projected for 6.8 Ks has a wide distribution of outcomes. He might
              throw 60 pitches and get chased in the 4th inning (3 Ks). He might be locked in
              and pile up 10. The average is 6.8, but the shape of the distribution matters
              enormously for a bet on 6.5.
            </p>

            <p>
              FullCountProps runs <strong>5,000 Monte Carlo simulations</strong> of each game
              at the plate-appearance level. Each simulation draws from the pitcher&apos;s pitch mix,
              the batter&apos;s tendencies, and the umpire&apos;s zone profile. The result is a full
              probability distribution — we can tell you there&apos;s a 58% chance of 7+ Ks, not just
              that the projection is 6.8.
            </p>

            <p>
              That probability is directly comparable to the sportsbook&apos;s implied probability
              (derived from the moneyline odds). When our simulated probability exceeds the book&apos;s
              implied probability by a meaningful margin, that&apos;s a mathematical edge.
            </p>

            <h2>Reading a Strikeout Prop Edge</h2>

            <p>
              When you see a pick on the <Link href="/edges">edges page</Link>, here&apos;s how to
              interpret the numbers:
            </p>

            <ul>
              <li>
                <strong>Projection</strong> — the mean simulated strikeout total across 5,000
                simulations
              </li>
              <li>
                <strong>Confidence</strong> — how consistently our model assigns edge to this
                outcome; higher confidence reflects both a larger edge and lower variance
              </li>
              <li>
                <strong>Factor Breakdown</strong> — the four or five variables driving the number,
                with directional impact shown for each
              </li>
            </ul>

            <p>
              You don&apos;t have to agree with every factor. If you think the umpire adjustment
              is overstated, or you have information our model doesn&apos;t (a pitcher tipping
              pitches, a lineup change before lineup lock), you can make a more informed decision.
              That&apos;s the point of transparent, glass-box analytics.
            </p>

          </article>

          {/* CTA */}
          <div className="mt-12 p-6 bg-gradient-to-r from-emerald-950/40 via-emerald-900/20 to-emerald-950/40 border border-emerald-700/40 rounded-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">
              See today&apos;s strikeout prop edges
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              FullCountProps generates projections for every starting pitcher in the daily
              slate — with full factor breakdowns so you can see exactly why the model likes
              each edge. Free tier includes the top 3 daily edges.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/edges"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
              >
                View Today&apos;s Edges &rarr;
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
              >
                See Pricing
              </Link>
            </div>
          </div>

          {/* Footer nav */}
          <div className="mt-12 pt-8 border-t border-slate-800 flex justify-between text-sm">
            <Link href="/blog" className="text-slate-400 hover:text-white transition-colors">
              &larr; Back to Blog
            </Link>
            <Link href="/methodology" className="text-green-400 hover:text-green-300 transition-colors">
              How our model works &rarr;
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================
// app/blog/monte-carlo-simulation-sports-betting/page.tsx
//
// Target keywords:
//   "Monte Carlo simulation sports betting"
//   "simulation baseball props"
//   "Monte Carlo baseball predictions"
//   "probability distribution sports betting"
// ============================================================

import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Monte Carlo Simulation in Sports Betting: How 5,000 Simulations Beat Point Estimates | FullCountProps',
  description:
    'Why running 5,000 simulations of each MLB game produces better prop predictions than point estimates. A plain-English guide to Monte Carlo simulation in baseball betting.',
  openGraph: {
    title: 'Monte Carlo Simulation in Sports Betting: How 5,000 Simulations Beat Point Estimates',
    description:
      'A single projection misses variance. Run 5,000 simulations and you get a full probability distribution — the same approach sportsbooks use. Here\'s how it works.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Monte Carlo Simulation in Sports Betting: How 5,000 Simulations Beat Point Estimates',
    description:
      'Why probability distributions beat point estimates for MLB prop betting — and how to use them.',
  },
  keywords: [
    'Monte Carlo simulation sports betting',
    'simulation baseball props',
    'Monte Carlo baseball predictions',
    'probability distribution sports betting',
    'MLB prop simulation',
    'point estimates vs simulation betting',
  ],
}

function JsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Monte Carlo Simulation in Sports Betting: How 5,000 Simulations Beat Point Estimates',
    description:
      'Why running 5,000 simulations of each MLB game produces better prop predictions than point estimates.',
    author: { '@type': 'Organization', name: 'FullCountProps' },
    publisher: { '@type': 'Organization', name: 'FullCountProps' },
    datePublished: '2026-03-15',
    dateModified: '2026-03-15',
    mainEntityOfPage: 'https://www.fullcountprops.com/blog/monte-carlo-simulation-sports-betting',
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default function MonteCarloGuide() {
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
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-purple-950/50 text-purple-400 border border-purple-800/50">
                Methodology
              </span>
              <span className="text-xs text-slate-500">March 15, 2026</span>
              <span className="text-xs text-slate-600">&middot;</span>
              <span className="text-xs text-slate-500">8 min read</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
              Monte Carlo Simulation in Sports Betting: How 5,000 Simulations Beat Point Estimates
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Most baseball projection systems give you a number: &ldquo;this pitcher projects for
              6.8 strikeouts.&rdquo; That number is useful, but incomplete. What you really need is
              a probability — and getting there requires running the game thousands of times.
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

            <h2>Why Point Estimates Fall Short</h2>

            <p>
              Imagine two pitchers, each projected for 6.5 strikeouts. Pitcher A is a command
              artist who consistently goes deep into games — his strikeout total rarely deviates
              more than 1.5 Ks from his mean in either direction. Pitcher B is an electric but
              volatile power arm who alternates between dominant 10-K outings and early exits
              with 3 Ks.
            </p>

            <p>
              Both average 6.5. But a 6.5-line bet on the over behaves completely differently
              for each. Pitcher A&apos;s over probability might be 52%. Pitcher B&apos;s could be 48%
              despite the same mean — his high variance means more outcomes land far from 6.5 in
              both directions, and the ones on the low side hurt the over.
            </p>

            <p>
              A point estimate can&apos;t distinguish between these two pitchers. A probability
              distribution can.
            </p>

            <h2>What Monte Carlo Simulation Actually Is</h2>

            <p>
              Monte Carlo simulation is named after the famous casino district — the reference
              is to randomness. The core idea is simple: instead of computing a single expected
              outcome, you simulate the random process thousands of times and let the aggregate
              results tell you the probability distribution.
            </p>

            <p>
              For physics problems, Monte Carlo was invented to model how neutrons scatter
              through nuclear material. For baseball, the same principle applies: each plate
              appearance involves a large number of uncertain outcomes, and simulating each one
              repeatedly produces a realistic distribution of game outcomes.
            </p>

            <p>
              The key requirement is a good underlying model of the individual event — in baseball,
              the plate appearance. If your PA model is accurate, running it thousands of times
              will produce accurate game-level distributions. If it&apos;s biased, you&apos;ll get
              consistent but wrong distributions.
            </p>

            <h2>How a Single Plate Appearance Gets Simulated</h2>

            <p>
              FullCountProps simulates each game at the plate-appearance level. For every PA in
              a simulated game, the model:
            </p>

            <ol>
              <li>
                <strong>Draws a pitch sequence</strong> using the pitcher&apos;s Statcast pitch mix
                (four-seam percentage, slider rate, changeup usage) and the batter&apos;s historical
                tendencies against each pitch type
              </li>
              <li>
                <strong>Assigns a pitch outcome</strong> — swing or take, contact or miss —
                based on the matchup probability and a random draw; whiff rates, chase rates,
                and contact rates come from 24 Statcast features per player
              </li>
              <li>
                <strong>Resolves the PA</strong> — if the count reaches three strikes, it&apos;s
                a strikeout; if a ball is put in play, batted-ball outcomes (single, double,
                home run, out) are drawn from exit velocity and launch angle distributions
                adjusted for park factors
              </li>
              <li>
                <strong>Tracks counting stats</strong> — Ks, total bases, hits, RBIs, and walks
                accumulate across the simulated game
              </li>
            </ol>

            <p>
              Each simulation runs through an entire game — typically 27–33 outs — with all
              lineup positions cycling through. The pitcher faces his realistic expected number
              of batters given his innings projection.
            </p>

            <h2>Running 5,000 Simulations</h2>

            <p>
              FullCountProps runs <strong>5,000 simulations per game</strong>, each using the
              same pitcher, lineup, park, and weather inputs but different random draws. The
              result is a distribution of outcomes — not just &ldquo;6.8 Ks&rdquo; but something like:
            </p>

            <ul>
              <li>3 Ks or fewer: 8% of simulations</li>
              <li>4–5 Ks: 19% of simulations</li>
              <li>6 Ks: 16% of simulations</li>
              <li>7 Ks: 21% of simulations</li>
              <li>8 Ks: 18% of simulations</li>
              <li>9+ Ks: 18% of simulations</li>
            </ul>

            <p>
              From this distribution, you can immediately calculate: the probability of over 6.5 Ks
              is the percentage of simulations where the pitcher recorded 7 or more. In this
              example, that&apos;s 57%. If the sportsbook is pricing over 6.5 at -115 (implied
              probability: 53.5%), there&apos;s a 3.5-percentage-point edge on the over.
            </p>

            <p>
              Why 5,000? It&apos;s a balance between computational accuracy and speed. Below 1,000
              simulations, sampling error introduces too much noise in the tail probabilities —
              which matter most for props set near the distribution&apos;s edges. At 5,000
              simulations, the standard error on a 55% probability estimate is under 0.7 percentage
              points, which is precise enough to confidently identify edges.
            </p>

            <h2>From Distribution to Edge</h2>

            <p>
              The final step is comparison. Our simulated probability goes head-to-head with
              the sportsbook&apos;s implied probability — which we derive by removing the vig from
              the listed moneyline odds.
            </p>

            <p>
              If the over on 6.5 Ks is listed at -110 (implied probability: 52.4%) and our
              simulation says 58%, the mathematical edge is 5.6 percentage points. That&apos;s not
              a guaranteed win — it means that over a large enough sample of similar bets, you
              should expect to profit. Individual games are still random; edges compound over
              hundreds of bets.
            </p>

            <p>
              This is also why we report <strong>confidence</strong> in addition to raw edge.
              Confidence reflects how stable the edge is across different simulation runs and
              how much it would shift if our inputs were slightly wrong. A 6% edge driven by
              one volatile factor (say, a last-minute lineup change) is less reliable than a
              4% edge built on multiple independent signals all pointing the same direction.
            </p>

            <h2>What Simulation Can&apos;t Do</h2>

            <p>
              Simulation doesn&apos;t eliminate uncertainty — it quantifies it. A 58% simulated
              probability is still a loss 42% of the time. Variance is real, and even high-edge
              props lose in meaningful stretches.
            </p>

            <p>
              Simulation also can&apos;t account for information that isn&apos;t in the model: a pitcher
              tipping pitches, an undisclosed injury, a lineup change announced five minutes
              before first pitch. FullCountProps pulls lineups, umpire assignments, and weather
              data each morning to stay as current as possible, but late-breaking information
              always carries more weight than any model output. Use the factor breakdown on each
              card as a checklist — if you have information that contradicts a factor, trust what
              you know.
            </p>

            <h2>Why This Matters for Bettors</h2>

            <p>
              Sportsbooks use sophisticated models to set their lines — and increasingly, they
              use simulation-based approaches. The information asymmetry between books and casual
              bettors isn&apos;t in the raw statistics anymore; anyone can look up a pitcher&apos;s K rate.
              The asymmetry is in how you process that information.
            </p>

            <p>
              A bettor who thinks in point estimates (&ldquo;he projects for 6.8, the line is 6.5,
              so I&apos;ll take the over&rdquo;) is playing a weaker game than a bettor who asks:
              &ldquo;what is the actual probability of 7 or more, and how does that compare to
              what the book is implying?&rdquo; Monte Carlo simulation is the most direct way
              to answer that second question.
            </p>

            <p>
              A full technical explanation of FullCountProps&apos; simulation methodology —
              including our LightGBM matchup model, the 24 Statcast features, and how we
              handle catcher framing — is on our <Link href="/methodology">methodology page</Link>.
            </p>

          </article>

          {/* Stats callout */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { value: '5,000', label: 'Simulations per game' },
              { value: '24', label: 'Statcast features' },
              { value: 'LightGBM', label: 'Matchup model' },
            ].map(({ value, label }) => (
              <div key={label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-xl font-bold text-green-400">{value}</div>
                <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{label}</div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-10 p-6 bg-gradient-to-r from-purple-950/40 via-purple-900/20 to-purple-950/40 border border-purple-700/40 rounded-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">
              See the simulation results for today&apos;s slate
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Every FullCountProps projection is backed by 5,000 simulations. The confidence
              score, factor breakdown, and edge percentage are all derived directly from the
              simulation output — not a formula.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/methodology"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-colors"
              >
                Read the Full Methodology &rarr;
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
            <Link href="/edges" className="text-green-400 hover:text-green-300 transition-colors">
              Today&apos;s Edges &rarr;
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================
// app/blog/opening-day-props-2026/page.tsx
//
// Target keywords:
//   "MLB opening day props 2026"
//   "opening day strikeout predictions"
//   "opening day player props March 26"
//
// INSTRUCTIONS: Fill in the {{PLACEHOLDER}} values on March 25/26
// once probable pitchers and prop lines are available.
// ============================================================

import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Opening Day 2026: Our Model\'s Top Prop Edges — FullCountProps',
  description: 'Monte Carlo simulation results for every Opening Day matchup. 3 highest-confidence MLB player prop edges with full SHAP factor breakdowns.',
  openGraph: {
    title: 'Opening Day 2026: Top MLB Prop Edges',
    description: '5,000 simulations per game. Here are the 3 picks our model likes most for March 26.',
  },
  keywords: [
    'MLB opening day props 2026',
    'opening day strikeout predictions',
    'opening day player props',
    'MLB prop picks March 26',
    'Monte Carlo baseball predictions',
  ],
}

export default function OpeningDayPost() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      {/* Breadcrumb */}
      <div className="mb-8">
        <Link href="/blog" className="text-sm text-slate-500 hover:text-slate-300">
          Blog
        </Link>
        <span className="text-slate-700 mx-2">/</span>
        <span className="text-sm text-slate-400">Opening Day 2026</span>
      </div>

      {/* Header */}
      <header className="mb-10">
        <p className="text-green-400 text-sm font-medium uppercase tracking-wider mb-3">
          Opening Day 2026
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
          Our Model&apos;s Top Prop Edges for March 26
        </h1>
        <p className="text-slate-400 text-lg leading-relaxed">
          We ran 5,000 Monte Carlo simulations on every Opening Day game.
          Here are the three picks where the model sees the biggest mathematical edge
          over the sportsbooks &mdash; and exactly why.
        </p>
        <div className="flex items-center gap-4 mt-6 text-sm text-slate-500">
          <span>March 26, 2026</span>
          <span>&middot;</span>
          <span>5 min read</span>
          <span>&middot;</span>
          <Link href="/methodology" className="text-blue-400 hover:text-blue-300">
            How our model works
          </Link>
        </div>
      </header>

      {/* Article body */}
      <article className="prose prose-invert prose-slate max-w-none
        prose-headings:font-bold prose-headings:text-white
        prose-p:text-slate-300 prose-p:leading-relaxed
        prose-a:text-green-400 prose-a:no-underline hover:prose-a:text-green-300
        prose-strong:text-white prose-li:text-slate-300">

        <p>
          Opening Day is the one day of the season where every team has a clean slate
          and every starter is fresh. It&apos;s also one of the best days for prop edges:
          sportsbooks are pricing off preseason projections while our model has ingested
          the full spring training data, confirmed lineups, real-time weather, and
          today&apos;s umpire assignments.
        </p>

        <p>
          Across today&apos;s slate, our simulation surfaced <strong>XX props with 3%+ mathematical edge</strong>.
          Here are the three where we have the highest confidence.
        </p>

        {/* ── PICK 1 ── */}
        <h2>1. [PITCHER NAME] Over [X.5] Strikeouts (+[X.X]% edge)</h2>

        <div className="not-prose my-6 rounded-xl border border-green-800/50 bg-green-950/20 p-5">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-lg font-bold text-white">[PITCHER NAME]</span>
            <span className="text-green-400 font-semibold">+[X.X]% edge</span>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            [TEAM] vs [OPPONENT] &middot; [VENUE] &middot; [TIME] ET
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-500">Sim Mean</p>
              <p className="text-lg font-bold text-white">[X.X] Ks</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">P(Over)</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Book Implied</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Factor Breakdown</p>
            <p className="text-sm text-slate-300">
              Base K rate: [XX.X]% &middot;
              Park K factor: [+X.Xpp] &middot;
              Umpire: [+X.Xpp] &middot;
              Catcher framing: [+X.X SD] &middot;
              Platoon: [advantage/neutral]
            </p>
          </div>
        </div>

        <p>
          [2-3 sentences explaining WHY the model likes this pick. What&apos;s the story?
          Is it the umpire? The park? The opposing lineup&apos;s high K rate? This is what
          makes your content different from every other picks site — the explanation.]
        </p>

        {/* ── PICK 2 ── */}
        <h2>2. [PLAYER NAME] Over [X.5] [STAT] (+[X.X]% edge)</h2>

        <div className="not-prose my-6 rounded-xl border border-blue-800/50 bg-blue-950/20 p-5">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-lg font-bold text-white">[PLAYER NAME]</span>
            <span className="text-blue-400 font-semibold">+[X.X]% edge</span>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            [TEAM] vs [OPPONENT] &middot; [VENUE] &middot; [TIME] ET
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-500">Sim Mean</p>
              <p className="text-lg font-bold text-white">[X.X]</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">P(Over)</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Book Implied</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
          </div>
        </div>

        <p>
          [2-3 sentences on the story behind this pick.]
        </p>

        {/* ── PICK 3 ── */}
        <h2>3. [PLAYER NAME] [Over/Under] [X.5] [STAT] (+[X.X]% edge)</h2>

        <div className="not-prose my-6 rounded-xl border border-slate-700 bg-slate-900/50 p-5">
          <div className="flex justify-between items-baseline mb-3">
            <span className="text-lg font-bold text-white">[PLAYER NAME]</span>
            <span className="text-yellow-400 font-semibold">+[X.X]% edge</span>
          </div>
          <p className="text-sm text-slate-400 mb-4">
            [TEAM] vs [OPPONENT] &middot; [VENUE] &middot; [TIME] ET
          </p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-500">Sim Mean</p>
              <p className="text-lg font-bold text-white">[X.X]</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">P(Over)</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Book Implied</p>
              <p className="text-lg font-bold text-white">[XX.X]%</p>
            </div>
          </div>
        </div>

        <p>
          [2-3 sentences on the story behind this pick.]
        </p>

        {/* ── How to read these picks ── */}
        <h2>How to Read These Picks</h2>

        <p>
          If you&apos;re new to FullCountProps, here&apos;s a quick guide to what these numbers mean:
        </p>

        <ul>
          <li>
            <strong>Edge %</strong> is the difference between our simulated probability
            and the sportsbook&apos;s implied probability (after removing the vig). A +9% edge
            means we think the outcome happens 9 percentage points more often than the book
            is pricing.
          </li>
          <li>
            <strong>Sim Mean</strong> is the average result across 5,000 full-game simulations.
            If we sim 6.8 Ks, that&apos;s the central tendency — but the distribution matters more
            than the average.
          </li>
          <li>
            <strong>Factor Breakdown</strong> shows exactly what drove the projection.
            If you see &ldquo;Umpire: +2.2pp,&rdquo; that means today&apos;s home plate umpire
            historically increases strikeout probability by 2.2 percentage points above average.
          </li>
        </ul>

        <p>
          This transparency is the whole point. If you disagree with a factor, you can make
          a more informed decision. That&apos;s glass-box analytics.
        </p>

        {/* ── CTA ── */}
        <h2>See the Full Slate</h2>

        <p>
          These three picks are available to everyone. The full slate of XX edges across
          today&apos;s Opening Day games is available on the{' '}
          <Link href="/edges">edges page</Link> — 3 free daily, or upgrade to Double-A
          for every pick.
        </p>

        <p>
          Results will be graded tonight and posted on our{' '}
          <Link href="/accuracy">accuracy page</Link> by tomorrow morning.
          We don&apos;t hide bad nights.
        </p>
      </article>

      {/* ── Results update section (fill in after games) ── */}
      {/*
      <div className="mt-12 rounded-xl border border-slate-700 bg-slate-900/50 p-6">
        <h3 className="text-lg font-bold text-white mb-3">Results Update — March 27</h3>
        <p className="text-slate-300">
          [X] of 3 featured picks hit. Here's the breakdown:
        </p>
        <ul className="mt-3 space-y-2 text-sm text-slate-400">
          <li>✅ [PITCHER] Over [X.5] Ks — Actual: [X] Ks (HIT)</li>
          <li>❌ [PLAYER] Over [X.5] [STAT] — Actual: [X] (MISS)</li>
          <li>✅ [PLAYER] [Over/Under] [X.5] [STAT] — Actual: [X] (HIT)</li>
        </ul>
        <p className="mt-4 text-sm text-slate-400">
          Full accuracy data: <Link href="/accuracy" className="text-green-400">fullcountprops.com/accuracy</Link>
        </p>
      </div>
      */}

      {/* Footer nav */}
      <div className="mt-16 pt-8 border-t border-slate-800 flex justify-between text-sm">
        <Link href="/blog" className="text-slate-400 hover:text-white">
          &larr; Back to Blog
        </Link>
        <Link href="/edges" className="text-green-400 hover:text-green-300">
          See Today&apos;s Edges &rarr;
        </Link>
      </div>
    </div>
  )
}

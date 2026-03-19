'use client'

import { useState } from 'react'

interface FAQItem {
  question: string
  answer: React.ReactNode
}

function FAQAccordion({ item }: { item: FAQItem; key?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-slate-800 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-5 flex items-start justify-between gap-4 text-left"
      >
        <span className="text-white font-medium text-lg">{item.question}</span>
        <span
          className={`text-slate-500 text-xl shrink-0 transition-transform duration-200 ${
            open ? 'rotate-45' : ''
          }`}
        >
          +
        </span>
      </button>
      {open && (
        <div className="pb-5 text-slate-400 text-sm leading-relaxed space-y-3">
          {item.answer}
        </div>
      )}
    </div>
  )
}

const FAQ_SECTIONS: { title: string; items: FAQItem[] }[] = [
  {
    title: 'Product & Coverage',
    items: [
      {
        question: 'What player props does FullCountProps cover?',
        answer: (
          <>
            <p>
              We cover six prop types for MLB player markets: <strong className="text-slate-200">strikeouts (K)</strong>,{' '}
              <strong className="text-slate-200">hits (H)</strong>,{' '}
              <strong className="text-slate-200">total bases (TB)</strong>,{' '}
              <strong className="text-slate-200">RBIs</strong>,{' '}
              <strong className="text-slate-200">walks (BB)</strong>, and{' '}
              <strong className="text-slate-200">runs scored (R)</strong>.
            </p>
            <p>
              Pitcher strikeout props are our strongest suit — the model has the most
              predictive signal for K outcomes. Total bases and RBIs are newer
              additions with slightly wider confidence intervals.
            </p>
          </>
        ),
      },
      {
        question: 'How often do picks update?',
        answer: (
          <>
            <p>
              Picks run <strong className="text-slate-200">twice daily</strong> during the MLB season:
            </p>
            <ul className="list-disc list-outside ml-5 space-y-1 mt-2">
              <li><strong className="text-slate-200">10:30 AM ET</strong> — Morning run uses probable pitcher data and projected lineups</li>
              <li><strong className="text-slate-200">4:30 PM ET</strong> — Afternoon refresh uses confirmed lineups, final umpire assignments, and real-time weather</li>
            </ul>
            <p>
              The afternoon run is generally more accurate because it incorporates
              confirmed (not projected) lineup data.
            </p>
          </>
        ),
      },
      {
        question: 'Do you cover spring training or the postseason?',
        answer: (
          <p>
            Not currently. The model is trained on regular-season data only.
            Spring training lineups are unpredictable (starters play partial
            games), and postseason sample sizes are too small for reliable
            statistical inference. We run from Opening Day through the end of the
            regular season.
          </p>
        ),
      },
      {
        question: 'Which sportsbooks do you compare odds against?',
        answer: (
          <p>
            We pull prop lines from all major US sportsbooks via The Odds API,
            including DraftKings, FanDuel, BetMGM, Caesars, and PointsBet. The edge
            calculation uses the best available line across books. We remove the
            vig (book margin) before calculating edge, so you&apos;re seeing the
            true mathematical edge against the market&apos;s implied probability.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Understanding the Numbers',
    items: [
      {
        question: 'What does "edge %" mean?',
        answer: (
          <>
            <p>
              Edge is the difference between our simulated probability and the
              sportsbook&apos;s no-vig implied probability for a prop.
            </p>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 my-3 text-sm">
              <div className="flex justify-between mb-2">
                <span className="text-slate-500">Our simulated probability</span>
                <span className="text-white">60.7%</span>
              </div>
              <div className="flex justify-between mb-2">
                <span className="text-slate-500">Book implied probability (no-vig)</span>
                <span className="text-white">54.3%</span>
              </div>
              <div className="flex justify-between border-t border-slate-700 pt-2">
                <span className="text-green-400">Edge</span>
                <span className="text-green-400 font-bold">+6.4%</span>
              </div>
            </div>
            <p>
              A +6.4% edge means we believe this outcome happens 6.4 percentage
              points more often than the market price implies. Over hundreds of
              bets, positive edges should translate to positive ROI — if the model
              is well-calibrated. We only surface props with edges of 3% or more.
            </p>
          </>
        ),
      },
      {
        question: 'What are the confidence tiers (HIGH / MEDIUM / LOW)?',
        answer: (
          <>
            <p>Picks are tiered by edge size and simulation quality:</p>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-3">
                <span className="text-xs px-2 py-0.5 rounded bg-green-900 text-green-300 font-bold shrink-0">HIGH</span>
                <span>Edge ≥ 8% with strong simulation consistency. Highest conviction plays.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs px-2 py-0.5 rounded bg-blue-900 text-blue-300 font-bold shrink-0">MEDIUM</span>
                <span>Edge ≥ 5%. Solid edge, worth consideration.</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-900 text-yellow-300 font-bold shrink-0">LOW</span>
                <span>Edge ≥ 3%. Marginal edge — bet small or wait for confirmation.</span>
              </div>
            </div>
          </>
        ),
      },
      {
        question: 'What does the Kelly criterion bet size mean?',
        answer: (
          <p>
            The Kelly criterion is a mathematically optimal formula for bet sizing
            that maximizes long-run bankroll growth. We display{' '}
            <strong className="text-slate-200">quarter-Kelly</strong> (25% of the theoretical
            optimum) because full Kelly is too aggressive when there&apos;s model
            uncertainty. Think of it as a relative guide — larger Kelly % = higher
            conviction — rather than a literal percentage of your bankroll to wager.
            No single bet ever exceeds 5% of bankroll in our sizing.
          </p>
        ),
      },
      {
        question: 'How should I interpret the SHAP factor breakdown?',
        answer: (
          <p>
            Every projection comes with a glass-box breakdown showing what drove
            the number: base matchup probability, park factor adjustment, umpire
            tendency, catcher framing, weather, and platoon. Use this to
            sanity-check our picks. If you see the umpire factor contributing +3
            percentage points to a K prop edge but you know the umpire has a tight
            zone, the data feed may have an error — and you should skip that bet.
            Transparency lets you be smarter than the model.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Free vs. Paid',
    items: [
      {
        question: 'What do I get for free?',
        answer: (
          <ul className="list-disc list-outside ml-5 space-y-1">
            <li>Top 3 edges per day with direction (Over/Under) and grade</li>
            <li>Daily slate overview with game matchups</li>
            <li>Basic model accuracy statistics</li>
            <li>Full methodology documentation</li>
          </ul>
        ),
      },
      {
        question: 'What does Double-A ($7.99/mo) include?',
        answer: (
          <ul className="list-disc list-outside ml-5 space-y-1">
                            <li>Everything in Single-A (free tier)</li>
                <li>Full daily best bets (every game)</li>
                <li>Full edges page access</li>
                <li>Basic SHAP explanations (top 3 factors)</li>
                <li>Player pages with recent history</li>
                <li>Daily email digest delivered at 11am ET</li>
                        </ul>
        ),
      },
      {
        question: 'What does Triple-A ($29.99/mo) and The Show ($49.99/mo) include?',
        answer: (
          <>
            <p><strong className="text-slate-200">Triple-A ($29.99/mo)</strong> adds everything in Double-A plus:</p>
            <ul className="list-disc list-outside ml-5 space-y-1 mt-2 mb-4">
              <li>Full SHAP breakdowns (all factors)</li>
              <li>Probability distributions</li>
              <li>Kelly criterion sizing</li>
              <li>Full backtest accuracy and calibration</li>
              <li>Game simulator access</li>
              <li>Umpire framing and park composites</li>
              <li>50-game player history</li>
            </ul>
            <p><strong className="text-slate-200">The Show ($49.99/mo)</strong> adds everything in Triple-A plus:</p>
            <ul className="list-disc list-outside ml-5 space-y-1 mt-2">
              <li>REST API access (1,000 requests per hour)</li>
              <li>API key management dashboard</li>
              <li>Custom alert thresholds</li>
              <li>200-game player history</li>
              <li>Priority support</li>
              <li>Webhook notifications (coming soon)</li>
            </ul>
          </>
        ),
      },
      {
        question: 'Can I cancel anytime?',
        answer: (
          <p>
            Yes. All plans are billed monthly through Stripe. Cancel anytime from
            your account settings — you&apos;ll retain access through the end of
            the billing period. No cancellation fees, no questions asked.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Accuracy & Track Record',
    items: [
      {
        question: 'What is your accuracy track record?',
        answer: (
          <>
            <p>
              In backtesting on the 2024 season (12,847 graded props), the model
              achieved:
            </p>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-green-400">3.1%</div>
                <div className="text-xs text-slate-500">Calibration Error (ECE)</div>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
                <div className="text-lg font-bold text-green-400">+8.7%</div>
                <div className="text-xs text-slate-500">Backtest ROI at 4% edge</div>
              </div>
            </div>
            <p className="mt-3">
              When we predict a 60% probability, the actual hit rate across our
              backtest sample was approximately 58-62%. That level of calibration
              means the edge percentages you see are meaningful — not noise.
            </p>
            <p className="text-sm text-slate-500 mt-2">
              Important: backtest results are historical and do not guarantee
              future performance. Real-market results may differ due to execution
              timing, line movement, and evolving market efficiency.
            </p>
          </>
        ),
      },
      {
        question: 'How does FullCountProps compare to BallparkPal?',
        answer: (
          <p>
            BallparkPal is our closest structural competitor — they also run PA-level
            Monte Carlo simulations (3,000 per game vs. our 5,000). Their advantages:
            a trained proprietary model with 100+ features and years of production
            refinement. Our advantages: open source, free tier, glass-box SHAP
            explanations (they don&apos;t show factor breakdowns), deeper park
            factor granularity (6 dimensions vs. 4), and umpire/catcher framing
            integration at the PA level.
          </p>
        ),
      },
      {
        question: 'Do you grade every pick publicly?',
        answer: (
          <p>
            Yes. Every projection is graded against actual game results in the
            overnight pipeline at 2 AM ET. Results are published on the Accuracy
            page and in the Newsletter Archive. We never hide bad nights. Full
            transparency is a core principle — if the model has a losing week,
            you&apos;ll see it.
          </p>
        ),
      },
    ],
  },
  {
    title: 'Technical',
    items: [
      {
        question: 'Is FullCountProps open source?',
        answer: (
          <p>
            Yes. The entire codebase — simulation engine, matchup model, data
            pipelines, and this frontend — is available on{' '}
            <a
              href="https://github.com/fullcountprops/fullcountprops"
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-400 hover:text-green-300 underline"
            >
              GitHub
            </a>
            . You can verify our methodology, audit the training process, or run
            your own simulations.
          </p>
        ),
      },
      {
        question: 'What tech stack does the simulator use?',
        answer: (
          <ul className="list-disc list-outside ml-5 space-y-1">
            <li>LightGBM multiclass classifier for matchup prediction</li>
            <li>Python simulation engine with PA-level game state tracking</li>
            <li>Baseball Savant Statcast data (2021–2025)</li>
            <li>Next.js frontend deployed on Vercel</li>
            <li>Supabase for data storage and API</li>
            <li>Stripe for subscription billing</li>
          </ul>
        ),
      },
    ],
  },
]

export default function FAQClient() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="max-w-3xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="text-sm text-green-400 font-medium uppercase tracking-wider mb-2">
            Help Center
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Frequently Asked Questions
          </h1>
          <p className="text-slate-400 text-lg">
            Everything you need to know about FullCountProps, our methodology, and
            how to use our picks.
          </p>
        </div>

        {/* FAQ Sections */}
        <div className="space-y-12">
          {FAQ_SECTIONS.map((section) => (
            <div key={section.title}>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
                {section.title}
              </h2>
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl px-6">
                {section.items.map((item) => (
                  <FAQAccordion key={item.question} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-16 text-center p-8 bg-slate-900/60 border border-slate-700 rounded-xl">
          <h3 className="text-xl font-semibold text-white mb-2">
            Still have questions?
          </h3>
          <p className="text-slate-400 text-sm mb-6">
            Reach out on Twitter or open an issue on GitHub.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a
              href="https://twitter.com/fullcountprops"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Twitter / X
            </a>
            <a
              href="https://github.com/fullcountprops/fullcountprops/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              Open an Issue
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

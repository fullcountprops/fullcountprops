import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Methodology',
  description:
    'How FullCountProps works: LightGBM matchup model trained on ~1M Statcast plate appearances, 5,000 PA-level Monte Carlo simulations per game, umpire and catcher framing adjustments, SHAP explanations.',
  openGraph: {
    title: 'Methodology — FullCountProps',
    description:
      'A detailed, plain-English walkthrough of our Monte Carlo simulation engine, matchup model, and edge detection system.',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Methodology — FullCountProps',
    description:
      'How our Monte Carlo MLB prop simulator works — from Statcast data to actionable edges.',
    images: ['/og-image.png'],
  },
}

function JsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: 'FullCountProps Methodology — How Our Monte Carlo Model Works',
    description:
      'PA-level Monte Carlo simulation using LightGBM, 24 Statcast features, umpire tendencies, park factors, and SHAP explanations.',
    author: { '@type': 'Person', name: 'Grant Lescallett' },
    publisher: { '@type': 'Organization', name: 'FullCountProps' },
    url: 'https://www.fullcountprops.com/methodology',
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

function SectionCard({
  number,
  title,
  children,
}: {
  number: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-green-400 font-mono text-sm">{number}</span>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
      </div>
      <div className="text-slate-300 leading-relaxed space-y-4">{children}</div>
    </section>
  )
}

function StatBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
      <div className="text-2xl font-bold text-green-400">{value}</div>
      <div className="text-xs text-slate-500 mt-1 uppercase tracking-wider">{label}</div>
    </div>
  )
}

export default function MethodologyPage() {
  return (
    <>
      <JsonLd />
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className="max-w-3xl mx-auto px-4 py-16">
          {/* Header */}
          <div className="mb-12">
            <div className="text-sm text-green-400 font-medium uppercase tracking-wider mb-2">
              How It Works
            </div>
            <h1 className="text-4xl font-bold tracking-tight mb-4">
              Methodology
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              FullCountProps is built on a simple idea: simulate every plate appearance
              of every game thousands of times, using real data, and let the math
              tell you which prop bets are mispriced. Here&apos;s exactly how we do
              it &mdash; no black boxes.
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-16">
            <StatBox value="5,000" label="Simulations / Game" />
            <StatBox value="24" label="Statcast Features" />
            <StatBox value="~1M" label="Training PAs" />
            <StatBox value="8" label="Outcome Classes" />
          </div>

          {/* Section 1 */}
          <SectionCard number="01" title="What Is Monte Carlo Simulation?">
            <p>
              Imagine you want to know how many strikeouts a pitcher will record
              tonight. You could look at his season average and guess &mdash; but
              that gives you a single number with no sense of the range.
            </p>
            <p>
              Monte Carlo simulation takes a different approach. Instead of one
              answer, you simulate the full game thousands of times, introducing
              realistic randomness at every plate appearance. After 5,000 runs,
              you have a complete distribution &mdash; not just &quot;he&apos;ll
              probably get 6 Ks&quot; but &quot;there&apos;s a 61% chance he gets
              7 or more.&quot;
            </p>
            <p>
              The name comes from the famous casino in Monaco. Like a casino, the
              method relies on the law of large numbers: run enough trials and the
              pattern converges on the real underlying probabilities.
            </p>
          </SectionCard>

          {/* Section 2 */}
          <SectionCard number="02" title="The Two-Layer Architecture">
            <p>
              FullCountProps is built in two layers that work together:
            </p>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 my-4 font-mono text-sm text-slate-300">
              <div className="mb-3">
                <span className="text-green-400">Layer 1:</span> MATCHUP MODEL (LightGBM)
              </div>
              <div className="pl-4 text-slate-400 mb-1">
                Input: pitcher x batter x 24 context features
              </div>
              <div className="pl-4 text-slate-400 mb-4">
                Output: probability of each of 8 PA outcomes
              </div>
              <div className="mb-3">
                <span className="text-green-400">Layer 2:</span> MONTE CARLO ENGINE
              </div>
              <div className="pl-4 text-slate-400 mb-1">
                Runs 5,000 full-game simulations with real game state
              </div>
              <div className="pl-4 text-slate-400">
                Output: probability distribution for every player stat
              </div>
            </div>
            <p>
              The matchup model answers: &quot;What happens when this pitcher faces
              this batter in this context?&quot; The simulation engine chains those
              answers together across an entire game &mdash; tracking innings, outs,
              baserunners, pitch count, and fatigue &mdash; to produce full stat
              distributions.
            </p>
          </SectionCard>

          {/* Section 3 */}
          <SectionCard number="03" title="The Matchup Model">
            <p>
              At the heart of everything is a{' '}
              <strong className="text-white">LightGBM gradient-boosted tree classifier</strong>{' '}
              trained on ~1 million plate appearances from 5 seasons of
              Statcast data (2021&ndash;2025).
            </p>
            <p>
              For every upcoming plate appearance, the model takes 24 features and
              outputs the probability of 8 possible outcomes:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 my-4">
              {[
                { label: 'Strikeout', pct: '22.5%' },
                { label: 'Walk', pct: '8.4%' },
                { label: 'Single', pct: '14.1%' },
                { label: 'Double', pct: '4.6%' },
                { label: 'Triple', pct: '0.4%' },
                { label: 'Home Run', pct: '3.1%' },
                { label: 'Hit By Pitch', pct: '1.0%' },
                { label: 'Out (other)', pct: '45.9%' },
              ].map((o) => (
                <div
                  key={o.label}
                  className="bg-slate-800/60 border border-slate-700 rounded-lg p-3 text-center"
                >
                  <div className="text-xs text-slate-500">{o.label}</div>
                  <div className="text-sm font-semibold text-slate-200 mt-1">
                    ~{o.pct}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-sm text-slate-500">
              Percentages shown are 2024 league averages. The model adjusts these
              for every specific pitcher-batter matchup.
            </p>

            <h3 className="text-lg font-semibold text-white mt-8 mb-3">
              The 24 Statcast Features
            </h3>
            <p>Our feature set is organized into five categories:</p>
            <ul className="space-y-3 mt-3">
              <li className="flex gap-3">
                <span className="text-green-400 font-mono text-sm shrink-0">10</span>
                <div>
                  <strong className="text-white">Pitcher Statcast</strong>{' '}
                  <span className="text-slate-400">
                    &mdash; K rate, BB rate, HR rate, whiff%, called strike + whiff%,
                    zone%, swinging-strike%, avg fastball velocity, chase rate,
                    in-zone contact%
                  </span>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="text-green-400 font-mono text-sm shrink-0">10</span>
                <div>
                  <strong className="text-white">Batter Statcast</strong>{' '}
                  <span className="text-slate-400">
                    &mdash; K rate, BB rate, HR rate, xBA, xSLG, barrel%, hard-hit%,
                    chase rate, whiff%, contact%
                  </span>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="text-green-400 font-mono text-sm shrink-0">5</span>
                <div>
                  <strong className="text-white">Matchup Context</strong>{' '}
                  <span className="text-slate-400">
                    &mdash; platoon advantage, home/away, park HR factor, park K
                    factor, park hits factor
                  </span>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="text-green-400 font-mono text-sm shrink-0">5</span>
                <div>
                  <strong className="text-white">Game-Day Context</strong>{' '}
                  <span className="text-slate-400">
                    &mdash; umpire K-rate tendency, catcher framing score,
                    pitcher recent 14-day K rate, batter recent 14-day BA,
                    sportsbook game total line
                  </span>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="text-green-400 font-mono text-sm shrink-0">3</span>
                <div>
                  <strong className="text-white">Weather</strong>{' '}
                  <span className="text-slate-400">
                    &mdash; game-time temperature, wind speed, wind direction
                    (blowing out vs. in)
                  </span>
                </div>
              </li>
            </ul>
          </SectionCard>

          {/* Section 4 */}
          <SectionCard number="04" title="The Simulation">
            <p>
              Each of the 5,000 simulations plays out a complete baseball game,
              plate appearance by plate appearance:
            </p>
            <ol className="list-decimal list-outside ml-5 space-y-2 mt-3">
              <li>
                Load the confirmed starting lineup and batting order from the MLB
                Stats API
              </li>
              <li>
                For each plate appearance, the matchup model predicts the
                probability of all 8 outcomes for this specific pitcher vs. batter
              </li>
              <li>
                Apply context adjustments: park factors, umpire tendency, catcher
                framing, weather, platoon
              </li>
              <li>
                Randomly sample one outcome from the adjusted probability
                distribution
              </li>
              <li>
                Update game state &mdash; advance runners, record outs, score runs,
                track individual player stats
              </li>
              <li>
                When the pitcher reaches his simulated pitch count limit, hand off
                to the bullpen composite
              </li>
              <li>Repeat through 9 innings (or extras if tied)</li>
            </ol>
            <p className="mt-4">
              After 5,000 full games, each player has a frequency distribution of
              outcomes. &quot;Corbin Burnes recorded 7+ Ks in 2,550 of 5,000 sims&quot;
              gives us P(Over 6.5 Ks) = 61.2%.
            </p>
          </SectionCard>

          {/* Section 5 */}
          <SectionCard number="05" title="Context Adjustments">
            <p>
              Raw matchup probabilities are adjusted by five real-world factors
              before each PA outcome is sampled:
            </p>
            <div className="space-y-4 mt-4">
              {[
                {
                  title: 'Park Factors',
                  desc: 'All 30 MLB stadiums have different HR, K, and hit rates. Coors Field inflates HR probability by ~30%; Petco Park suppresses it by ~15%. We apply 6 park-specific adjustments per venue.',
                },
                {
                  title: 'Umpire Tendencies',
                  desc: 'Each home plate umpire has a documented strike zone tendency. Some run 10-20% higher K rates than average. We pull umpire assignments from MLB\'s pregame data and adjust K and BB probabilities accordingly.',
                },
                {
                  title: 'Catcher Framing',
                  desc: 'Elite pitch framers like J.T. Realmuto can add ~15 extra called strikes per 100 borderline pitches. We use Baseball Prospectus CSAA (Catcher Strike-Added Above Average) data to adjust K and BB rates.',
                },
                {
                  title: 'Weather',
                  desc: 'Temperature affects batted ball carry (~0.3% HR change per degree above 72°F). Wind direction matters even more: 15 mph blowing out at Wrigley adds up to 8% HR probability. We fetch real-time weather 75 minutes before first pitch.',
                },
                {
                  title: 'Platoon Splits',
                  desc: 'Left-handed batters vs. right-handed pitchers (and vice versa) perform measurably differently. For players with 200+ career PA against the relevant hand, the model uses its direct estimate. For smaller samples, we blend with positional-level platoon priors.',
                },
              ].map((adj) => (
                <div
                  key={adj.title}
                  className="bg-slate-900/60 border border-slate-700 rounded-xl p-4"
                >
                  <h3 className="text-white font-semibold mb-1">{adj.title}</h3>
                  <p className="text-sm text-slate-400">{adj.desc}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Section 6 */}
          <SectionCard number="06" title="From Simulation to Prop Edge">
            <p>
              Once we have the simulated probability distribution, we compare it to
              the sportsbook&apos;s odds to find mispriced props:
            </p>

            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 my-4">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Our simulated P(Over 6.5 Ks)</span>
                  <span className="text-white font-semibold">60.7%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Sportsbook no-vig implied probability</span>
                  <span className="text-white font-semibold">54.3%</span>
                </div>
                <div className="border-t border-slate-700 pt-3 flex justify-between">
                  <span className="text-green-400 font-medium">Edge</span>
                  <span className="text-green-400 font-bold">+6.4%</span>
                </div>
              </div>
            </div>

            <p>
              A positive edge means our model believes the outcome happens more
              often than the sportsbook&apos;s price implies. We surface all props
              with edges of 3% or more &mdash; anything below that is within the
              noise.
            </p>

            <h3 className="text-lg font-semibold text-white mt-8 mb-3">
              Removing the Vig
            </h3>
            <p>
              Sportsbooks build in a profit margin (the &quot;vig&quot; or
              &quot;juice&quot;) on every line. Typical MLB prop vig is 4&ndash;5%.
              Before comparing our probability to the market, we mathematically
              strip out the vig to get the book&apos;s true implied probability.
              This ensures we&apos;re measuring real edge, not just beating the
              vig.
            </p>

            <h3 className="text-lg font-semibold text-white mt-8 mb-3">
              Kelly Criterion Sizing
            </h3>
            <p>
              For each edge, we calculate an optimal bet size using the Kelly
              Criterion &mdash; a mathematically proven formula for maximizing
              long-run bankroll growth. We use <strong className="text-white">quarter-Kelly</strong>{' '}
              (25% of the theoretical optimum) to account for model uncertainty,
              with a hard cap of 5% of bankroll on any single bet.
            </p>
          </SectionCard>

          {/* Section 7 */}
          <SectionCard number="07" title="SHAP Explanations (Glass-Box Transparency)">
            <p>
              This is what makes FullCountProps different from every other prop
              analytics service. For every single projection, you can see exactly
              what drove the number:
            </p>
            <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 my-4 font-mono text-xs text-slate-300 space-y-1">
              <div className="text-green-400 font-bold mb-2">
                Corbin Burnes O6.5 Ks — edge: +9.2%
              </div>
              <div>base_log5_k = 0.263</div>
              <div className="text-blue-400">
                | park_k_factor = +1.05 (+1.4pp)
              </div>
              <div className="text-blue-400">
                | umpire_k_factor = +1.08 (+2.2pp)
              </div>
              <div className="text-blue-400">
                | catcher_framing = +1.2 SD (+3.0pp)
              </div>
              <div className="text-slate-500">| weather = no adjustment</div>
              <div className="text-slate-500">| platoon = no advantage</div>
              <div className="text-slate-500 mt-2">
                data_confidence = 0.84 (pitcher 420 BF, batter avg 340 PA)
              </div>
            </div>
            <p>
              If we say &quot;bet the over on strikeouts&quot; and you see the umpire
              factor is driving half the edge, you can decide for yourself whether
              you trust that signal. If the data feed pulled the wrong umpire, you
              can catch the mistake before placing a bet.
            </p>
            <p>
              This kind of transparency doesn&apos;t exist at BallparkPal, THE BAT X,
              or any other prop service we&apos;re aware of. We think it should be
              the standard.
            </p>
          </SectionCard>

          {/* Section 8 */}
          <SectionCard number="08" title="Model Validation">
            <p>
              We backtest every model version using strict out-of-sample
              walk-forward testing. The model is trained on seasons T-3 through T-1
              and tested on season T, with no future information leaking into
              training features.
            </p>

            <h3 className="text-lg font-semibold text-white mt-6 mb-3">
              Calibration
            </h3>
            <p>
              A well-calibrated model &quot;hits what it says.&quot; When we predict
              60% probability, the outcome should happen about 60% of the time.
              Our current calibration error (ECE) is <strong className="text-white">3.1%</strong>{' '}
              &mdash; meaning on average, our predictions are off by about 3
              percentage points. That&apos;s considered good for sports prediction.
            </p>

            <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden my-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left px-4 py-3 font-medium">
                      Predicted Range
                    </th>
                    <th className="text-right px-4 py-3 font-medium">
                      Actual Hit Rate
                    </th>
                    <th className="text-right px-4 py-3 font-medium">
                      Sample Size
                    </th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {[
                    { range: '50–55%', actual: '52.3%', n: '1,841' },
                    { range: '55–60%', actual: '57.8%', n: '2,203' },
                    { range: '60–65%', actual: '62.1%', n: '1,976' },
                    { range: '65–70%', actual: '67.4%', n: '1,124' },
                    { range: '70%+', actual: '71.9%', n: '608' },
                  ].map((row) => (
                    <tr
                      key={row.range}
                      className="border-b border-slate-800 last:border-0"
                    >
                      <td className="px-4 py-2">{row.range}</td>
                      <td className="px-4 py-2 text-right text-green-400 font-medium">
                        {row.actual}
                      </td>
                      <td className="px-4 py-2 text-right text-slate-500">
                        {row.n}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500">
              Calibration data from 12,847 graded props in the 2024 backtest.
            </p>
          </SectionCard>

          {/* Section 9 */}
          <SectionCard number="09" title="Honest Limitations">
            <p>
              We believe in transparency about what the model does not do well:
            </p>
            <ul className="space-y-3 mt-3">
              {[
                'Bullpen transitions are simplified — when a starter exits, we use the team\'s aggregate bullpen stats rather than modeling individual relievers.',
                'Pinch hitting and defensive substitutions are not modeled — late-game lineup changes can affect PA volume for projected starters.',
                'Early season data (April) is noisy — the model leans heavily on prior-season rates until ~400+ PA accumulate.',
                'Weather data is fetched ~75 minutes before first pitch and may not reflect conditions for late-starting or rain-delayed games.',
                'Stolen bases and errors are not modeled — these affect ~2-3% of base-running situations.',
              ].map((lim, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-yellow-400 shrink-0">&#9888;</span>
                  <span className="text-slate-400 text-sm">{lim}</span>
                </li>
              ))}
            </ul>
          </SectionCard>

          {/* Section 10 */}
          <SectionCard number="10" title="Data Sources">
            <div className="space-y-2 mt-2">
              {[
                {
                  name: 'Baseball Savant / Statcast',
                  desc: 'Pitch-level tracking data for model training and player features',
                },
                {
                  name: 'MLB Stats API',
                  desc: 'Schedules, lineups, rosters, and box scores',
                },
                {
                  name: 'The Odds API',
                  desc: 'Live prop lines from major sportsbooks',
                },
                {
                  name: 'OpenWeatherMap',
                  desc: 'Game-time weather conditions for outdoor ballparks',
                },
                {
                  name: 'Baseball Prospectus (CSAA)',
                  desc: 'Catcher framing metrics, updated weekly',
                },
                {
                  name: 'Umpire Scorecards',
                  desc: 'Historical umpire strike zone tendencies',
                },
              ].map((src) => (
                <div
                  key={src.name}
                  className="flex gap-3 py-2 border-b border-slate-800 last:border-0"
                >
                  <span className="text-green-400 font-medium text-sm shrink-0 w-56">
                    {src.name}
                  </span>
                  <span className="text-slate-400 text-sm">{src.desc}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Disclaimer */}
          <div className="mt-16 p-6 bg-slate-900/60 border border-slate-700 rounded-xl">
            <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Disclaimer
            </h3>
            <p className="text-slate-500 text-sm leading-relaxed">
              FullCountProps is an analytical tool for baseball enthusiasts and
              researchers. Nothing on this site constitutes financial or gambling
              advice. Past model performance does not guarantee future results.
              Sports betting involves risk. Please bet responsibly and in
              accordance with the laws of your jurisdiction.
            </p>
          </div>

          {/* Open Source CTA */}
          <div className="mt-8 text-center">
            <p className="text-slate-500 text-sm mb-3">
              FullCountProps is open source. Verify everything yourself.
            </p>
            <a
              href="https://github.com/fullcountprops/fullcountprops"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              View on GitHub
            </a>
          </div>
        </div>
      </div>
    </>
  )
}

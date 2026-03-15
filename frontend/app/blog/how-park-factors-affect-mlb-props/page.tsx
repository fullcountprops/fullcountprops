// ============================================================
// app/blog/how-park-factors-affect-mlb-props/page.tsx
//
// Target keywords:
//   "MLB park factors"
//   "how ballpark affects props"
//   "Coors Field over under"
//   "park factor baseball betting"
// ============================================================

import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'How Park Factors Affect MLB Player Props: Coors Field to Oracle Park | FullCountProps',
  description:
    'A complete guide to MLB park factors and how they shift player prop lines. Covers Coors Field, Oracle Park, Yankee Stadium, and how FullCountProps incorporates venue data.',
  openGraph: {
    title: 'How Park Factors Affect MLB Player Props: Coors Field to Oracle Park',
    description:
      'The ballpark can shift expected totals by 15–20%. Learn how park factors affect strikeout, home run, and hit props — and which venues move the needle most.',
    images: ['/og-image.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'How Park Factors Affect MLB Player Props',
    description:
      'From Coors Field to Oracle Park: how MLB venue effects impact strikeout, HR, and hit prop lines.',
  },
  keywords: [
    'MLB park factors',
    'how ballpark affects props',
    'Coors Field over under',
    'park factor baseball betting',
    'Oracle Park pitcher friendly',
    'Yankee Stadium home run factor',
    'baseball venue effects',
  ],
}

function JsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'How Park Factors Affect MLB Player Props: Coors Field to Oracle Park',
    description:
      'A complete guide to MLB park factors and how they shift player prop lines.',
    author: { '@type': 'Organization', name: 'FullCountProps' },
    publisher: { '@type': 'Organization', name: 'FullCountProps' },
    datePublished: '2026-03-15',
    dateModified: '2026-03-15',
    mainEntityOfPage: 'https://www.fullcountprops.com/blog/how-park-factors-affect-mlb-props',
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

export default function ParkFactorsGuide() {
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
              <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-blue-950/50 text-blue-400 border border-blue-800/50">
                Analytics
              </span>
              <span className="text-xs text-slate-500">March 15, 2026</span>
              <span className="text-xs text-slate-600">&middot;</span>
              <span className="text-xs text-slate-500">8 min read</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
              How Park Factors Affect MLB Player Props: Coors Field to Oracle Park
            </h1>
            <p className="text-slate-400 text-lg leading-relaxed">
              Every MLB stadium plays differently. The gap between the most hitter-friendly and
              most pitcher-friendly parks can shift expected run totals by 15–20% — and those
              differences cascade into strikeout props, home run props, and hit totals.
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

            <h2>What Is a Park Factor?</h2>

            <p>
              A park factor is a multiplier that adjusts for the offensive environment of a
              specific ballpark. A park factor of 1.10 for home runs means the venue produces
              10% more home runs than a neutral park, all else equal. A factor of 0.88 means
              12% fewer.
            </p>

            <p>
              Park factors are calculated from multi-year samples of actual game data, comparing
              home game run rates to road game run rates for the same teams. Because team quality
              affects totals, proper park factor calculation requires several years of data
              and adjustments for team composition — which is why the numbers change slowly
              from year to year rather than swinging wildly.
            </p>

            <p>
              Most sportsbooks incorporate some version of park factors into their lines. The
              question is whether they&apos;re using the same granularity you are. Many books apply
              a single run-environment factor. Better models — and better bettors — use
              <strong> stat-specific park factors</strong>: a separate factor for home runs, for
              strikeouts, for singles, and so on.
            </p>

            <h2>The Most Extreme Parks in MLB</h2>

            <h3>Coors Field (Colorado Rockies) — The Extreme Hitter&apos;s Park</h3>

            <p>
              No park in baseball distorts statistics more than Coors Field. At 5,280 feet above
              sea level, the thin air reduces air resistance on batted balls by roughly 10%,
              turning warning-track fly balls into home runs. The park factor for home runs at
              Coors is consistently the highest in the league — around 1.30–1.40 in most
              multi-year samples.
            </p>

            <p>
              For prop bettors, the Coors effect means:
            </p>
            <ul>
              <li>Home run over/under lines are set higher — and often still worth considering</li>
              <li>Hit prop overs carry real value when the wind is blowing out</li>
              <li>
                <strong>Strikeout under props deserve attention</strong> — thin air also reduces
                the movement on breaking balls, making pitchers less effective and lineups harder
                to punch out
              </li>
            </ul>

            <p>
              One counterintuitive point: Coors Field&apos;s effect on strikeout props is often
              underpriced by books. Lines don&apos;t always reflect the 0.92–0.94 strikeout park
              factor fully.
            </p>

            <h3>Oracle Park (San Francisco Giants) — The Pitcher&apos;s Haven</h3>

            <p>
              Oracle Park sits on the San Francisco Bay, where marine layer and cold evening air
              suppress fly balls and reduce overall offense. The park&apos;s deep power alleys and
              the tendency for winds to blow in off the water make it one of the toughest home
              run environments in baseball. The HR park factor for Oracle typically sits
              around 0.82–0.88.
            </p>

            <p>
              For props at Oracle Park:
            </p>
            <ul>
              <li>Home run unders are consistently valuable, especially for pull hitters</li>
              <li>Total bases props lean under — fewer extra-base hits in the spacious outfield</li>
              <li>
                Pitcher strikeout overs can benefit — the park amplifies fastball movement and
                generates more swings-and-misses than the same pitcher would see in a neutral venue
              </li>
            </ul>

            <h3>Yankee Stadium (New York Yankees) — The Short Porch</h3>

            <p>
              Yankee Stadium&apos;s right-field porch sits just 314 feet from home plate — the
              shortest in the American League. For left-handed pull hitters, this is the most
              home-run-friendly park in baseball. The park&apos;s HR factor for left-handed batters
              can exceed 1.40 in some samples, while the factor for right-handed batters is
              much closer to neutral.
            </p>

            <p>
              The practical implication: when a left-handed power hitter faces a pitcher who
              gives up pull fly balls, Yankee Stadium amplifies that matchup considerably.
              The opposite is also true — right-handed hitters who pull the ball get no benefit
              from the short porch and may actually see a slight suppression in their HR
              totals due to the deep left-center.
            </p>

            <h3>Petco Park and Dodger Stadium — Pitcher-Friendly West Coast Parks</h3>

            <p>
              San Diego&apos;s Petco Park and Dodger Stadium in Los Angeles share a common trait:
              cool coastal air, spacious outfields, and long foul territory that extends
              at-bats. Both suppress home runs and total offense. Pitcher strikeout overs
              at these venues tend to perform slightly above expectation compared to neutral-park
              projections.
            </p>

            <h2>How Park Factors Interact with Specific Prop Types</h2>

            <p>
              Not all props respond equally to park effects. Here&apos;s a quick breakdown:
            </p>

            <ul>
              <li>
                <strong>Home Run props</strong> — the most park-sensitive. HR park factors
                can shift expected probability by 15–30% in extreme venues.
              </li>
              <li>
                <strong>Total Bases props</strong> — affected by both HR and extra-base hit
                factors; Coors and Yankee Stadium lean over, Oracle and Petco lean under.
              </li>
              <li>
                <strong>Hit props</strong> — less park-sensitive than power props, but
                venues with large foul territories (like Oakland Coliseum or Petco) extend
                at-bats, which can subtly boost hit totals.
              </li>
              <li>
                <strong>Strikeout props</strong> — affected by altitude (thin air = less
                breaking ball movement) and atmospheric conditions. Coors is the clearest
                case; effects at other parks are smaller but real.
              </li>
            </ul>

            <h2>How FullCountProps Incorporates Park Factors</h2>

            <p>
              FullCountProps applies <strong>stat-specific park factors</strong> sourced from
              multi-year Statcast data for every game in the daily slate. Rather than a single
              run-environment multiplier, our model uses separate factors for home runs, extra-base
              hits, and strikeouts — each broken down by handedness where the sample size supports it.
            </p>

            <p>
              These factors are applied at the plate-appearance level inside our 5,000 Monte Carlo
              simulations. When the model generates a batted-ball outcome in a given simulation,
              the park factor shifts the probability of that ball leaving the yard — rather than
              being applied as a post-hoc correction to the final projection.
            </p>

            <p>
              You can see the park factor applied to any projection on the{' '}
              <Link href="/edges">edges page</Link> — it appears in the factor breakdown section
              of each card, expressed as a percentage adjustment. A park factor of +2.3% means
              the venue is adding that much to the probability of the projected outcome occurring.
            </p>

            <p>
              For the full venue-by-venue breakdown of how each park affects different stat types,
              see our <Link href="/park-factors">park factors reference page</Link>.
            </p>

            <h2>A Practical Example: Pitcher at Coors vs. Oracle Park</h2>

            <p>
              Consider a pitcher with a career K rate of 25% starting at Coors Field vs. the
              same pitcher starting at Oracle Park. The raw line might be set at 6.5 Ks in both
              cases if the books use a simplified park adjustment.
            </p>

            <p>
              Our model would project roughly 6.1 Ks at Coors (strikeout park factor ~0.93)
              and 7.0 Ks at Oracle (factor ~1.08). That&apos;s nearly a full strikeout of difference —
              more than enough to flip the value on a 6.5 line from slight over to comfortable
              under, or vice versa. When books don&apos;t fully price this, the result is a
              statistical edge.
            </p>

          </article>

          {/* CTA */}
          <div className="mt-12 p-6 bg-gradient-to-r from-blue-950/40 via-blue-900/20 to-blue-950/40 border border-blue-700/40 rounded-2xl">
            <h2 className="text-lg font-semibold text-white mb-2">
              See park-adjusted projections for today&apos;s slate
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Every FullCountProps projection already has park factors baked in. The factor
              breakdown shows exactly how much the venue is contributing to each edge.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/park-factors"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
              >
                View Park Factors &rarr;
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

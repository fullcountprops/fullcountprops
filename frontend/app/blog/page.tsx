import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Blog — MLB Prop Betting Guides & Analytics | FullCountProps',
  description:
    'In-depth guides on MLB prop betting, park factors, Monte Carlo simulation, and data-driven sports analytics from the FullCountProps team.',
  openGraph: {
    title: 'Blog — FullCountProps',
    description:
      'MLB prop betting guides, park factor breakdowns, and data-driven analytics from FullCountProps.',
  },
}

// ── Hardcoded posts array ──
// Add new posts here as objects. The blog index renders from this array.
const posts: {
  slug: string
  title: string
  date: string
  excerpt: string
  tag: string
  tagColor: string
  readTime: string
}[] = [
  {
    slug: 'mlb-strikeout-props-guide',
    title: 'MLB Strikeout Props: A Complete Guide to Pitcher K Predictions',
    date: 'March 15, 2026',
    excerpt:
      'Strikeout props are among the most predictable bets in baseball. Learn how K rate, whiff rate, and opponent strikeout percentage combine to give you a real edge — and how Monte Carlo simulation sharpens those numbers.',
    tag: 'Strategy',
    tagColor: 'bg-green-950/50 text-green-400 border border-green-800/50',
    readTime: '7 min read',
  },
  {
    slug: 'how-park-factors-affect-mlb-props',
    title: 'How Park Factors Affect MLB Player Props: Coors Field to Oracle Park',
    date: 'March 15, 2026',
    excerpt:
      "The ballpark a game is played in can shift expected totals by 15–20%. From Coors Field's thin air to Oracle Park's marine layer, understanding park factors is essential for serious prop bettors.",
    tag: 'Analytics',
    tagColor: 'bg-blue-950/50 text-blue-400 border border-blue-800/50',
    readTime: '8 min read',
  },
  {
    slug: 'monte-carlo-simulation-sports-betting',
    title: 'Monte Carlo Simulation in Sports Betting: How 3,000 Simulations Beat Point Estimates',
    date: 'March 15, 2026',
    excerpt:
      "A single projected strikeout number tells you little. Run 3,000 simulations of the same plate appearance and you get a full probability distribution — which is exactly what sportsbooks use. Here's how to think the same way.",
    tag: 'Methodology',
    tagColor: 'bg-purple-950/50 text-purple-400 border border-purple-800/50',
    readTime: '8 min read',
  },
  // Uncomment when ready:
  // {
  //   slug: 'opening-day-props-2026',
  //   title: 'Opening Day 2026: Our Top 3 MLB Prop Picks',
  //   date: 'March 27, 2026',
  //   excerpt:
  //     'The first official picks from FullCountProps. Three high-edge strikeout props with full factor breakdowns.',
  //   tag: 'Picks',
  //   tagColor: 'bg-yellow-950/50 text-yellow-400 border border-yellow-800/50',
  //   readTime: '5 min read',
  // },
]

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-3xl mx-auto px-4 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="text-sm text-green-400 font-medium uppercase tracking-wider mb-2">
            Resources
          </div>
          <h1 className="text-4xl font-bold text-white mb-4">Blog</h1>
          <p className="text-slate-400 text-lg leading-relaxed">
            Data-driven guides on MLB prop betting, simulation methods, and how to find real edges
            in player prop markets.
          </p>
        </div>

        {/* Post list */}
        <div className="space-y-6">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="block bg-slate-900 border border-slate-800 rounded-2xl p-6 hover:border-slate-600 transition-colors group"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${post.tagColor}`}>
                  {post.tag}
                </span>
                <span className="text-xs text-slate-500">{post.date}</span>
                <span className="text-xs text-slate-600">&middot;</span>
                <span className="text-xs text-slate-500">{post.readTime}</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2 group-hover:text-green-400 transition-colors leading-snug">
                {post.title}
              </h2>
              <p className="text-slate-400 text-sm leading-relaxed">{post.excerpt}</p>
              <div className="mt-4 text-sm text-green-400 font-medium">
                Read more &rarr;
              </div>
            </Link>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="mt-16 p-6 bg-gradient-to-r from-emerald-950/40 via-emerald-900/20 to-emerald-950/40 border border-emerald-700/40 rounded-2xl text-center">
          <h2 className="text-lg font-semibold text-white mb-2">
            Ready to put it into practice?
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Get today&apos;s edges, projections, and factor breakdowns — free for Single-A accounts.
          </p>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
          >
            View Pricing
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </main>
  )
}

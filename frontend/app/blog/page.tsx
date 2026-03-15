import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Blog – FullCountProps',
  description:
    'Analysis, methodology deep-dives, and pick breakdowns from FullCountProps. MLB prop analytics powered by Monte Carlo simulation.',
  openGraph: {
    title: 'FullCountProps Blog',
    description:
      'Analysis, methodology deep-dives, and pick breakdowns from FullCountProps.',
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
}[] = [
  // Uncomment when ready:
  // {
  //   slug: 'opening-day-props-2026',
  //   title: 'Opening Day 2026: Our Top 3 MLB Prop Picks',
  //   date: '2026-03-27',
  //   excerpt:
  //     'The first official picks from FullCountProps. Three high-edge strikeout props with full factor breakdowns.',
  //   tag: 'Picks',
  // },
]

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-4xl mx-auto px-4 py-16">
        <h1 className="text-3xl font-bold mb-2">Blog</h1>
        <p className="text-slate-400 mb-10">
          Analysis, methodology deep-dives, and pick breakdowns.
        </p>

        {posts.length === 0 ? (
          <div className="text-center py-20 border border-slate-800 rounded-xl">
            <p className="text-xl text-slate-400 mb-2">
              First post drops Opening Day 2026
            </p>
            <p className="text-sm text-slate-500">
              March 27, 2026 — Our first official pick breakdown with full
              factor analysis.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block border border-slate-800 rounded-xl p-6 hover:border-green-700/50 transition-colors"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded-full">
                    {post.tag}
                  </span>
                  <span className="text-xs text-slate-500">{post.date}</span>
                </div>
                <h2 className="text-lg font-semibold mb-1">{post.title}</h2>
                <p className="text-sm text-slate-400">{post.excerpt}</p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}

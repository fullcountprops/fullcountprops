import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Matchups — Coming Soon | FullCountProps',
  description: 'Head-to-head batter vs pitcher matchup tool. Coming soon.',
}

export default function MatchupsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-6">⚾</div>
      <h1 className="text-3xl font-bold text-white mb-4">Matchup Tool</h1>
      <p className="text-slate-400 mb-2 text-lg">
        Head-to-head batter vs pitcher analysis is coming soon.
      </p>
      <p className="text-slate-500 mb-8">
        This feature is under active development. Check back after Opening Day.
      </p>
      <Link
        href="/"
        className="inline-block bg-green-500 hover:bg-green-600 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
      >
        Back to Home
      </Link>
    </div>
  )
}

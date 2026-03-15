import { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Starting Pitcher Preview — Coming Soon | FullCountProps',
  description: 'Daily starting pitcher matchup grades with per-batter projections. Coming soon.',
}

export default function PitcherPreviewPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-6">⚾</div>
      <h1 className="text-3xl font-bold text-white mb-4">Pitcher Preview</h1>
      <p className="text-slate-400 mb-2 text-lg">
        Daily starting pitcher matchup grades are coming soon.
      </p>
      <p className="text-slate-500 mb-8">
        Per-batter projections, strikeout estimates, and win probability will be available after Opening Day.
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

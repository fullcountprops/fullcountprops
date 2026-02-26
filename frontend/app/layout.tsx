import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Baseline MLB — Glass-Box MLB Analytics',
  description: 'MLB player prop analytics with transparent, glass-box AI projections. Every factor logged. Every result graded publicly.',
  keywords: 'MLB, baseball, analytics, player props, betting, strikeouts, Statcast',
  openGraph: {
    title: 'Baseline MLB',
    description: 'Glass-box MLB prop analytics. No black boxes.',
    url: 'https://baselinemlb.com',
    siteName: 'Baseline MLB',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#0a0e1a] text-slate-100">
        <nav className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-blue-400">BASELINE</span>
              <span className="text-xl font-bold text-white">MLB</span>
              <span className="ml-2 px-2 py-0.5 text-xs bg-blue-900 text-blue-300 rounded-full border border-blue-700">BETA</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <a href="/" className="text-slate-300 hover:text-white transition-colors">Today</a>
              <a href="/props" className="text-slate-300 hover:text-white transition-colors">Props</a>
              <a href="https://nrlefty5.github.io/baselinemlb/" target="_blank" className="text-slate-300 hover:text-white transition-colors">Accuracy</a>
              <a href="https://twitter.com/baselinemlb" target="_blank" className="text-blue-400 hover:text-blue-300 transition-colors">@baselinemlb</a>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
        <footer className="border-t border-gray-800 mt-16 px-6 py-8 text-center text-sm text-slate-500">
          <p>Baseline MLB — Glass-box analytics. Not financial or betting advice. Data sourced from MLB Stats API, Statcast, and The Odds API.</p>
          <p className="mt-2"><a href="https://twitter.com/baselinemlb" className="text-blue-400 hover:text-blue-300">@baselinemlb</a></p>
        </footer>
      </body>
    </html>
  )
}

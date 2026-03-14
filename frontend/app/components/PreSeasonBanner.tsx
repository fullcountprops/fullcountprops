import Link from 'next/link'

const OPENING_DAY = new Date('2026-03-27T00:00:00-04:00')

interface PreSeasonBannerProps {
  /** What this page will show once the season starts */
  featureDescription: string
  /** Optional: specific date override (defaults to March 27) */
  openingDay?: string
}

export function PreSeasonBanner({
  featureDescription,
  openingDay = 'March 27, 2026',
}: PreSeasonBannerProps) {
  const isPreSeason = new Date() < OPENING_DAY
  if (!isPreSeason) return null

  return (
    <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-lg" aria-hidden="true">⚠️</span>
        <div>
          <p className="font-medium text-amber-200">
            Pre-Season — Opening Day is {openingDay}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {featureDescription}{' '}
            Live data will populate automatically once the 2026 MLB season begins.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/methodology"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              How the model works →
            </Link>
            <Link
              href="/accuracy"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-700 hover:text-white"
            >
              View 2025 backtest results →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

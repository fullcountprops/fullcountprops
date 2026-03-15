// ============================================================
// StaleDataBanner — Amber warning banner for stale/missing data
// ============================================================

import type { FreshnessStatus } from '../lib/dataFreshness'

interface StaleDataBannerProps {
  status: FreshnessStatus
  lastUpdated: string | null
}

function formatTimeET(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    timeZoneName: 'short',
  })
}

export default function StaleDataBanner({ status, lastUpdated }: StaleDataBannerProps) {
  if (status === 'fresh') return null

  const message =
    status === 'missing'
      ? 'Live projections are temporarily unavailable. Showing most recent available data.'
      : `Data last updated ${lastUpdated ? formatTimeET(lastUpdated) : 'unknown'} ET. Refresh may be delayed.`

  return (
    <div className="max-w-6xl mx-auto px-4 mb-4">
      <div className="flex items-start gap-3 p-4 bg-amber-950/40 border border-amber-800/50 rounded-xl">
        <svg
          className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
          />
        </svg>
        <p className="text-amber-200 text-sm">{message}</p>
      </div>
    </div>
  )
}

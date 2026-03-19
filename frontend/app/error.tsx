'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App error:', error)
    // If Sentry is available, capture the error
    if (typeof window !== 'undefined' && (window as any).__SENTRY__) {
      import('@sentry/nextjs').then(Sentry => Sentry.captureException(error))
    }
  }, [error])

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h2 className="text-xl font-bold text-white mb-2">Something went wrong</h2>
        <p className="text-slate-400 text-sm mb-6">
          We hit an unexpected error. This has been logged and we&apos;re looking into it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={reset}
            className="rounded-lg bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 text-sm font-medium transition-colors"
          >
            Try Again
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white px-6 py-2.5 text-sm font-medium transition-colors"
          >
            Go Home
          </a>
        </div>
      </div>
    </div>
  )
}

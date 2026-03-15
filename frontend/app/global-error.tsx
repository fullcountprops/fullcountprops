'use client'
// ============================================================
// app/global-error.tsx — FullCountProps
// Root-level error boundary. Captures uncaught errors to Sentry
// and renders a fallback UI. This replaces the root layout on error,
// so it must include <html> and <body> tags.
// ============================================================

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, backgroundColor: '#020617', color: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#f87171', marginBottom: '0.75rem' }}>
            Unexpected Error
          </p>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 700, color: '#ffffff', marginBottom: '1rem', lineHeight: 1.3 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '1rem', color: '#94a3b8', maxWidth: '28rem', lineHeight: 1.7, marginBottom: '2rem' }}>
            An unexpected error occurred. The error has been reported and we&apos;ll look into it.
          </p>
          <button
            onClick={reset}
            style={{
              display: 'inline-block',
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: '#ffffff',
              backgroundColor: '#16a34a',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}

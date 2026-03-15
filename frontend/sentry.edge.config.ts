// ============================================================
// sentry.edge.config.ts — FullCountProps
// Sentry SDK initialization for Next.js Edge runtime (middleware, edge routes).
// This file is loaded automatically by @sentry/nextjs in the edge runtime.
// DSN is read from SENTRY_DSN (server-only env var).
// ============================================================

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,

    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,
  })
}

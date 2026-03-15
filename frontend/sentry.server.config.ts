// ============================================================
// sentry.server.config.ts — FullCountProps
// Sentry Node.js SDK initialization for Next.js server runtime.
// This file is loaded automatically by @sentry/nextjs on the server.
// DSN is read from SENTRY_DSN (server-only, not exposed to the browser).
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

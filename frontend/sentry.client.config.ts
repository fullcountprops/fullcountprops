// ============================================================
// sentry.client.config.ts — FullCountProps
// Sentry browser SDK initialization.
// This file is loaded automatically by @sentry/nextjs in the browser.
// DSN is read from NEXT_PUBLIC_SENTRY_DSN; if unset, Sentry is a no-op.
// ============================================================

import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,

    // Capture 10% of transactions for performance monitoring
    tracesSampleRate: 0.1,

    // No continuous session replays — only capture on error
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
      Sentry.replayIntegration(),
    ],
  })
}

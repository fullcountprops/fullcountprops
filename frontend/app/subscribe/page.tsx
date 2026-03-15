// ===========================================================
// /subscribe — Subscription Tier Comparison Page
// Server component with metadata; client interactions in
// SubscribeClient.tsx
// ===========================================================

import { Metadata } from 'next'
import SubscribeClient from './SubscribeClient'

export const metadata: Metadata = {
  title: 'Subscribe – FullCountProps',
  description: 'Unlock full MLB prop edges: Double-A ($7.99/mo), Triple-A ($29.99/mo), or The Show ($49.99/mo). Daily email alerts, API access, and more.',
  openGraph: {
    title: 'Subscribe to FullCountProps',
    description: 'MLB prop analytics starting at $7.99/mo. Full slate access, SHAP explanations, and glass-box transparency on every pick.',
  },
}

export default function SubscribePage() {
  return <SubscribeClient />
}

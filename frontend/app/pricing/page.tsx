// frontend/app/(main)/pricing/page.tsx
// ============================================================
// FullCountProps — Pricing Page (Issue #8: 4-tier MiLB structure)
// ============================================================

import type { Metadata } from 'next';
import PricingClient from './PricingClient';

export const metadata: Metadata = {
  title: 'Pricing — FullCountProps',
  description:
    'Choose your tier: Single-A (free), Double-A ($9/mo), Triple-A ($19/mo), or The Show ($39/mo). Glass-box MLB prop analytics with PA-level Monte Carlo simulations.',
  openGraph: {
    title: 'Pricing — FullCountProps',
    description:
      'MLB prop analytics from $9/mo. Every projection transparent. Every result graded publicly.',
  },
};

export default function PricingPage() {
  return <PricingClient />;
}

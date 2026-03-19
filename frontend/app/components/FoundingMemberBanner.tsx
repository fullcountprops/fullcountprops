'use client';
// frontend/app/components/FoundingMemberBanner.tsx
// Reads from /api/founding-status — purely client-side, never SSR.

import { useState, useEffect } from 'react';
import { FOUNDING_MEMBER_CAP } from '@/app/lib/tiers';

interface FoundingStatusResponse {
  isAvailable: boolean;
  remaining: number;
  cap: number;
}

// ---- Banner above pricing cards ----

export function FoundingMemberBanner() {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean>(false);

  useEffect(() => {
    fetch('/api/founding-status')
      .then((r) => r.json())
      .then((data) => {
        setRemaining(data.remaining ?? null);
        setIsAvailable(data.isAvailable ?? false);
      })
      .catch(() => {
        setRemaining(null);
        setIsAvailable(false);
      });
  }, []);

  if (remaining === null || !isAvailable || remaining <= 0) return null;

  const cap = FOUNDING_MEMBER_CAP;
  const borderClass =
    remaining <= 10
      ? 'border-red-500/50 bg-red-950/30'
      : remaining <= 20
      ? 'border-yellow-500/50 bg-yellow-950/30'
      : 'border-emerald-500/50 bg-emerald-950/30';
  const accentClass =
    remaining <= 10 ? 'text-red-400' : remaining <= 20 ? 'text-yellow-400' : 'text-emerald-400';

  return (
    <div className={`mb-8 rounded-xl border px-6 py-4 text-center ${borderClass}`}>
      <p className={`text-sm font-semibold ${accentClass}`}>
        ⚡ Founding Member Pricing — {remaining} of {cap} spots left
      </p>
      <p className="mt-1 text-sm text-gray-300">
        Lock in{' '}
        <span className="font-bold text-white">$4.99/mo for life</span>
        {' '}before spots run out.{' '}
        <span className="text-gray-500 line-through">$7.99/mo</span> after launch pricing.
      </p>
    </div>
  );
}

// ---- Inline price display for the Double-A card ----

export function FoundingPriceDisplay() {
  const [status, setStatus] = useState<FoundingStatusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/founding-status')
      .then((r) => r.json())
      .then((data) => { setStatus(data); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  // Skeleton — same height as price to avoid layout shift
  if (!loaded) {
    return <div className="h-10 w-28 rounded bg-gray-800 animate-pulse" />;
  }

  if (status?.isAvailable) {
    return (
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-4xl font-bold">$4.99</span>
        <span className="text-gray-400 ml-1">/mo</span>
        <span className="text-gray-600 text-sm line-through">$7.99/mo</span>
      </div>
    );
  }

  return (
    <div className="flex items-baseline">
      <span className="text-4xl font-bold">$7.99</span>
      <span className="text-gray-400 ml-1">/mo</span>
    </div>
  );
}

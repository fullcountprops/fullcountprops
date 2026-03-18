'use client';
// frontend/app/components/SeasonAwareCTA.tsx
// On mount: checks today's projections count (ET timezone).
// - count > 0  → "See Today's Top Picks" with pick badge + "See All Plans"
// - count === 0 → OpeningDaySignup (pre-season / off-day state)
// - loading    → skeleton
// - error      → falls back to pre-season state

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/app/lib/supabase-browser';
import { OpeningDaySignup } from './OpeningDaySignup';

function getTodayET(): string {
  // Returns YYYY-MM-DD in America/New_York
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default function SeasonAwareCTA() {
  const [pickCount, setPickCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const today = getTodayET();

    supabase
      .from('projections')
      .select('*', { count: 'exact', head: true })
      .eq('game_date', today)
      .then(({ count, error }) => {
        setPickCount(error ? 0 : (count ?? 0));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="h-12 w-52 rounded-lg bg-slate-800 animate-pulse" />
        <div className="h-12 w-32 rounded-lg bg-slate-800 animate-pulse" />
      </div>
    );
  }

  if (pickCount && pickCount > 0) {
    return (
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/edges"
          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-green-500"
        >
          See Today&apos;s Top Picks
          <span className="inline-flex items-center justify-center rounded-full bg-green-500 px-2 py-0.5 text-xs font-bold">
            {pickCount}
          </span>
        </Link>
        <Link
          href="/pricing"
          className="rounded-lg border border-slate-700 px-6 py-3 text-base font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
        >
          See All Plans
        </Link>
      </div>
    );
  }

  // Pre-season or no picks today
  return (
    <div className="w-full max-w-md">
      <p className="mb-2 text-xs text-slate-500">
        Season starts March 26. Get notified:
      </p>
      <OpeningDaySignup source="homepage_hero" />
    </div>
  );
}

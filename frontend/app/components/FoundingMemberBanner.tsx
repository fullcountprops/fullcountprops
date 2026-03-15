'use client';

// ============================================================
// FoundingMemberBanner — Shows remaining founding member spots
//
// Drop into SubscribeClient.tsx above the pricing cards grid.
// Reads count from Supabase (active double_a subscriptions).
//
// Usage:
//   <FoundingMemberBanner />
//
// To disable: remove the component or set NEXT_PUBLIC_FOUNDING_MEMBER_ENABLED=false
// ============================================================

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const TOTAL_SPOTS = 100;
const FOUNDING_PRICE = 4.99;
const REGULAR_PRICE = 9;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

export function FoundingMemberBanner() {
  const [claimedCount, setClaimedCount] = useState<number | null>(null);

  useEffect(() => {
    async function fetchCount() {
      try {
        const { count, error } = await supabase
          .from('subscriptions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'active')
          .in('tier', ['double_a', 'pro']); // include legacy 'pro' tier name

        if (!error && count !== null) {
          setClaimedCount(count);
        }
      } catch {
        // Silently fail — banner just won't show count
      }
    }
    fetchCount();
  }, []);

  const remaining = claimedCount !== null
    ? Math.max(0, TOTAL_SPOTS - claimedCount)
    : TOTAL_SPOTS;

  const isSoldOut = remaining === 0;
  const urgencyLevel = remaining <= 10 ? 'critical' : remaining <= 30 ? 'high' : 'normal';

  if (isSoldOut) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 mb-8">
      <div className={`rounded-xl border p-6 text-center ${
        urgencyLevel === 'critical'
          ? 'border-red-800/50 bg-red-950/20'
          : 'border-green-800/50 bg-green-950/20'
      }`}>
        <p className="text-green-400 font-semibold text-xs uppercase tracking-widest mb-2">
          Founding Member Offer
        </p>
        <p className="text-white text-2xl font-bold mb-1">
          Lock in ${FOUNDING_PRICE}/mo for life
          <span className="text-slate-500 text-lg font-normal ml-2 line-through">
            ${REGULAR_PRICE}/mo
          </span>
        </p>
        <p className="text-slate-400 text-sm">
          {urgencyLevel === 'critical' ? (
            <>
              <span className="text-red-400 font-semibold">Only {remaining} spots left</span>
              {' '}— founding rate is locked permanently for early subscribers.
            </>
          ) : (
            <>
              First {TOTAL_SPOTS} subscribers get the founding rate — permanently.
              {claimedCount !== null && (
                <span className="text-green-400 font-medium"> {remaining} of {TOTAL_SPOTS} remaining.</span>
              )}
            </>
          )}
        </p>

        {/* Progress bar */}
        {claimedCount !== null && (
          <div className="mt-4 max-w-xs mx-auto">
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  urgencyLevel === 'critical' ? 'bg-red-500' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min(100, (claimedCount / TOTAL_SPOTS) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-600 mt-1">
              {claimedCount} of {TOTAL_SPOTS} claimed
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

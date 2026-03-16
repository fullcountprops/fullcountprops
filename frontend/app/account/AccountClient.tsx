'use client';
// frontend/app/account/AccountClient.tsx

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/app/lib/supabase-browser';
import { normalizeTier, type TierName } from '@/app/lib/tiers';

const TIER_LABELS: Record<TierName, string> = {
  single_a: 'Single-A (Free)',
  double_a: 'Double-A',
  triple_a: 'Triple-A',
  the_show: 'The Show',
};

export default function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const checkoutSuccess = searchParams.get('checkout') === 'success';
  const planParam = searchParams.get('plan') as TierName | null;

  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<TierName>('single_a');
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login?redirect=/account');
        return;
      }
      setEmail(user.email ?? null);
      setTier(normalizeTier(user.user_metadata?.subscription_tier));
      setAuthReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push('/login?redirect=/account');
        return;
      }
      setEmail(session.user.email ?? null);
      setTier(normalizeTier(session.user.user_metadata?.subscription_tier));
      setAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, [router]);

  // Tier shown in the success banner: prefer URL param (freshly purchased)
  // since user_metadata may not have updated yet when the page first loads.
  const successTierLabel =
    planParam && planParam in TIER_LABELS
      ? TIER_LABELS[planParam]
      : TIER_LABELS[tier];

  if (!authReady) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-16">

        {/* Success banner */}
        {checkoutSuccess && (
          <div className="mb-8 rounded-xl border border-emerald-600/40 bg-emerald-950/50 px-6 py-4">
            <div className="flex items-start gap-3">
              <svg
                className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-emerald-300">
                  Welcome to {successTierLabel}!
                </p>
                <p className="text-sm text-emerald-400/80 mt-0.5">
                  Your subscription is active. You now have full access to your tier&apos;s features.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <h1 className="text-2xl font-bold mb-8">Account</h1>

        {/* Account details card */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800">
          <div className="px-6 py-4 flex items-center justify-between">
            <span className="text-sm text-gray-400">Email</span>
            <span className="text-sm text-white">{email}</span>
          </div>
          <div className="px-6 py-4 flex items-center justify-between">
            <span className="text-sm text-gray-400">Plan</span>
            <span className="text-sm font-medium text-white">{TIER_LABELS[tier]}</span>
          </div>
        </div>

        {/* CTAs */}
        <div className="mt-8 flex flex-col sm:flex-row gap-3">
          <a
            href="/edges"
            className="flex-1 text-center rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-3 px-4 transition-colors"
          >
            View Today&apos;s Edges
          </a>
          {tier === 'single_a' ? (
            <a
              href="/pricing"
              className="flex-1 text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-3 px-4 transition-colors"
            >
              Upgrade Plan
            </a>
          ) : (
            <a
              href="mailto:support@fullcountprops.com?subject=Manage%20Subscription"
              className="flex-1 text-center rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-semibold py-3 px-4 transition-colors"
            >
              Manage Subscription
            </a>
          )}
        </div>

        {tier !== 'single_a' && (
          <p className="mt-3 text-xs text-gray-600 text-center">
            To cancel or change your plan, email{' '}
            <a href="mailto:support@fullcountprops.com" className="underline hover:text-gray-400">
              support@fullcountprops.com
            </a>
          </p>
        )}
      </div>
    </div>
  );
}

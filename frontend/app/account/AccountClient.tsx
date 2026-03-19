'use client';
// frontend/app/account/AccountClient.tsx

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/app/lib/supabase-browser';
import { normalizeTier, type TierName } from '@/app/lib/tiers';

const TIER_LABELS: Record<TierName, string> = {
  single_a: 'Single-A (Free)',
  double_a: 'Double-A',
  triple_a: 'Triple-A',
  the_show: 'The Show',
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  active:   { label: 'Active',   className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  trialing: { label: 'Trial',    className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  past_due: { label: 'Past Due', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
  canceled: { label: 'Canceled', className: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
  unpaid:   { label: 'Unpaid',   className: 'bg-red-500/20 text-red-400 border-red-500/30' },
};

interface SubscriptionRecord {
  status: string;
  founding_member: boolean;
  tier: string | null;
}

export default function AccountClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState<string | null>(null);
  const [tier, setTier] = useState<TierName>('single_a');
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [managingPortal, setManagingPortal] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [showSuccess, setShowSuccess] = useState(searchParams.get('success') === 'true');
  const [subscription, setSubscription] = useState<SubscriptionRecord | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        router.push('/login?redirect=/account');
        return;
      }
      setEmail(user.email ?? null);
      setTier(normalizeTier(user.user_metadata?.subscription_tier));
      setAuthReady(true);

      // Fetch subscription record for status + founding_member badge
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, founding_member, tier')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (sub) {
        setSubscription(sub as SubscriptionRecord);
        // Prefer tier from subscriptions table (updated by webhook) over user_metadata
        if (sub.tier) setTier(normalizeTier(sub.tier));
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
    });

    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!s) {
        router.push('/login?redirect=/account');
        return;
      }
      setSession(s);
      setEmail(s.user.email ?? null);
      setTier(normalizeTier(s.user.user_metadata?.subscription_tier));
      setAuthReady(true);
    });

    return () => authListener.unsubscribe();
  }, [router]);

  // Auto-dismiss success banner after 8s and clean ?success=true from URL
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => setShowSuccess(false), 8000);
      window.history.replaceState({}, '', '/account');
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  async function handleManageSubscription() {
    if (!session) return;
    setManagingPortal(true);
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data: { url?: string } = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return; // don't reset managingPortal — navigating away
      }
    } catch {
      // fall through to fallback
    }
    setManagingPortal(false);
    router.push('/pricing');
  }

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/');
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="animate-pulse space-y-4 w-full max-w-2xl mx-auto px-4 py-16">
          <div className="h-8 w-32 rounded bg-slate-800" />
          <div className="rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
            <div className="px-6 py-4 flex justify-between">
              <div className="h-4 w-16 rounded bg-slate-800" />
              <div className="h-4 w-48 rounded bg-slate-800" />
            </div>
            <div className="px-6 py-4 flex justify-between">
              <div className="h-4 w-10 rounded bg-slate-800" />
              <div className="h-4 w-28 rounded bg-slate-800" />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1 h-11 rounded-lg bg-slate-800" />
            <div className="flex-1 h-11 rounded-lg bg-slate-800" />
          </div>
        </div>
      </div>
    );
  }

  const isPaidTier = tier !== 'single_a';
  const statusInfo = subscription?.status ? STATUS_LABELS[subscription.status] : null;
  const isFoundingMember = subscription?.founding_member === true;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-16">

        {/* Success banner */}
        {showSuccess && (
          <div
            onClick={() => setShowSuccess(false)}
            className="mb-6 cursor-pointer rounded-lg border border-green-800/50 bg-green-950/40 px-4 py-3 text-center text-sm text-green-300 transition-opacity hover:opacity-80"
          >
            Welcome! Your subscription is active. Click to dismiss.
          </div>
        )}

        {/* Header */}
        <h1 className="text-2xl font-bold mb-8">Account</h1>

        {/* Account details card */}
        <div className="rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
          <div className="px-6 py-4 flex items-center justify-between gap-4">
            <span className="text-sm text-slate-400 shrink-0">Email</span>
            <span className="text-sm text-white truncate">{email}</span>
          </div>
          <div className="px-6 py-4 flex items-center justify-between gap-4">
            <span className="text-sm text-slate-400 shrink-0">Plan</span>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <span className="text-sm font-medium text-white">{TIER_LABELS[tier]}</span>
              {isFoundingMember && (
                <span className="text-xs font-semibold border rounded-full px-2 py-0.5 bg-amber-500/20 text-amber-400 border-amber-500/30">
                  Founding Member
                </span>
              )}
            </div>
          </div>
          {statusInfo && (
            <div className="px-6 py-4 flex items-center justify-between">
              <span className="text-sm text-slate-400">Status</span>
              <span className={`text-xs font-semibold border rounded-full px-2 py-0.5 ${statusInfo.className}`}>
                {statusInfo.label}
              </span>
            </div>
          )}
        </div>

        {/* Primary CTAs */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <a
            href="/edges"
            className="flex-1 text-center rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold py-3 px-4 transition-colors"
          >
            View Today&apos;s Edges
          </a>
          {isPaidTier ? (
            <button
              onClick={handleManageSubscription}
              disabled={managingPortal}
              className="flex-1 text-center rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white text-sm font-semibold py-3 px-4 transition-colors disabled:opacity-50"
            >
              {managingPortal ? 'Opening portal…' : 'Manage Subscription'}
            </button>
          ) : (
            <a
              href="/pricing"
              className="flex-1 text-center rounded-lg border border-slate-700 hover:border-slate-500 text-slate-300 hover:text-white text-sm font-semibold py-3 px-4 transition-colors"
            >
              Upgrade Plan
            </a>
          )}
        </div>

        {/* Log Out */}
        <div className="mt-3">
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full text-center rounded-lg py-3 px-4 text-sm text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            {signingOut ? 'Signing out…' : 'Log Out'}
          </button>
        </div>
      </div>
    </div>
  );
}

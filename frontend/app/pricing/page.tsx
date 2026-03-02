'use client'

// ============================================================
// /pricing — Subscription pricing page with monthly/annual toggle
// Two tiers: Pro Monthly ($29/mo) and Pro Annual ($199/yr)
// Calls /api/checkout to create Stripe Checkout sessions
// ============================================================

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
)

type BillingPeriod = 'monthly' | 'annual'

const PLANS = {
  monthly: {
    name: 'Pro Monthly',
    price: 29,
    period: '/month',
    plan: 'pro_monthly',
    savings: null,
  },
  annual: {
    name: 'Pro Annual',
    price: 199,
    period: '/year',
    plan: 'pro_annual',
    savings: 'Save $149/yr vs monthly',
  },
}

const PRO_FEATURES = [
  'All prop edges — full slate every day',
  'Probability distributions for every pick',
  'SHAP feature attribution (glass-box transparency)',
  'Kelly criterion bet sizing',
  'Daily email digest at 11am ET',
  'Player prediction history',
  'Backtest accuracy by stat type',
]

const FREE_FEATURES = [
  'Top 3 edges per day (blurred after 3)',
  'Grade & direction (Over/Under)',
  'Basic model accuracy stats',
  'Daily slate overview',
]

export default function PricingPage() {
  const [billing, setBilling] = useState<BillingPeriod>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)
  const [currentTier, setCurrentTier] = useState<string>('free')

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUser(data.user)
        setCurrentTier(data.user.user_metadata?.subscription_tier || 'free')
      }
    })
  }, [])

  async function handleCheckout() {
    setError(null)
    setLoading(true)

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        // Redirect to sign-in, then come back
        setError('Please sign in to subscribe.')
        setLoading(false)
        return
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: PLANS[billing].plan,
          access_token: session.access_token,
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to create checkout session')
      }

      window.location.href = data.url
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setLoading(false)
    }
  }

  async function handlePortal() {
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setError('Please sign in to manage your subscription.')
        setLoading(false)
        return
      }

      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: session.access_token }),
      })

      const data = await res.json()
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to open subscription portal')
      }

      window.location.href = data.url
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setError(message)
      setLoading(false)
    }
  }

  const activePlan = PLANS[billing]

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Hero */}
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          Upgrade Your Edge
        </h1>
        <p className="text-slate-400 text-lg max-w-xl mx-auto">
          BaselineMLB runs thousands of Monte Carlo simulations per game to surface
          statistically significant prop bets. Unlock the full slate with Pro.
        </p>
      </div>

      {/* Billing Toggle */}
      <div className="flex items-center justify-center gap-3 mb-10">
        <button
          onClick={() => setBilling('monthly')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            billing === 'monthly'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setBilling('annual')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            billing === 'annual'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          Annual
          <span className="ml-1.5 text-xs text-green-400">Save 43%</span>
        </button>
      </div>

      {/* Pricing Cards */}
      <div className="max-w-4xl mx-auto px-4 pb-20 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Free Tier */}
        <div className="rounded-2xl p-6 border border-slate-700 bg-slate-900">
          <h2 className="text-2xl font-bold">Free</h2>
          <div className="mt-2 mb-4">
            <span className="text-3xl font-bold">$0</span>
            <span className="text-slate-400 text-sm">/forever</span>
          </div>
          <p className="text-slate-400 text-sm mb-6">
            Get started with MLB prop analytics
          </p>
          <ul className="space-y-2 mb-8">
            {FREE_FEATURES.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-slate-500 mt-0.5">✓</span>
                <span className="text-slate-400">{f}</span>
              </li>
            ))}
          </ul>
          <button
            disabled
            className="w-full py-3 rounded-lg bg-slate-800 text-slate-500 font-medium cursor-not-allowed"
          >
            Current Plan
          </button>
        </div>

        {/* Pro Tier */}
        <div className="rounded-2xl p-6 border border-blue-500 bg-blue-950/30 ring-1 ring-blue-500">
          <div className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-3">
            {billing === 'annual' ? 'Best Value' : 'Most Popular'}
          </div>
          <h2 className="text-2xl font-bold">{activePlan.name}</h2>
          <div className="mt-2 mb-1">
            <span className="text-3xl font-bold">${activePlan.price}</span>
            <span className="text-slate-400 text-sm">{activePlan.period}</span>
          </div>
          {activePlan.savings && (
            <p className="text-green-400 text-xs mb-4">{activePlan.savings}</p>
          )}
          {!activePlan.savings && <div className="mb-4" />}
          <p className="text-slate-400 text-sm mb-6">
            Everything you need to bet smarter
          </p>
          <ul className="space-y-2 mb-8">
            {PRO_FEATURES.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-green-400 mt-0.5">✓</span>
                <span className="text-slate-300">{f}</span>
              </li>
            ))}
          </ul>

          {currentTier === 'pro' ? (
            <button
              onClick={handlePortal}
              disabled={loading}
              className="w-full py-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 font-medium transition-colors disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Manage Subscription'}
            </button>
          ) : (
            <button
              onClick={handleCheckout}
              disabled={loading}
              className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Redirecting to Stripe...' : `Get Pro — $${activePlan.price}${activePlan.period}`}
            </button>
          )}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="max-w-md mx-auto px-4 pb-8 text-center">
          <p className="text-sm text-red-400">{error}</p>
          {error.includes('sign in') && (
            <p className="text-xs text-slate-500 mt-2">
              <Link href="/subscribe" className="text-blue-400 hover:underline">
                Create an account or sign in
              </Link>{' '}
              to subscribe.
            </p>
          )}
        </div>
      )}

      {/* FAQ / Guarantee */}
      <div className="max-w-2xl mx-auto px-4 pb-20 text-center">
        <p className="text-slate-500 text-sm">
          Cancel anytime. Payments processed securely by Stripe.
          {billing === 'annual' && ' Annual plan billed as a single payment of $199.'}
        </p>
      </div>
    </div>
  )
}

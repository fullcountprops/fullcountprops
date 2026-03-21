// frontend/app/(admin)/admin/page.tsx
// FCP Founder Dashboard — server component, service-role Supabase queries.

import type { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'FCP Admin',
  robots: { index: false, follow: false },
}

// ---------------------------------------------------------------------------
// Supabase service client (bypasses RLS)
// ---------------------------------------------------------------------------
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// ---------------------------------------------------------------------------
// Data fetchers — every one wrapped in try/catch, returns null on failure
// ---------------------------------------------------------------------------

interface PipelineData {
  projectionCount: number
  gameCount: number
  gamesWithProjections: number
  lastUpdated: Date | null
}

async function getPipelineData(): Promise<PipelineData | null> {
  try {
    const supabase = getServiceClient()
    const today = new Date().toISOString().split('T')[0]

    const [projResult, gamesResult] = await Promise.all([
      supabase
        .from('projections')
        .select('game_pk, updated_at')
        .eq('game_date', today),
      supabase
        .from('games')
        .select('game_pk', { count: 'exact', head: true })
        .eq('game_date', today),
    ])

    const rows = projResult.data ?? []
    const lastUpdated = rows.length
      ? new Date(
          rows.reduce((max, r) =>
            r.updated_at > max ? r.updated_at : max,
            rows[0].updated_at
          )
        )
      : null

    const distinctGames = new Set(rows.map((r: any) => r.game_pk)).size

    return {
      projectionCount: rows.length,
      gameCount: gamesResult.count ?? 0,
      gamesWithProjections: distinctGames,
      lastUpdated,
    }
  } catch {
    return null
  }
}

interface ModelHealthData {
  minConf: number | null
  maxConf: number | null
  avgConf: number | null
  total: number
}

async function getModelHealth(): Promise<ModelHealthData | null> {
  try {
    const supabase = getServiceClient()
    const today = new Date().toISOString().split('T')[0]

    const { data } = await supabase
      .from('projections')
      .select('confidence')
      .eq('game_date', today)
      .limit(500)

    if (!data || data.length === 0) return { minConf: null, maxConf: null, avgConf: null, total: 0 }

    const vals = data.map((r: any) => Number(r.confidence)).filter((v) => !isNaN(v))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const avg = vals.reduce((s, v) => s + v, 0) / vals.length

    return { minConf: min, maxConf: max, avgConf: avg, total: vals.length }
  } catch {
    return null
  }
}

interface SubscriberData {
  byTier: Record<string, number>
  foundingCount: number
  emailCount: number
}

const FOUNDING_PRICE_ID = 'price_1TB8vOCHMWdtVF7LZY7ThWrX'

async function getSubscriberData(): Promise<SubscriberData | null> {
  try {
    const supabase = getServiceClient()

    const [subResult, emailResult] = await Promise.all([
      supabase
        .from('subscriptions')
        .select('tier, stripe_price_id')
        .eq('status', 'active'),
      supabase
        .from('email_subscribers')
        .select('id', { count: 'exact', head: true }),
    ])

    const subs = subResult.data ?? []
    const byTier: Record<string, number> = {}
    let foundingCount = 0

    for (const s of subs) {
      const tier = s.tier ?? 'single_a'
      byTier[tier] = (byTier[tier] ?? 0) + 1
      if (s.stripe_price_id === FOUNDING_PRICE_ID) foundingCount++
    }

    return {
      byTier,
      foundingCount,
      emailCount: emailResult.count ?? 0,
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcMRR(byTier: Record<string, number>, foundingCount: number): number {
  const prices: Record<string, number> = {
    single_a: 0,
    double_a: 7.99,
    triple_a: 29.99,
    the_show: 49.99,
  }
  let mrr = 0
  for (const [tier, count] of Object.entries(byTier)) {
    if (tier === 'double_a') {
      const regularCount = count - foundingCount
      mrr += regularCount * 7.99 + foundingCount * 4.99
    } else {
      mrr += count * (prices[tier] ?? 0)
    }
  }
  return mrr
}

function formatET(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
    hour12: true,
  }) + ' ET'
}

function pipelineStatus(data: PipelineData | null): {
  color: string
  label: string
  dot: string
} {
  if (!data || data.projectionCount === 0)
    return { color: 'text-red-400', label: 'RED — No projections today', dot: 'bg-red-500' }

  if (!data.lastUpdated)
    return { color: 'text-yellow-400', label: 'YELLOW — Unknown freshness', dot: 'bg-yellow-500' }

  const ageHours = (Date.now() - data.lastUpdated.getTime()) / 3_600_000
  if (ageHours > 6)
    return { color: 'text-yellow-400', label: `YELLOW — Last update ${ageHours.toFixed(1)}h ago`, dot: 'bg-yellow-500' }

  return { color: 'text-green-400', label: 'GREEN — Pipeline healthy', dot: 'bg-green-500' }
}

// ---------------------------------------------------------------------------
// Checklist data
// ---------------------------------------------------------------------------

const CHECKLIST = [
  { done: true,  text: 'GitHub Actions secrets (5/5 configured)',         category: 'infra' },
  { done: true,  text: '--dry-run removed from Twitter pipeline',          category: 'infra' },
  { done: true,  text: 'Discord pipeline alerts wired (5 jobs)',           category: 'infra' },
  { done: true,  text: 'Stripe founding price verified in Vercel',         category: 'infra' },
  { done: true,  text: 'Signup email working (Resend SMTP)',               category: 'infra' },
  { done: true,  text: 'LightGBM model wired into simulator',              category: 'model' },
  { done: true,  text: 'Model retrained on 990K PAs (2020-2025)',          category: 'model' },
  { done: true,  text: 'Site copy updated (~1M PAs, 24 features)',         category: 'content' },
  { done: true,  text: 'OG image fixed (all pages use dynamic route)',     category: 'content' },
  { done: true,  text: 'Twitter bio updated (5,000 sims)',                 category: 'content' },
  { done: true,  text: '3 pre-season tweets posted',                       category: 'content' },
  { done: true,  text: 'X API credits purchased',                          category: 'infra' },
  { done: true,  text: 'README + Makefile branding cleaned',               category: 'content' },
  { done: true,  text: 'Linear triaged (8 issues closed)',                 category: 'ops' },
  { done: true,  text: 'Daily ops playbook created',                       category: 'ops' },
  { done: true,  text: 'Alert system configured (5 tools)',                category: 'ops' },
  { done: false, text: 'Pipeline dry run with new model',                  category: 'critical' },
  { done: false, text: 'Real-phone mobile test',                           category: 'critical' },
  { done: false, text: 'Code freeze + v1.0.0 tag',                        category: 'critical' },
  { done: false, text: 'Whop Discord role sync (or manual plan)',          category: 'ops' },
  { done: false, text: 'War room rehearsal (Wed 8 PM)',                    category: 'ops' },
  { done: false, text: 'Terms of Service + Privacy Policy',               category: 'legal' },
  { done: false, text: 'Gambling disclaimer on footer',                    category: 'legal' },
  { done: false, text: 'EIN + business bank account',                      category: 'legal' },
  { done: false, text: 'Schedule Opening Day tweets (3)',                  category: 'content' },
]

const CATEGORY_ORDER = ['critical', 'infra', 'model', 'content', 'ops', 'legal']
const CATEGORY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  infra:    'text-blue-400',
  model:    'text-purple-400',
  content:  'text-yellow-400',
  ops:      'text-cyan-400',
  legal:    'text-orange-400',
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminPage() {
  const loadedAt = new Date()

  const [pipeline, modelHealth, subscribers] = await Promise.all([
    getPipelineData(),
    getModelHealth(),
    getSubscriberData(),
  ])

  const status = pipelineStatus(pipeline)

  const mrr = subscribers ? calcMRR(subscribers.byTier, subscribers.foundingCount) : 0
  const totalActive = subscribers
    ? Object.values(subscribers.byTier).reduce((s, n) => s + n, 0)
    : 0
  const foundingRemaining = 100 - (subscribers?.foundingCount ?? 0)

  const doneCount = CHECKLIST.filter((i) => i.done).length
  const pct = Math.round((doneCount / CHECKLIST.length) * 100)

  const groupedChecklist = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: CHECKLIST.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0)

  const isLightGBMActive =
    modelHealth &&
    modelHealth.minConf !== null &&
    modelHealth.maxConf !== null &&
    modelHealth.maxConf - modelHealth.minConf > 0.01

  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 px-4 py-6 max-w-5xl mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">⚾ FCP Admin</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {loadedAt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {' · '}Last loaded: {formatET(loadedAt)}
          </p>
        </div>
        <a
          href="/admin"
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm font-medium transition-colors"
        >
          🔄 Refresh
        </a>
      </div>

      {/* ══════════════════════════════════════════════
          1. PIPELINE STATUS
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          01 · Pipeline Status
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-3 h-3 rounded-full ${status.dot} animate-pulse`} />
            <span className={`font-bold text-lg ${status.color}`}>{status.label}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            {[
              {
                label: 'Projections today',
                value: pipeline ? pipeline.projectionCount.toLocaleString() : 'N/A',
              },
              {
                label: 'Games with projections',
                value: pipeline ? `${pipeline.gamesWithProjections} / ${pipeline.gameCount}` : 'N/A',
              },
              {
                label: 'Last refresh',
                value: pipeline?.lastUpdated ? formatET(pipeline.lastUpdated) : 'N/A',
              },
              {
                label: 'Pipeline age',
                value: pipeline?.lastUpdated
                  ? `${((Date.now() - pipeline.lastUpdated.getTime()) / 3_600_000).toFixed(1)}h`
                  : 'N/A',
              },
            ].map((s) => (
              <div key={s.label} className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                <div className="text-lg font-bold text-white">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 text-sm">
            <a href="https://github.com/fullcountprops/fullcountprops/actions" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md border border-gray-700 transition-colors">
              GitHub Actions ↗
            </a>
            <a href="https://github.com/fullcountprops/fullcountprops/actions/workflows/pipelines.yml" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-green-900/40 hover:bg-green-900/60 rounded-md border border-green-800 text-green-400 transition-colors">
              ▶ Trigger Pipeline ↗
            </a>
            <a href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md border border-gray-700 transition-colors">
              Supabase ↗
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          2. REVENUE & SUBSCRIBERS
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          02 · Revenue &amp; Subscribers
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            <div className="bg-gray-800/50 rounded-lg p-3 sm:col-span-1">
              <div className="text-xs text-gray-500 mb-1">MRR (est.)</div>
              <div className="text-2xl font-bold text-green-400">
                {subscribers ? `$${mrr.toFixed(2)}` : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Active paid subs</div>
              <div className="text-2xl font-bold text-white">
                {subscribers ? totalActive : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Founding spots left</div>
              <div className={`text-2xl font-bold ${foundingRemaining < 10 ? 'text-red-400' : 'text-yellow-400'}`}>
                {subscribers ? `${foundingRemaining} / 100` : 'N/A'}
              </div>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="text-xs text-gray-500 mb-1">Email subscribers</div>
              <div className="text-2xl font-bold text-white">
                {subscribers ? subscribers.emailCount.toLocaleString() : 'N/A'}
              </div>
            </div>
          </div>

          {subscribers && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-sm">
              {[
                { tier: 'single_a',  label: 'Single-A (Free)', price: '$0' },
                { tier: 'double_a',  label: 'Double-A',        price: '$7.99/mo' },
                { tier: 'triple_a',  label: 'Triple-A',        price: '$29.99/mo' },
                { tier: 'the_show',  label: 'The Show',        price: '$49.99/mo' },
              ].map(({ tier, label, price }) => (
                <div key={tier} className="bg-gray-800/30 rounded-lg p-3 border border-gray-800">
                  <div className="text-gray-400 text-xs">{label}</div>
                  <div className="text-xs text-gray-600">{price}</div>
                  <div className="text-xl font-bold text-white mt-1">
                    {subscribers.byTier[tier] ?? 0}
                  </div>
                  {tier === 'double_a' && subscribers.foundingCount > 0 && (
                    <div className="text-xs text-yellow-500 mt-0.5">
                      {subscribers.foundingCount} founding @ $4.99
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-3 text-sm">
            <a href="https://dashboard.stripe.com" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md border border-gray-700 transition-colors">
              Stripe Dashboard ↗
            </a>
            <a href="https://resend.com/emails" target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md border border-gray-700 transition-colors">
              Resend Emails ↗
            </a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          3. MODEL HEALTH
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          03 · Model Health
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className={`w-3 h-3 rounded-full ${isLightGBMActive ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className={`font-bold ${isLightGBMActive ? 'text-green-400' : 'text-yellow-400'}`}>
              {isLightGBMActive ? 'LightGBM Active' : 'Fallback Mode / No data'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
            {[
              { label: 'Confidence min', value: modelHealth?.minConf != null ? modelHealth.minConf.toFixed(3) : 'N/A' },
              { label: 'Confidence max', value: modelHealth?.maxConf != null ? modelHealth.maxConf.toFixed(3) : 'N/A' },
              { label: 'Confidence avg', value: modelHealth?.avgConf != null ? modelHealth.avgConf.toFixed(3) : 'N/A' },
              { label: 'Projections',    value: modelHealth?.total != null ? modelHealth.total.toLocaleString() : 'N/A' },
            ].map((s) => (
              <div key={s.label} className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                <div className="text-lg font-bold text-white">{s.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm text-gray-400 mb-4">
            <div><span className="text-gray-600">Coverage:</span> 1,081 pitchers / 1,248 batters</div>
            <div><span className="text-gray-600">Training:</span> 990,489 PAs (2020–2025)</div>
            <div><span className="text-gray-600">Model path:</span> <code className="text-xs text-gray-500">models/trained/matchup_model.joblib</code></div>
          </div>

          <a href="/methodology" className="text-sm text-green-400 hover:text-green-300 transition-colors">
            View methodology →
          </a>
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          4. SITE HEALTH
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          04 · Site Health
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { name: 'Vercel', desc: 'Check deployment status', href: 'https://vercel.com/dashboard', color: 'border-gray-800' },
            { name: 'Sentry', desc: 'Check error log', href: 'https://full-count-props.sentry.io', color: 'border-gray-800' },
            { name: 'Discord', desc: 'Check alert channel', href: 'https://discord.com', color: 'border-gray-800' },
            { name: 'Uptime', desc: 'Verify site loads', href: 'https://fullcountprops.com', color: 'border-green-900' },
          ].map((card) => (
            <a
              key={card.name}
              href={card.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`bg-gray-900 border ${card.color} rounded-lg p-4 hover:border-gray-600 transition-colors block`}
            >
              <div className="font-semibold text-white mb-1">{card.name} ↗</div>
              <div className="text-xs text-gray-500">{card.desc}</div>
            </a>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          5. PRE-LAUNCH CHECKLIST
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          05 · Pre-Launch Checklist
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          {/* Progress bar */}
          <div className="mb-5">
            <div className="flex justify-between text-sm mb-1.5">
              <span className="text-gray-400">{doneCount} / {CHECKLIST.length} complete</span>
              <span className={`font-bold ${pct === 100 ? 'text-green-400' : pct >= 75 ? 'text-yellow-400' : 'text-red-400'}`}>
                {pct}%
              </span>
            </div>
            <div className="w-full bg-gray-800 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct >= 75 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {groupedChecklist.map(({ cat, items }) => {
            const catDone = items.filter((i) => i.done).length
            return (
              <div key={cat} className="mb-4">
                <div className={`text-xs font-semibold uppercase tracking-wider mb-2 ${CATEGORY_COLORS[cat] ?? 'text-gray-400'}`}>
                  {cat} ({catDone}/{items.length})
                </div>
                <ul className="space-y-1">
                  {items.map((item) => (
                    <li key={item.text} className="flex items-start gap-2 text-sm">
                      <span className={`mt-0.5 shrink-0 ${item.done ? 'text-green-400' : 'text-gray-600'}`}>
                        {item.done ? '✓' : '○'}
                      </span>
                      <span className={item.done ? 'text-gray-400 line-through' : 'text-gray-200'}>
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          6. QUICK ACTIONS
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          06 · Quick Actions
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '▶ Trigger Pipeline', href: 'https://github.com/fullcountprops/fullcountprops/actions/workflows/pipelines.yml', highlight: true },
            { label: 'Check Accuracy',     href: 'https://fullcountprops.com/accuracy',                                              highlight: false },
            { label: 'Stripe Dashboard',   href: 'https://dashboard.stripe.com',                                                     highlight: false },
            { label: 'View Errors',        href: 'https://full-count-props.sentry.io',                                               highlight: false },
            { label: 'Linear Board',       href: 'https://linear.app/fullcountprops',                                                highlight: false },
            { label: 'Discord',            href: 'https://discord.com',                                                              highlight: false },
            { label: 'Twitter / X',        href: 'https://twitter.com/fullcountprops',                                               highlight: false },
            { label: 'GitHub Repo',        href: 'https://github.com/fullcountprops/fullcountprops',                                 highlight: false },
          ].map((action) => (
            <a
              key={action.label}
              href={action.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`px-4 py-3 rounded-lg border text-sm font-medium text-center transition-colors block ${
                action.highlight
                  ? 'bg-green-900/40 border-green-800 text-green-400 hover:bg-green-900/60'
                  : 'bg-gray-900 border-gray-800 text-gray-300 hover:border-gray-600 hover:text-white'
              }`}
            >
              {action.label} ↗
            </a>
          ))}
        </div>
      </section>

      {/* ══════════════════════════════════════════════
          7. KEY REFERENCE
          ══════════════════════════════════════════════ */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
          07 · Key Reference
        </h2>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-mono">
            {[
              { label: 'Founding price ID',    value: 'price_1TB8vOCHMWdtVF7LZY7ThWrX' },
              { label: 'Double-A price ID',    value: 'price_1TBIRyCHMWdtVF7LxSqpG5r7' },
              { label: 'Python path',          value: '/opt/homebrew/bin/python3.12' },
              { label: 'Model path',           value: 'models/trained/matchup_model.joblib' },
              { label: 'Emergency flag',       value: 'NEXT_PUBLIC_SHOW_BACKTEST_ONLY=true' },
              { label: 'Rollback',             value: 'Deployments → last working → "…" → Promote' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-gray-800/40 rounded-lg p-3">
                <div className="text-xs text-gray-500 mb-1 font-sans">{label}</div>
                <div className="text-gray-200 text-xs break-all">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}

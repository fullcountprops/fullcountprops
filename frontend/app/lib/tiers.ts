// frontend/app/lib/tiers.ts
// ============================================================
// BaselineMLB — Tier Constants (Single Source of Truth)
// Issue #8: 4-tier MiLB structure
// ============================================================

export const TIERS = {
  SINGLE_A: 'single_a',
  DOUBLE_A: 'double_a',
  TRIPLE_A: 'triple_a',
  THE_SHOW: 'the_show',
} as const;

export type TierName = (typeof TIERS)[keyof typeof TIERS];

// Ordered lowest → highest for comparison
export const TIER_HIERARCHY: TierName[] = [
  'single_a',
  'double_a',
  'triple_a',
  'the_show',
];

/** Returns true when the user's tier is >= the required tier. */
export function hasAccess(userTier: TierName, requiredTier: TierName): boolean {
  return TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(requiredTier);
}

/** Map legacy tier strings to new values (backward compat during migration). */
export function normalizeTier(raw: string | undefined | null): TierName {
  if (!raw) return TIERS.SINGLE_A;
  const lower = raw.toLowerCase().trim();
  // Legacy mappings
  if (lower === 'free') return TIERS.SINGLE_A;
  if (lower === 'pro') return TIERS.TRIPLE_A;
  if (lower === 'premium') return TIERS.THE_SHOW;
  // New values
  if (TIER_HIERARCHY.includes(lower as TierName)) return lower as TierName;
  return TIERS.SINGLE_A;
}

// ---- CSV Export limits per tier ----
export interface ExportLimits {
  max_per_week: number | null; // null = unlimited
  allowed_types: ExportType[];
  include_shap: boolean;
  include_probability: boolean;
  include_kelly: boolean;
}

export type ExportType =
  | 'best_bets'
  | 'edges'
  | 'projections'
  | 'players'
  | 'historical';

export const EXPORT_LIMITS: Record<TierName, ExportLimits> = {
  single_a: {
    max_per_week: 0,
    allowed_types: [],
    include_shap: false,
    include_probability: false,
    include_kelly: false,
  },
  double_a: {
    max_per_week: 3,
    allowed_types: ['best_bets'],
    include_shap: false,
    include_probability: false,
    include_kelly: false,
  },
  triple_a: {
    max_per_week: null,
    allowed_types: ['best_bets', 'edges', 'projections', 'players'],
    include_shap: true,
    include_probability: true,
    include_kelly: true,
  },
  the_show: {
    max_per_week: null,
    allowed_types: ['best_bets', 'edges', 'projections', 'players', 'historical'],
    include_shap: true,
    include_probability: true,
    include_kelly: true,
  },
};

// ---- Feature flags per tier (for content gating) ----
export interface TierFeatures {
  bestBetsLimit: number | null; // null = all
  fullEdgesAccess: boolean;
  shapDetail: 'none' | 'top3' | 'full';
  probabilityDistributions: boolean;
  kellySizing: boolean;
  simulatorAccess: boolean;
  playerHistoryGames: number;
  emailDigest: boolean;
  apiAccess: boolean;
  customAlerts: boolean;
  prioritySupport: boolean;
}

export const TIER_FEATURES: Record<TierName, TierFeatures> = {
  single_a: {
    bestBetsLimit: 3,
    fullEdgesAccess: false,
    shapDetail: 'none',
    probabilityDistributions: false,
    kellySizing: false,
    simulatorAccess: false,
    playerHistoryGames: 7,
    emailDigest: false,
    apiAccess: false,
    customAlerts: false,
    prioritySupport: false,
  },
  double_a: {
    bestBetsLimit: null,
    fullEdgesAccess: true,
    shapDetail: 'top3',
    probabilityDistributions: false,
    kellySizing: false,
    simulatorAccess: false,
    playerHistoryGames: 14,
    emailDigest: true,
    apiAccess: false,
    customAlerts: false,
    prioritySupport: false,
  },
  triple_a: {
    bestBetsLimit: null,
    fullEdgesAccess: true,
    shapDetail: 'full',
    probabilityDistributions: true,
    kellySizing: true,
    simulatorAccess: true,
    playerHistoryGames: 50,
    emailDigest: true,
    apiAccess: false,
    customAlerts: false,
    prioritySupport: false,
  },
  the_show: {
    bestBetsLimit: null,
    fullEdgesAccess: true,
    shapDetail: 'full',
    probabilityDistributions: true,
    kellySizing: true,
    simulatorAccess: true,
    playerHistoryGames: 200,
    emailDigest: true,
    apiAccess: true,
    customAlerts: true,
    prioritySupport: true,
  },
};

// ---- Stripe price ID mapping ----
// These map Stripe price IDs → tier names for the webhook handler.
// Env vars are read at runtime so the values here are the env-var *names*.
export const STRIPE_PRICE_ENV_KEYS: Record<string, TierName> = {};

/** Build the price→tier map from process.env at runtime. */
export function buildPriceToTierMap(): Record<string, TierName> {
  const map: Record<string, TierName> = {};

  const doubleA = process.env.STRIPE_DOUBLE_A_MONTHLY_PRICE_ID;
  const tripleA = process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
  const tripleAAnnual = process.env.STRIPE_PRO_ANNUAL_PRICE_ID;
  const theShow = process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID;
  const theShowAnnual = process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID;

  if (doubleA) map[doubleA] = 'double_a';
  if (tripleA) map[tripleA] = 'triple_a';
  if (tripleAAnnual) map[tripleAAnnual] = 'triple_a';
  if (theShow) map[theShow] = 'the_show';
  if (theShowAnnual) map[theShowAnnual] = 'the_show';

  return map;
}

// ---- Display helpers for the pricing page ----
export interface TierDisplay {
  id: TierName;
  name: string;
  tagline: string;
  price: number; // monthly in dollars
  priceLabel: string;
  badge?: string;
  cta: string;
  features: string[];
  csvLine: string;
}

export const TIER_DISPLAY: TierDisplay[] = [
  {
    id: 'single_a',
    name: 'Single-A',
    tagline: 'Scout the game',
    price: 0,
    priceLabel: 'Free',
    cta: 'Get Started',
    features: [
      'Top 3 best bets daily',
      'Grade + direction (Over/Under)',
      'Edge % vs market line',
      'Basic model accuracy page',
      'Daily slate overview',
      'Methodology & FAQ access',
    ],
    csvLine: 'No CSV exports',
  },
  {
    id: 'double_a',
    name: 'Double-A',
    tagline: 'See the full slate',
    price: 7.99,
    priceLabel: '$7.99/mo',
    badge: 'Most Popular',
    cta: 'Start Double-A',
    features: [
      'Everything in Single-A',
      'Full daily best bets (every game)',
      'Full edges page access',
      'Basic SHAP explanations (top 3 factors)',
      'Player pages with recent history',
      'Daily email digest (11 AM ET)',
    ],
    csvLine: '3 CSV exports per week (best bets)',
  },
  {
    id: 'triple_a',
    name: 'Triple-A',
    tagline: 'Full scouting report',
    price: 29.99,
    priceLabel: '$29.99/mo',
    cta: 'Start Triple-A',
    features: [
      'Everything in Double-A',
      'Full SHAP breakdowns (all factors)',
      'Probability distributions',
      'Kelly criterion sizing',
      'Full backtest accuracy & calibration',
      'Game simulator access',
      'Umpire framing & park composites',
      '50-game player history',
    ],
    csvLine: 'Unlimited CSV exports (all data + SHAP)',
  },
  {
    id: 'the_show',
    name: 'The Show',
    tagline: 'Big league analytics',
    price: 49.99,
    priceLabel: '$49.99/mo',
    cta: 'Go to The Show',
    features: [
      'Everything in Triple-A',
      'REST API access (1,000 req/hr)',
      'API key management dashboard',
      'Custom alert thresholds',
      '200-game player history',
      'Priority support',
      'Webhook notifications (coming soon)',
    ],
    csvLine: 'Unlimited exports + bulk historical data',
  },
];

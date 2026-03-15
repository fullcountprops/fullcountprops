# Stripe Payment Flow Audit

**Date:** 2026-03-15
**Files reviewed:**
- `frontend/app/pricing/PricingClient.tsx`
- `frontend/app/api/checkout/route.ts`
- `frontend/app/api/webhooks/stripe/route.ts`
- `frontend/app/api/founding-spots/route.ts`
- `frontend/app/lib/tiers.ts`
- `frontend/middleware.ts`

---

## Executive Summary

The flow is structurally sound — auth, Stripe session creation, and webhook dispatch all work correctly end-to-end. However, there are **two critical issues** that will cause silent failures in production if the relevant env vars are missing, a **player history data inconsistency** visible to users, and several medium/low items (dead code, stale values, type hacks). None require schema changes; all are code or env-var fixes.

| Severity | Count | Summary |
|----------|-------|---------|
| Critical | 2 | Double-A price not hardcoded in webhook map; founding member env var split |
| Medium | 4 | History limits ≠ UI; `past_due` unhandled; two dead code blocks; stale comment |
| Low | 4 | `founding_member` type hack; stale public path; `most-likely` header gap; `FOUNDING_CAP` duplicated |

---

## 1. PricingClient.tsx → /api/checkout

**Verdict: Correct.**

`PricingClient.tsx:36` calls `POST /api/checkout` with `{ plan, period: 'monthly' }` and a `Bearer` token from the Supabase session:

```ts
// PricingClient.tsx:36-43
const res = await fetch('/api/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify({ plan, period: 'monthly' }),
});
```

- The `plan` value comes directly from `tier.id` in the `TIER_DISPLAY` array (`'double_a'`, `'triple_a'`, `'the_show'`), which matches the `validPlans` list in `checkout/route.ts:78`.
- The `single_a` tier is correctly short-circuited to `/signup` at `PricingClient.tsx:20-23`.
- An unauthenticated user is redirected to `/login?redirect=/pricing&plan=${plan}` before the fetch is attempted (`PricingClient.tsx:32-34`).
- Errors are surfaced via `alert()`. Not ideal UX, but functional.

---

## 2. Checkout endpoint: plan → Stripe price ID mapping

**Verdict: Correct for paid plans, but has env-var coupling risk for founding member.**

`checkout/route.ts:31-41` maps `plan_period` keys to env vars:

```ts
const map: Record<string, string | undefined> = {
  double_a_monthly:       process.env.STRIPE_DOUBLE_A_MONTHLY_PRICE_ID,
  triple_a_monthly:       process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  triple_a_annual:        process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  the_show_monthly:       process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
  the_show_annual:        process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID,
  founding_member_monthly: process.env.NEXT_PUBLIC_FOUNDING_PRICE_ID,  // ← see Issue #2
};
```

All paid tiers (`double_a`, `triple_a`, `the_show`) resolve correctly as long as the env vars are set. The `period` param defaults to `'monthly'` at `checkout/route.ts:76`, matching what `PricingClient.tsx` sends.

**Annual pricing:** `triple_a_annual` and `the_show_annual` are in the map but there is no UI to select annual. This is harmless scaffolding.

---

## 3. Webhook handler: checkout completion

**Verdict: Correct logic, but silent failure risk if env var is missing (see Issue #1).**

The webhook correctly handles these events:

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Retrieves subscription, resolves price → tier, updates user metadata + subscriptions table |
| `customer.subscription.created` | Same as above |
| `customer.subscription.updated` | Updates tier only if `status === 'active'` |
| `customer.subscription.deleted` | Downgrades to `single_a`, marks `canceled` |
| `invoice.payment_failed` | Logs warning, no tier change (defers to Stripe retry → `subscription.deleted`) |

The call chain for a successful checkout:

```
tierFromPriceId(priceId)
  → buildPriceToTierMap()[priceId]
  → STRIPE_PRICE_TO_TIER (hardcoded) + env-var overrides
  → TierName or 'single_a' (fallback)
```

The tier is then written to both `auth.users.user_metadata.subscription_tier` and the `subscriptions` table. Both paths work correctly.

**See Issue #1** for the gap in the hardcoded fallback map.

---

## 4. Price/tier display mismatches

### 4a. TIER_DISPLAY vs STRIPE_PRICE_TO_TIER

`TIER_DISPLAY` shows these prices to users:

| Tier | Displayed price |
|------|----------------|
| Double-A | $9/mo |
| Triple-A | $19/mo |
| The Show | $39/mo |

`STRIPE_PRICE_TO_TIER` hardcodes these price IDs:

| Price ID | Amount | Tier | Status |
|----------|--------|------|--------|
| `price_1T7WVcCHMWdtVF7LGT9iNi4C` | $7.99/mo | double_a | **Original, still active in map** |
| `price_1TB8vOCHMWdtVF7LZY7ThWrX` | $4.99/mo | double_a | Founding member |
| `price_1TBIUqCHMWdtVF7LiWLpv0cj` | $19/mo | triple_a | Current default |
| `price_1TBHSVCHMWdtVF7LfmebGKhC` | $19/mo | triple_a | Archived |
| `price_1T7TZjCHMWdtVF7LPK79esVb` | $29/mo | triple_a | Archived |
| `price_1TBIWhCHMWdtVF7L4ILjZtPV` | $39/mo | the_show | Current default |
| `price_1TBHUHCHMWdtVF7LrME2uBAk` | $39/mo | the_show | Archived |
| `price_1T7TosCHMWdtVF7LowXBxhaW` | $49/mo | the_show | Archived |

**No hardcoded $9/mo Double-A price exists in `STRIPE_PRICE_TO_TIER`.** The current Double-A price relies entirely on `STRIPE_DOUBLE_A_MONTHLY_PRICE_ID` env var being set. This is Issue #1.

Triple-A ($19) and The Show ($39) are correctly hardcoded with the current price IDs.

### 4b. Player history limits: UI vs API vs TIER_FEATURES (Medium)

Three sources describe player history depth, and they disagree:

| Tier | `TIER_FEATURES` | Pricing UI (COMPARISON_ROWS) | API (`history/route.ts:44`) |
|------|----------------|------------------------------|-----------------------------|
| single_a | 7 games | "7 days" | 10 records |
| double_a | 14 games | "14 days" | **50 records** |
| triple_a | 50 games | "50 games" | **200 records** |
| the_show | 200 games | "200 games" | 200 records |

The API at `history/route.ts:44` uses:
```ts
const limit = (tier as string) === 'single_a' ? 10 : (tier as string) === 'double_a' ? 50 : 200
```

This over-delivers relative to the advertised limits for Double-A (50 vs 14) and Triple-A (200 vs 50). While over-delivering isn't harmful, it means Triple-A users receive a feature that the pricing page says is exclusive to The Show. If limits are ever enforced to match the UI, it would be a regression for existing Triple-A subscribers.

---

## 5. Middleware tier gating

**Verdict: Correct for gated routes; one functional gap.**

The three gated routes are correctly configured:

```ts
// middleware.ts:104-108
const TIER_GATED_ROUTES = [
  { path: '/best-bets', minTier: 'double_a' },
  { path: '/simulator', minTier: 'triple_a' },
  { path: '/api-keys', minTier: 'the_show' },
];
```

- Unauthenticated users are redirected to `/login?redirect=<path>` ✓
- Insufficient-tier users are redirected to `/pricing?upgrade=<minTier>` ✓
- The `hasAccess` function correctly uses `TIER_HIERARCHY.indexOf` for comparison ✓

`/edges` and `/players` are tier-aware (tier passed as `x-subscription-tier` header) but not hard-gated, which is correct — free users see blurred cards.

**Gap:** `/most-likely` is not in `TIER_AWARE_ROUTES` (`middleware.ts:111`), so the `MostLikelyPage` does not receive an `x-subscription-tier` header. The page doesn't currently gate content by tier, but if tier-based gating is added later, the header infrastructure won't be there.

---

## 6. Bugs, dead code, and missing error handling

---

### 🔴 Issue #1 — Critical: Current Double-A price not in hardcoded webhook fallback

**File:** `frontend/app/lib/tiers.ts:164-176`

`STRIPE_PRICE_TO_TIER` contains the original `$7.99` Double-A price but **no `$9/mo` price**. The `buildPriceToTierMap()` function adds the env-var price at runtime:

```ts
// tiers.ts:182-188
const doubleA = process.env.STRIPE_DOUBLE_A_MONTHLY_PRICE_ID;
// ...
if (doubleA) map[doubleA] = 'double_a';
```

If `STRIPE_DOUBLE_A_MONTHLY_PRICE_ID` is not set in Vercel (e.g., after a config reset or new environment setup), the webhook will call `buildPriceToTierMap()[priceId]` for a new `$9` Double-A subscriber, find no match, and fall back to `'single_a'`. The subscriber pays but gets no access. There is no error surfaced — `tierFromPriceId` silently returns `'single_a'` as the default.

**Fix:** Add the current Double-A price ID to the hardcoded `STRIPE_PRICE_TO_TIER` map, the same way Triple-A and The Show current prices are already hardcoded:

```ts
// tiers.ts — add alongside existing Double-A entries
'price_1TXXXXXXXXXXXXXXXXXXXXXX': 'double_a', // Double-A monthly $9/mo (current default)
```

---

### 🔴 Issue #2 — Critical: Two different env vars for founding member price

**Files:** `frontend/app/api/checkout/route.ts:37` and `frontend/app/api/checkout/route.ts:121`

The checkout route uses **two different env vars** for the founding member price:

```ts
// checkout/route.ts:37 — used to build the Stripe session for a 'founding_member' plan
founding_member_monthly: process.env.NEXT_PUBLIC_FOUNDING_PRICE_ID,

// checkout/route.ts:121 — used for the Double-A founding slot check
const foundingPriceId = process.env.STRIPE_FOUNDING_DOUBLE_A_PRICE_ID;
```

`buildPriceToTierMap()` (`tiers.ts:183`) also references `STRIPE_FOUNDING_DOUBLE_A_PRICE_ID`, not `NEXT_PUBLIC_FOUNDING_PRICE_ID`. If these two env vars point to different price IDs:

1. A `founding_member` checkout creates a session with the price from `NEXT_PUBLIC_FOUNDING_PRICE_ID`
2. Stripe fires a webhook with that price ID
3. `buildPriceToTierMap()` looks for `STRIPE_FOUNDING_DOUBLE_A_PRICE_ID` — different value → no match → user gets `single_a`

The hardcoded `price_1TB8vOCHMWdtVF7LZY7ThWrX` in `STRIPE_PRICE_TO_TIER` acts as an implicit safety net only if both env vars are pointing at that same hardcoded value.

Additionally, `NEXT_PUBLIC_FOUNDING_PRICE_ID` is bundled into the client JavaScript bundle (all `NEXT_PUBLIC_` vars are). Price IDs are not sensitive, but it's inconsistent with all other price env vars which are server-only.

**Fix:** Consolidate to a single env var (`STRIPE_FOUNDING_DOUBLE_A_PRICE_ID`) in both places, and rename away from `NEXT_PUBLIC_`.

---

### 🟡 Issue #3 — Medium: `customer.subscription.updated` silently ignores `past_due`

**File:** `frontend/app/api/webhooks/stripe/route.ts:271`

```ts
if (priceId && subscription.status === 'active') {
  // update tier
}
// No else branch — past_due, unpaid, trialing silently fall through
```

When Stripe can't collect payment, the subscription transitions to `past_due` via `customer.subscription.updated` before `customer.subscription.deleted` fires (after Stripe exhausts retries, typically 4–8 days). During that window, the user retains full paid tier access even though payment failed.

This is a documented product decision (the `invoice.payment_failed` handler notes "Don't immediately downgrade — Stripe will retry"), but it means users get up to 8 days of free access after a failed payment. Consider whether syncing the `subscriptions` table `status` field to `past_due` at minimum would be useful for internal reporting, even if the tier isn't immediately downgraded.

---

### 🟡 Issue #4 — Medium: Dead code — `currentTier` computed but never used

**File:** `frontend/app/api/checkout/route.ts:87-88`

```ts
const currentTier = normalizeTier(user.user_metadata?.subscription_tier);
// (Allow checkout regardless — Stripe handles upgrades/downgrades)
```

`currentTier` is assigned but never referenced again. The variable and the Supabase-derived tier check serve no purpose. Can be deleted.

---

### 🟡 Issue #5 — Medium: Dead code — `response` variable in middleware

**File:** `frontend/middleware.ts:179`

```ts
const response = NextResponse.next();  // ← created, never used
// ...
return NextResponse.next({             // ← a new call is returned instead
  request: { headers: requestHeaders },
});
```

Line 179 creates a `NextResponse` object that is immediately discarded — the actual return statement on line 185 constructs a fresh `NextResponse.next()`. Can be deleted.

---

### 🟡 Issue #6 — Medium: Stale comment references $7.99

**File:** `frontend/app/api/checkout/route.ts:132`

```ts
// else: slots full or query error, fall through to regular $7.99
```

Double-A is now $9/mo. This comment is misleading.

---

### 🟠 Issue #7 — Low: `founding_member` accepted as a plan but not typed in `TIERS`

**File:** `frontend/app/api/checkout/route.ts:78-79`

```ts
const validPlans = [TIERS.DOUBLE_A, TIERS.TRIPLE_A, TIERS.THE_SHOW, 'founding_member'];
if (!validPlans.includes(plan as typeof TIERS.DOUBLE_A)) {
```

`'founding_member'` is not in the `TIERS` constant or `TierName` type, requiring a type cast (`plan as typeof TIERS.DOUBLE_A`) to avoid a TypeScript error. This works at runtime but the type coercion hides the mismatch. `founding_member` should be added to `TIERS` or extracted to a separate constant.

---

### 🟠 Issue #8 — Low: `/subscribe` still in middleware public paths

**File:** `frontend/middleware.ts:135`

```ts
'/subscribe',
```

`/subscribe` now redirects to `/pricing` (via `app/subscribe/page.tsx`). Keeping it in `publicPaths` is harmless — the middleware passes it through and the redirect fires — but it's stale configuration that implies the route is still live content.

---

### 🟠 Issue #9 — Low: `FOUNDING_CAP` duplicated

**Files:** `frontend/app/lib/tiers.ts:160` and `frontend/app/api/founding-spots/route.ts:5`

```ts
// tiers.ts:160
export const FOUNDING_MEMBER_CAP = 100;

// founding-spots/route.ts:5
const FOUNDING_CAP = 100;
```

The founding member cap is hardcoded in two separate files. `founding-spots/route.ts` should import `FOUNDING_MEMBER_CAP` from `tiers.ts` rather than redefining it, so a cap change only needs to happen in one place.

---

### 🟠 Issue #10 — Low: `/most-likely` not in `TIER_AWARE_ROUTES`

**File:** `frontend/middleware.ts:111`

```ts
const TIER_AWARE_ROUTES = ['/edges', '/players'];
```

`/most-likely` (and `/projections`) are not included, so pages at those routes receive no `x-subscription-tier` request header. Both pages currently ignore tier in their server component logic, so there is no functional regression today. If content gating is added to either page, the middleware will need to be updated first.

---

## Summary Table

| # | Severity | File | Line(s) | Description |
|---|----------|------|---------|-------------|
| 1 | 🔴 Critical | `tiers.ts` | 164–176 | Current $9 Double-A price ID missing from hardcoded webhook map |
| 2 | 🔴 Critical | `checkout/route.ts` | 37, 121 | Two different env vars for founding member price; webhook uses neither directly |
| 3 | 🟡 Medium | `webhooks/stripe/route.ts` | 271 | `past_due` subscriptions silently pass through with no tier or status update |
| 4 | 🟡 Medium | `checkout/route.ts` | 87–88 | `currentTier` assigned but never used |
| 5 | 🟡 Medium | `middleware.ts` | 179 | `response` variable created and discarded |
| 6 | 🟡 Medium | `checkout/route.ts` | 132 | Comment says "$7.99" but current price is $9 |
| 7 | 🟡 Medium | `tiers.ts` + `history/route.ts` | 94–146, 44 | API history limits (10/50/200) don't match TIER_FEATURES (7/14/50) or UI ("7 days"/"14 days"/"50 games") |
| 8 | 🟠 Low | `checkout/route.ts` | 78–79 | `founding_member` accepted plan not in `TIERS` type; requires type cast |
| 9 | 🟠 Low | `middleware.ts` | 135 | `/subscribe` still listed in `publicPaths` |
| 10 | 🟠 Low | `founding-spots/route.ts` | 5 | `FOUNDING_CAP = 100` duplicated instead of imported from `tiers.ts` |
| 11 | 🟠 Low | `middleware.ts` | 111 | `/most-likely` and `/projections` absent from `TIER_AWARE_ROUTES` |

// frontend/app/api/checkout/route.ts
// ============================================================
// FullCountProps — Stripe Checkout Session (Issue #8: 4-tier)
//
// POST /api/checkout
// Body: { plan: 'double_a' | 'triple_a' | 'the_show', period?: 'monthly' | 'annual' }
// Returns: { url: string } — Stripe Checkout redirect URL
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { TIERS } from '@/app/lib/tiers';
import { getDoubleAPriceId } from '@/app/lib/founding';

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
            apiVersion: '2025-02-24.acacia',
    });
  }
  return _stripe;
}
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

/** Map plan + period to Stripe price ID from env vars. */
function getPriceId(
  plan: string,
  period: string = 'monthly'
): string | null {
  const map: Record<string, string | undefined> = {
    double_a_monthly: process.env.STRIPE_DOUBLE_A_MONTHLY_PRICE_ID,
    triple_a_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
    triple_a_annual: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
    the_show_monthly: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
    the_show_annual: process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID,
        founding_member_monthly: process.env.STRIPE_FOUNDING_DOUBLE_A_PRICE_ID,
  };

  return map[`${plan}_${period}`] ?? null;
}

export async function POST(request: NextRequest) {
  try {
    // ---- 1. Authenticate user ----
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authorization required' },
        { status: 401 }
      );
    }
    const accessToken = authHeader.replace('Bearer ', '');

    const supabase = createClient(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(accessToken);

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // ---- 2. Parse request ----
    const body = await request.json().catch(() => ({}));
    const plan = body.plan as string;
    const period = (body.period as string) || 'monthly';

        const validPlans = [TIERS.DOUBLE_A, TIERS.TRIPLE_A, TIERS.THE_SHOW, 'founding_member'];
  if (!validPlans.includes(plan as typeof TIERS.DOUBLE_A)) {
      return NextResponse.json(
        { error: `Invalid plan. Must be one of: ${validPlans.join(', ')}` },
        { status: 400 }
      );
    }

    // ---- 3. Get or create Stripe customer ----
    let customerId = user.user_metadata?.stripe_customer_id as
      | string
      | undefined;

    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      customerId = customer.id;
    }

    // Always persist stripe_customer_id so webhook lookups find the user.
    // Spread existing metadata to avoid overwriting subscription_tier etc.
    const supabaseAdmin = createClient(
      supabaseUrl,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        stripe_customer_id: customerId,
      },
    });

    // ---- 5. Resolve Stripe price ID ----
    let priceId = getPriceId(plan, period);
    let isFounding = false;

    // Founding member pricing: delegate to getDoubleAPriceId() which checks
    // the cap, cutoff date, and returns the correct price + founding flag.
    if (plan === 'double_a' && period === 'monthly') {
      const result = await getDoubleAPriceId();
      if (result.priceId) priceId = result.priceId;
      isFounding = result.isFounding;
    }

    if (!priceId) {
      return NextResponse.json(
        {
          error: `No Stripe price configured for ${plan} (${period}). Check environment variables.`,
        },
        { status: 500 }
      );
    }

    // ---- 6. Create Checkout Session ----
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.fullcountprops.com';

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/account?success=true`,
      cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
      metadata: {
        supabase_user_id: user.id,
        plan: plan,
        founding_member: isFounding ? 'true' : 'false',
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan: plan,
        },
      },
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Checkout failed: ${message}` },
      { status: 500 }
    );
  }
}

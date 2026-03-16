// frontend/app/api/webhooks/stripe/route.ts
// ============================================================
// FullCountProps — Stripe Webhook
//
// Handles Stripe subscription lifecycle events and syncs both:
//   1. Supabase auth user_metadata (subscription_tier)
//   2. Supabase subscriptions table (for middleware/API lookups)
//
// Stripe product name → Website tier mapping:
//   Stripe "Double-A"  → double_a  ($7.99)
//   Stripe "Pro"       → triple_a  ($29.00)
//   Stripe "Premium"   → the_show  ($49.00)
//
// Webhook endpoint: https://www.fullcountprops.com/api/webhooks/stripe
// Webhook destination ID: we_1T7Tx5CHMWdtVF7LllHgGYyd
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { buildPriceToTierMap, type TierName } from '@/app/lib/tiers';

/** Validate required environment variables. Returns missing var names or null if all present. */
function validateEnvVars(): string[] | null {
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  const missing = required.filter((key) => !process.env[key]);
  return missing.length > 0 ? missing : null;
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: '2025-02-24.acacia',
    });
  }
  return _stripe;
}

let _supabaseAdmin: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (!_supabaseAdmin) {
    _supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.SUPABASE_SERVICE_ROLE_KEY as string
    );
  }
  return _supabaseAdmin;
}

function getWebhookSecret() {
  return process.env.STRIPE_WEBHOOK_SECRET as string;
}

/** Resolve a Stripe price ID to a FullCountProps tier name. */
function tierFromPriceId(priceId: string): TierName {
  const priceToTier = buildPriceToTierMap();
  return priceToTier[priceId] ?? 'single_a';
}

/**
 * Upsert a row in the subscriptions table to keep it in sync with Stripe.
 * Uses stripe_customer_id as the lookup key; falls back to email.
 */
async function syncSubscriptionsTable(params: {
  email?: string;
  userId?: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string;
  stripeProductId?: string;
  tier: TierName;
  status: 'active' | 'canceled' | 'past_due';
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseAdmin() as any;

  // Check if row exists by stripe_customer_id
  const { data: existing } = await db
    .from('subscriptions')
    .select('id, email')
    .eq('stripe_customer_id', params.stripeCustomerId)
    .maybeSingle();

  const row = {
    stripe_customer_id: params.stripeCustomerId,
    stripe_subscription_id: params.stripeSubscriptionId,
    stripe_product_id: params.stripeProductId,
    tier: params.tier,
    status: params.status,
    user_id: params.userId,
    current_period_start: params.currentPeriodStart,
    current_period_end: params.currentPeriodEnd,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db
      .from('subscriptions')
      .update(row)
      .eq('id', existing.id);
    if (error) console.error('Failed to update subscriptions row:', error);
  } else if (params.email) {
    const { error } = await db
      .from('subscriptions')
      .upsert(
        { ...row, email: params.email, created_at: new Date().toISOString() },
        { onConflict: 'email' }
      );
    if (error) console.error('Failed to insert subscriptions row:', error);
  }
}

/** Update the user's subscription_tier in Supabase auth metadata. */
async function updateUserTier(
  customerId: string,
  tier: TierName,
  stripeSubscriptionId?: string
) {
  const { data: users, error: listError } =
    await getSupabaseAdmin().auth.admin.listUsers({ perPage: 1000 });

  if (listError) {
    console.error('Failed to list users:', listError);
    return null;
  }

  type UserRecord = { id: string; email?: string; user_metadata?: Record<string, unknown> };
  const allUsers = (users as { users: UserRecord[] }).users;

  let user: UserRecord | undefined = allUsers.find(
    (u) => u.user_metadata?.stripe_customer_id === customerId
  );

  // Fallback: look up by email from Stripe customer object
  if (!user) {
    const customer = await getStripe().customers.retrieve(customerId) as Stripe.Customer;
    if (customer.email) {
      const match = allUsers.find((u) => u.email === customer.email);
      if (match) {
        user = match;
        // Save stripe_customer_id so future webhook lookups hit the fast path
        await getSupabaseAdmin().auth.admin.updateUserById(match.id, {
          user_metadata: { ...match.user_metadata, stripe_customer_id: customerId },
        });
      }
    }
  }

  if (!user) {
    console.error(`No user found with stripe_customer_id: ${customerId}`);
    return null;
  }

  const { error: updateError } =
    await getSupabaseAdmin().auth.admin.updateUserById(user.id, {
      user_metadata: {
        subscription_tier: tier,
        stripe_subscription_id:
          stripeSubscriptionId ?? user.user_metadata?.stripe_subscription_id,
        tier_updated_at: new Date().toISOString(),
      },
    });

  if (updateError) {
    console.error(`Failed to update tier for user ${user.id}:`, updateError);
  } else {
    console.log(`Updated user ${user.id} to tier: ${tier}`);
  }

  return user;
}

export async function POST(request: NextRequest) {
  // Validate environment variables before processing
  const missingVars = validateEnvVars();
  if (missingVars) {
    console.error(`Stripe webhook missing env vars: ${missingVars.join(', ')}`);
    return NextResponse.json(
      { error: `Server configuration error: missing ${missingVars.join(', ')}` },
      { status: 500 }
    );
  }

  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(body, sig, getWebhookSecret());
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Webhook signature verification failed: ${message}`);
    return NextResponse.json(
      { error: `Webhook Error: ${message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      // ---- Checkout completed ----
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (subscriptionId) {
          const subscription =
            await getStripe().subscriptions.retrieve(subscriptionId);
          const priceId = subscription.items.data[0]?.price.id;
          const productId = subscription.items.data[0]?.price.product as string;

          if (priceId) {
            const tier = tierFromPriceId(priceId);
            const user = await updateUserTier(customerId, tier, subscriptionId);

            await syncSubscriptionsTable({
              email: user?.email ?? (session.customer_email as string),
              userId: user?.id,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              stripeProductId: productId,
              tier,
              status: 'active',
              currentPeriodStart: subscription.current_period_start
                ? new Date(subscription.current_period_start * 1000).toISOString()
                : undefined,
              currentPeriodEnd: subscription.current_period_end
                ? new Date(subscription.current_period_end * 1000).toISOString()
                : undefined,
            });
          }
        }
        break;
      }

      // ---- Subscription created ----
      case 'customer.subscription.created': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price.id;
        const productId = subscription.items.data[0]?.price.product as string;

        if (priceId) {
          const tier = tierFromPriceId(priceId);
          const user = await updateUserTier(customerId, tier, subscription.id);

          await syncSubscriptionsTable({
            email: user?.email,
            userId: user?.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            stripeProductId: productId,
            tier,
            status: 'active',
            currentPeriodStart: subscription.current_period_start
              ? new Date(subscription.current_period_start * 1000).toISOString()
              : undefined,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : undefined,
          });
        }
        break;
      }

      // ---- Subscription updated (upgrade/downgrade/renewal) ----
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const priceId = subscription.items.data[0]?.price.id;
        const productId = subscription.items.data[0]?.price.product as string;

        if (priceId && subscription.status === 'active') {
          const tier = tierFromPriceId(priceId);
          const user = await updateUserTier(customerId, tier, subscription.id);

          await syncSubscriptionsTable({
            email: user?.email,
            userId: user?.id,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id,
            stripeProductId: productId,
            tier,
            status: 'active',
            currentPeriodStart: subscription.current_period_start
              ? new Date(subscription.current_period_start * 1000).toISOString()
              : undefined,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end * 1000).toISOString()
              : undefined,
          });
        }
        break;
      }

      // ---- Subscription cancelled/expired ----
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const user = await updateUserTier(customerId, 'single_a');

        await syncSubscriptionsTable({
          email: user?.email,
          userId: user?.id,
          stripeCustomerId: customerId,
          stripeSubscriptionId: subscription.id,
          tier: 'single_a',
          status: 'canceled',
        });
        break;
      }

      // ---- Invoice payment failed ----
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        console.warn(
          `Payment failed for customer ${customerId}, subscription ${invoice.subscription}`
        );
        // Don't immediately downgrade — Stripe will retry.
        // After final retry failure, subscription.deleted fires.
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing webhook event ${event.type}:`, err);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }

  return NextResponse.json({ received: true });
}

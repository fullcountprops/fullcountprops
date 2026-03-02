// ============================================================
// POST /api/webhooks/stripe
// Handles Stripe webhook events to fulfill subscriptions.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2025-01-27.acacia',
})

// Use service role key for server-side writes (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

// Map Stripe price IDs → tier names
const PRICE_TIER_MAP: Record<string, string> = {
  [process.env.STRIPE_PRICE_PRO || '']: 'pro',
  [process.env.STRIPE_PRICE_PREMIUM || '']: 'premium',
}

function tierFromPriceId(priceId: string | null | undefined): string {
  if (!priceId) return 'free'
  return PRICE_TIER_MAP[priceId] || 'free'
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    console.error('[stripe-webhook] Missing stripe-signature header')
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    )
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set')
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    )
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[stripe-webhook] Signature verification failed:', message)
    return NextResponse.json(
      { error: `Webhook signature verification failed: ${message}` },
      { status: 400 }
    )
  }

  console.log(`[stripe-webhook] Received event: ${event.type} (${event.id})`)

  try {
    switch (event.type) {
      // ----------------------------------------------------------
      // checkout.session.completed
      // Fired when a customer completes a Checkout Session.
      // Create or update the subscription record in Supabase.
      // ----------------------------------------------------------
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session

        const email = session.customer_details?.email || session.customer_email
        const customerId =
          typeof session.customer === 'string'
            ? session.customer
            : session.customer?.id || null
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id || null
        const tier = (session.metadata?.tier as string) || 'free'

        if (!email) {
          console.error(
            '[stripe-webhook] checkout.session.completed: missing customer email',
            { sessionId: session.id }
          )
          break
        }

        // Fetch subscription to get period dates
        let periodStart: string | null = null
        let periodEnd: string | null = null

        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId)
            periodStart = new Date(
              sub.current_period_start * 1000
            ).toISOString()
            periodEnd = new Date(sub.current_period_end * 1000).toISOString()
          } catch (subErr: unknown) {
            const msg = subErr instanceof Error ? subErr.message : 'Unknown'
            console.error(
              '[stripe-webhook] Failed to retrieve subscription:',
              msg
            )
          }
        }

        const { error } = await supabase
          .from('subscriptions')
          .upsert(
            {
              email,
              stripe_customer_id: customerId,
              stripe_subscription_id: subscriptionId,
              tier,
              status: 'active',
              current_period_start: periodStart,
              current_period_end: periodEnd,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'email' }
          )

        if (error) {
          console.error(
            '[stripe-webhook] Supabase upsert failed (checkout.session.completed):',
            error
          )
        } else {
          console.log(
            `[stripe-webhook] Subscription activated for ${email} (tier: ${tier})`
          )
        }
        break
      }

      // ----------------------------------------------------------
      // customer.subscription.updated
      // Fired when a subscription changes (plan upgrade/downgrade,
      // trial ending, renewal, etc.).
      // ----------------------------------------------------------
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription

        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id
        const subscriptionId = sub.id

        // Derive tier from the first line item's price ID
        const priceId = sub.items.data[0]?.price?.id || null
        const tier = tierFromPriceId(priceId)

        // Map Stripe subscription statuses to our schema
        let status: 'active' | 'canceled' | 'past_due' = 'active'
        if (sub.status === 'canceled') status = 'canceled'
        else if (sub.status === 'past_due' || sub.status === 'unpaid')
          status = 'past_due'

        const periodStart = new Date(
          sub.current_period_start * 1000
        ).toISOString()
        const periodEnd = new Date(
          sub.current_period_end * 1000
        ).toISOString()

        const { error } = await supabase
          .from('subscriptions')
          .update({
            stripe_subscription_id: subscriptionId,
            tier,
            status,
            current_period_start: periodStart,
            current_period_end: periodEnd,
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        if (error) {
          console.error(
            '[stripe-webhook] Supabase update failed (customer.subscription.updated):',
            error
          )
        } else {
          console.log(
            `[stripe-webhook] Subscription updated for customer ${customerId} (tier: ${tier}, status: ${status})`
          )
        }
        break
      }

      // ----------------------------------------------------------
      // customer.subscription.deleted
      // Fired when a subscription is canceled/expires.
      // ----------------------------------------------------------
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId =
          typeof sub.customer === 'string' ? sub.customer : sub.customer.id

        const { error } = await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        if (error) {
          console.error(
            '[stripe-webhook] Supabase update failed (customer.subscription.deleted):',
            error
          )
        } else {
          console.log(
            `[stripe-webhook] Subscription canceled for customer ${customerId}`
          )
        }
        break
      }

      // ----------------------------------------------------------
      // invoice.payment_failed
      // Fired when an invoice payment attempt fails.
      // ----------------------------------------------------------
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId =
          typeof invoice.customer === 'string'
            ? invoice.customer
            : invoice.customer?.id || null

        if (!customerId) {
          console.error(
            '[stripe-webhook] invoice.payment_failed: missing customer ID',
            { invoiceId: invoice.id }
          )
          break
        }

        const { error } = await supabase
          .from('subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', customerId)

        if (error) {
          console.error(
            '[stripe-webhook] Supabase update failed (invoice.payment_failed):',
            error
          )
        } else {
          console.log(
            `[stripe-webhook] Subscription set to past_due for customer ${customerId}`
          )
        }
        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error(
      `[stripe-webhook] Error processing event ${event.type}:`,
      message
    )
    // Return 200 to prevent Stripe from retrying on our processing errors
    // (signature already verified — the event was received successfully)
    return NextResponse.json(
      { error: 'Internal processing error', received: true },
      { status: 200 }
    )
  }

  return NextResponse.json({ received: true }, { status: 200 })
}

// frontend/app/lib/founding.ts
// ============================================================
// Server-side utility for founding member pricing logic.
// Uses SUPABASE_SERVICE_ROLE_KEY — do NOT import in client components.
// ============================================================

import { createClient } from '@supabase/supabase-js';

const FOUNDING_CAP = 100;

// Hard cutoff: April 15, 2026 11:59 PM ET = April 16 03:59 UTC
const CUTOFF_DATE = new Date('2026-04-16T03:59:00Z');

export interface FoundingStatus {
  isAvailable: boolean;
  remaining: number;
  total: number;
  cap: number;
  isPastCutoff: boolean;
}

export async function getFoundingStatus(): Promise<FoundingStatus> {
  const isPastCutoff = new Date() > CUTOFF_DATE;
  if (isPastCutoff) {
    return { isAvailable: false, remaining: 0, total: FOUNDING_CAP, cap: FOUNDING_CAP, isPastCutoff: true };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { count, error } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('founding_member', true)
      .in('status', ['active', 'trialing']);

    if (error) {
      console.error('getFoundingStatus error:', error);
      return { isAvailable: false, remaining: 0, total: FOUNDING_CAP, cap: FOUNDING_CAP, isPastCutoff: false };
    }

    const total = count ?? 0;
    const remaining = Math.max(0, FOUNDING_CAP - total);
    return { isAvailable: remaining > 0, remaining, total, cap: FOUNDING_CAP, isPastCutoff: false };
  } catch (err) {
    console.error('getFoundingStatus error:', err);
    // Fail closed — never accidentally give founding price on error
    return { isAvailable: false, remaining: 0, total: FOUNDING_CAP, cap: FOUNDING_CAP, isPastCutoff: false };
  }
}

export async function getDoubleAPriceId(): Promise<{ priceId: string; isFounding: boolean }> {
  const foundingPriceId = process.env.STRIPE_FOUNDING_PRICE_ID || 'price_1TB8vOCHMWdtVF7LZY7ThWrX';
  const regularPriceId = process.env.STRIPE_DOUBLE_A_MONTHLY_PRICE_ID || '';

  const status = await getFoundingStatus();
  if (status.isAvailable) {
    return { priceId: foundingPriceId, isFounding: true };
  }
  return { priceId: regularPriceId, isFounding: false };
}

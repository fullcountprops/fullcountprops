import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
const FOUNDING_CAP = 100;
export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { count, error } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('tier', 'double_a')
      .eq('status', 'active');
    if (error) {
      console.error('Founding spots query error', error);
      return NextResponse.json({ total: FOUNDING_CAP, claimed: 0, remaining: 0, available: false });
    }
    const claimed = count ?? 0;
    const remaining = Math.max(0, FOUNDING_CAP - claimed);
    return NextResponse.json({ total: FOUNDING_CAP, claimed, remaining, available: remaining > 0 });
  } catch {
    return NextResponse.json({ total: FOUNDING_CAP, claimed: 0, remaining: 0, available: false });
  }
}

// frontend/app/lib/supabase-browser.ts
// ============================================================
// Browser-side Supabase client (cookie-based sessions via @supabase/ssr)
// Use this in 'use client' components.
// For server components/routes, use supabase.ts getPublicClient/getServiceClient.
// ============================================================
import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createBrowserClient(url, key);
}

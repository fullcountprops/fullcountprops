// frontend/app/lib/supabase-browser.ts
// ============================================================
// Browser-side Supabase client (cookie-based sessions via @supabase/ssr)
// Use this in 'use client' components.
// For server components/routes, use supabase.ts getPublicClient/getServiceClient.
// ============================================================
import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ============================================================
// FullCountProps — Supabase Client Utilities
// Server-side client with service role key for API routes
// ============================================================

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** Public client — uses anon key, respects RLS. Singleton to preserve localStorage session. */
let _publicClient: SupabaseClient | null = null;
export function getPublicClient(): SupabaseClient {
  if (!_publicClient) {
    _publicClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _publicClient;
}

/** Service client — uses service role key, bypasses RLS */
export function getServiceClient(): SupabaseClient {
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured')
  }
  return createClient(supabaseUrl, supabaseServiceKey)
}

/** Check if Supabase is configured */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey)
}

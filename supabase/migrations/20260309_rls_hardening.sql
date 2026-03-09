-- RLS Hardening Migration — 2026-03-09
-- Refs #18
-- Idempotent: safe to re-run. Uses DROP POLICY IF EXISTS / CREATE POLICY (will error if exists).
--
-- Current state from live audit (Mar 9):
--   - All 15 public tables already have RLS enabled ✓
--   - projections has two duplicate PERMISSIVE SELECT policies — drop one
--   - props has 0 policies — needs public read + service_role write
--   - statcast_pitches has 0 policies — needs service_role only

-- 1. Drop duplicate projections policy
DROP POLICY IF EXISTS "Allow public read" ON public.projections;

-- 2. Add props policies
DO $$ BEGIN
  CREATE POLICY "public_read_props" ON public.props FOR SELECT TO public USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "service_role_write_props" ON public.props FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3. Add statcast_pitches service policy
DO $$ BEGIN
  CREATE POLICY "service_role_all_statcast" ON public.statcast_pitches FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

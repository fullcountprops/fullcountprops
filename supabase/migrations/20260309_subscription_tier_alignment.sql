-- ============================================================
-- FullCountProps — Subscription Tier Alignment Migration
-- 2026-03-09
--
-- Aligns the subscriptions table tier values with the website's
-- MiLB-themed tier names (Single-A / Double-A / Triple-A / The Show).
--
-- Stripe products use different names:
--   Stripe "Double-A"  (prod_U5hv04WNsX9goP) → double_a  ($7.99)
--   Stripe "Pro"       (prod_U5etCntbuRQDdH) → triple_a  ($29.00)
--   Stripe "Premium"   (prod_U5f9VI7Q1iJMkT) → the_show  ($49.00)
--
-- DO NOT apply this migration directly — it is tracked in source
-- control and will be applied via the standard migration workflow.
-- ============================================================

-- ── Step 1: Migrate existing tier values ──────────────────────────
UPDATE subscriptions SET tier = 'single_a' WHERE tier = 'free';
UPDATE subscriptions SET tier = 'triple_a' WHERE tier = 'pro';
UPDATE subscriptions SET tier = 'the_show' WHERE tier = 'premium';

-- ── Step 2: Replace the CHECK constraint ──────────────────────────
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_tier_check
  CHECK (tier IN ('single_a', 'double_a', 'triple_a', 'the_show'));

-- Update default to match new naming
ALTER TABLE subscriptions ALTER COLUMN tier SET DEFAULT 'single_a';

-- ── Step 3: Add stripe_product_id column for product-level mapping ─
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS stripe_product_id TEXT;

-- ── Step 4: Add user_id column to link to Supabase auth ───────────
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id UUID;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON subscriptions(stripe_customer_id);

-- ── Step 5: Also align api_keys tier constraint ───────────────────
ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_tier_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_tier_check
  CHECK (tier IN ('double_a', 'triple_a', 'the_show'));

-- Migrate existing api_keys tier values
UPDATE api_keys SET tier = 'the_show' WHERE tier = 'premium';
UPDATE api_keys SET tier = 'triple_a' WHERE tier = 'pro';

-- 007_ai_system.sql
-- AI logging and prompt registry tables for FullCountProps
-- Run in Supabase SQL Editor

-- ============================================
-- 1. AI Call Logs
-- ============================================
CREATE TABLE IF NOT EXISTS ai_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  model TEXT NOT NULL CHECK (model IN ('haiku-4.5', 'sonnet-4.6', 'opus-4.6', 'deepseek-v3.2', 'gpt-4o-mini')),
  prompt_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  user_id UUID,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_ai_logs_created ON ai_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_model ON ai_logs (model, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_prompt ON ai_logs (prompt_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_logs_task ON ai_logs (task_type, created_at DESC);

-- RLS: service role can insert, authenticated users can read their own
ALTER TABLE ai_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role full access' AND tablename = 'ai_logs') THEN
    CREATE POLICY "Service role full access" ON ai_logs
      FOR ALL USING ((SELECT auth.role()) = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Users read own logs' AND tablename = 'ai_logs') THEN
    CREATE POLICY "Users read own logs" ON ai_logs
      FOR SELECT USING ((SELECT auth.uid()) = user_id);
  END IF;
END $$;

-- ============================================
-- 2. AI Prompt Registry (optional DB-backed)
-- ============================================
CREATE TABLE IF NOT EXISTS ai_prompts (
  id TEXT PRIMARY KEY,
  model_default TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  temperature NUMERIC(3, 2) NOT NULL DEFAULT 0.3,
  max_tokens INTEGER NOT NULL DEFAULT 1024,
  extended_thinking_budget INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_prompts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Service role manages prompts' AND tablename = 'ai_prompts') THEN
    CREATE POLICY "Service role manages prompts" ON ai_prompts
      FOR ALL USING ((SELECT auth.role()) = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public read active prompts' AND tablename = 'ai_prompts') THEN
    CREATE POLICY "Public read active prompts" ON ai_prompts
      FOR SELECT USING (is_active = true);
  END IF;
END $$;

-- ============================================
-- 3. Useful views for monitoring
-- ============================================
CREATE OR REPLACE VIEW ai_daily_costs AS
SELECT
  created_at::date AS day,
  model,
  COUNT(*) AS calls,
  SUM(input_tokens) AS total_input_tokens,
  SUM(output_tokens) AS total_output_tokens,
  SUM(cost_usd) AS total_cost_usd,
  AVG(latency_ms)::INTEGER AS avg_latency_ms
FROM ai_logs
WHERE success = true
GROUP BY created_at::date, model
ORDER BY day DESC, model;

CREATE OR REPLACE VIEW ai_prompt_performance AS
SELECT
  prompt_id,
  model,
  COUNT(*) AS total_calls,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) AS successful,
  AVG(latency_ms)::INTEGER AS avg_latency_ms,
  SUM(cost_usd) AS total_cost_usd
FROM ai_logs
GROUP BY prompt_id, model
ORDER BY total_calls DESC;

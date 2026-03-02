-- Migration 006: Rate limit fixes, daily reset, email_subscribers, unique index

-- 1. Fix increment_rate_limit() to use INSERT...ON CONFLICT (upsert)
CREATE OR REPLACE FUNCTION increment_rate_limit(p_key_hash TEXT, p_window_start TIMESTAMPTZ)
RETURNS void AS $$
BEGIN
  INSERT INTO rate_limits (key_hash, window_start, request_count)
  VALUES (p_key_hash, p_window_start, 1)
  ON CONFLICT (key_hash, window_start) 
  DO UPDATE SET request_count = rate_limits.request_count + 1;
END;
$$ LANGUAGE plpgsql;

-- 2. Daily reset function for api_keys.requests_today
CREATE OR REPLACE FUNCTION reset_daily_api_counts()
RETURNS void AS $$
BEGIN
  UPDATE api_keys SET requests_today = 0 WHERE requests_today > 0;
END;
$$ LANGUAGE plpgsql;

-- 3. Ensure email_subscribers table exists
CREATE TABLE IF NOT EXISTS email_subscribers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  source TEXT DEFAULT 'website',
  active BOOLEAN DEFAULT true
);
ALTER TABLE email_subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public subscribe" ON email_subscribers FOR INSERT WITH CHECK (true);
CREATE POLICY "Service role manage subscribers" ON email_subscribers FOR ALL USING (auth.role() = 'service_role');

-- 4. Unique constraint on rate_limits(key_hash, window_start) if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS rate_limits_key_window_idx ON rate_limits (key_hash, window_start);

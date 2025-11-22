-- Table to store user AI provider preferences
CREATE TABLE user_ai_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Search AI config
  search_provider TEXT DEFAULT 'lovable',
  search_model TEXT,
  search_org_id TEXT,
  
  -- Summarize AI config
  summarize_provider TEXT DEFAULT 'lovable',
  summarize_model TEXT,
  summarize_org_id TEXT,
  
  -- Cost tracking
  enable_cost_tracking BOOLEAN DEFAULT false,
  monthly_budget_usd DECIMAL(10,2),
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id)
);

-- Table to store encrypted API keys
CREATE TABLE user_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  vault_secret_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(user_id, provider)
);

-- Table to track AI usage and costs
CREATE TABLE ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd DECIMAL(10,4),
  response_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_ai_usage_user_date ON ai_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_provider ON ai_usage_logs(provider, created_at DESC);
CREATE INDEX idx_user_ai_prefs_user ON user_ai_preferences(user_id);
CREATE INDEX idx_user_api_keys_user ON user_api_keys(user_id);

-- RLS policies
ALTER TABLE user_ai_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own AI preferences"
  ON user_ai_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own AI preferences"
  ON user_ai_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI preferences"
  ON user_ai_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own API keys"
  ON user_api_keys FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own API keys"
  ON user_api_keys FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own usage logs"
  ON ai_usage_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert usage logs"
  ON ai_usage_logs FOR INSERT
  WITH CHECK (true);

-- Function to store user API keys in vault
CREATE OR REPLACE FUNCTION store_user_api_key(
  p_user_id UUID,
  p_provider TEXT,
  p_api_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_new_secret_id UUID;
  v_old_secret_id UUID;
  v_secret_name TEXT;
BEGIN
  -- Check if user already has a key for this provider
  SELECT vault_secret_id INTO v_old_secret_id
  FROM public.user_api_keys
  WHERE user_id = p_user_id AND provider = p_provider;

  -- Create unique secret name
  v_secret_name := format('user_api_%s_%s_%s', p_provider, p_user_id, replace(gen_random_uuid()::text, '-', ''));
  
  -- Store in vault
  v_new_secret_id := vault.create_secret(p_api_key, v_secret_name);

  -- Upsert to user_api_keys table
  INSERT INTO public.user_api_keys (user_id, provider, vault_secret_id, updated_at)
  VALUES (p_user_id, p_provider, v_new_secret_id, now())
  ON CONFLICT (user_id, provider)
  DO UPDATE SET
    vault_secret_id = EXCLUDED.vault_secret_id,
    updated_at = now();

  -- Clean up old secret if exists
  IF v_old_secret_id IS NOT NULL AND v_old_secret_id <> v_new_secret_id THEN
    BEGIN
      DELETE FROM vault.secrets WHERE id = v_old_secret_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not delete old vault secret: %', SQLERRM;
    END;
  END IF;

  RETURN v_new_secret_id;
END;
$$;

-- Function to retrieve user API key from vault
CREATE OR REPLACE FUNCTION get_user_api_key(
  p_user_id UUID,
  p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_vault_secret_id UUID;
  v_decrypted_secret TEXT;
BEGIN
  -- Get vault secret ID
  SELECT vault_secret_id INTO v_vault_secret_id
  FROM public.user_api_keys
  WHERE user_id = p_user_id AND provider = p_provider;
  
  IF v_vault_secret_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Retrieve from vault
  SELECT decrypted_secret INTO v_decrypted_secret
  FROM vault.decrypted_secrets
  WHERE id = v_vault_secret_id;
  
  RETURN jsonb_build_object('api_key', v_decrypted_secret);
END;
$$;

-- Trigger to update updated_at
CREATE TRIGGER update_user_ai_preferences_updated_at
BEFORE UPDATE ON user_ai_preferences
FOR EACH ROW
EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER update_user_api_keys_updated_at
BEFORE UPDATE ON user_api_keys
FOR EACH ROW
EXECUTE FUNCTION handle_updated_at();
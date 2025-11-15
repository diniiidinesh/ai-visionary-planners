-- Remove the token columns from oauth_connections table
-- Tokens will now be stored in Supabase Vault instead
ALTER TABLE public.oauth_connections 
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;

-- Add vault_secret_id to reference the encrypted tokens in vault
ALTER TABLE public.oauth_connections 
  ADD COLUMN vault_secret_id uuid;

-- Create a secure function to store encrypted tokens in vault
CREATE OR REPLACE FUNCTION public.store_encrypted_oauth_tokens(
  p_user_id uuid,
  p_provider text,
  p_access_token text,
  p_refresh_token text,
  p_token_expiry timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret_id uuid;
  v_secret_data jsonb;
BEGIN
  -- Create JSON with encrypted tokens
  v_secret_data := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', p_refresh_token
  );
  
  -- Store in vault
  v_secret_id := vault.create_secret(
    v_secret_data::text,
    format('oauth_%s_%s', p_provider, p_user_id)
  );
  
  -- Update or insert connection record
  INSERT INTO public.oauth_connections (
    user_id,
    provider,
    vault_secret_id,
    token_expiry,
    is_connected,
    updated_at
  )
  VALUES (
    p_user_id,
    p_provider,
    v_secret_id,
    p_token_expiry,
    true,
    now()
  )
  ON CONFLICT (user_id, provider) 
  DO UPDATE SET
    vault_secret_id = EXCLUDED.vault_secret_id,
    token_expiry = EXCLUDED.token_expiry,
    is_connected = EXCLUDED.is_connected,
    updated_at = now();
  
  RETURN v_secret_id;
END;
$$;

-- Create a secure function to retrieve decrypted tokens
CREATE OR REPLACE FUNCTION public.get_oauth_tokens(
  p_user_id uuid,
  p_provider text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vault_secret_id uuid;
  v_decrypted_secret text;
BEGIN
  -- Get vault secret ID for this user and provider
  SELECT vault_secret_id INTO v_vault_secret_id
  FROM public.oauth_connections
  WHERE user_id = p_user_id 
    AND provider = p_provider
    AND is_connected = true;
  
  IF v_vault_secret_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Retrieve and decrypt from vault
  SELECT decrypted_secret INTO v_decrypted_secret
  FROM vault.decrypted_secrets
  WHERE id = v_vault_secret_id;
  
  RETURN v_decrypted_secret::jsonb;
END;
$$;

-- Add unique constraint to prevent duplicate provider connections per user
ALTER TABLE public.oauth_connections 
  ADD CONSTRAINT oauth_connections_user_provider_unique 
  UNIQUE (user_id, provider);
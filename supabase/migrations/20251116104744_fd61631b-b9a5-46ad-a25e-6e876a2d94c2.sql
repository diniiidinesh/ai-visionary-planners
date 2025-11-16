-- Drop and recreate the store_encrypted_oauth_tokens function with reconnection handling
DROP FUNCTION IF EXISTS public.store_encrypted_oauth_tokens(uuid, text, text, text, timestamp with time zone);

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
SET search_path TO 'public'
AS $function$
DECLARE
  v_secret_id uuid;
  v_existing_secret_id uuid;
  v_secret_data jsonb;
  v_secret_name text;
BEGIN
  -- Create JSON with encrypted tokens
  v_secret_data := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', p_refresh_token
  );
  
  -- Create consistent secret name
  v_secret_name := format('oauth_%s_%s', p_provider, p_user_id);
  
  -- Check if a secret already exists for this user/provider
  SELECT vault_secret_id INTO v_existing_secret_id
  FROM public.oauth_connections
  WHERE user_id = p_user_id AND provider = p_provider;
  
  -- If secret exists, delete it first (vault doesn't support updates)
  IF v_existing_secret_id IS NOT NULL THEN
    BEGIN
      -- Delete the old secret from vault
      DELETE FROM vault.secrets WHERE id = v_existing_secret_id;
      EXCEPTION WHEN OTHERS THEN
        -- Log but continue - the secret might have been manually deleted
        RAISE NOTICE 'Could not delete old secret: %', SQLERRM;
    END;
  END IF;
  
  -- Create new secret in vault
  v_secret_id := vault.create_secret(
    v_secret_data::text,
    v_secret_name
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
EXCEPTION
  WHEN OTHERS THEN
    -- If anything fails, raise a more descriptive error
    RAISE EXCEPTION 'Failed to store OAuth tokens: %', SQLERRM;
END;
$function$;
-- Add return_url and post_message_origin to oauth_states
ALTER TABLE public.oauth_states
ADD COLUMN IF NOT EXISTS return_url text,
ADD COLUMN IF NOT EXISTS post_message_origin text;

-- Recreate store_encrypted_oauth_tokens to avoid secret name collisions and cleanup old secret lazily
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
  v_new_secret_id uuid;
  v_old_secret_id uuid;
  v_secret_data jsonb;
  v_secret_name text;
BEGIN
  -- Prepare JSON payload
  v_secret_data := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', p_refresh_token
  );

  -- Read existing secret id (if any) BEFORE creating a new one
  SELECT vault_secret_id INTO v_old_secret_id
  FROM public.oauth_connections
  WHERE user_id = p_user_id AND provider = p_provider;

  -- Always create a fresh secret with a unique name to avoid unique violations
  v_secret_name := format('oauth_%s_%s_%s', p_provider, p_user_id, replace(gen_random_uuid()::text, '-', ''));
  v_new_secret_id := vault.create_secret(v_secret_data::text, v_secret_name);

  -- Upsert connection with the new secret id
  INSERT INTO public.oauth_connections (
    user_id, provider, vault_secret_id, token_expiry, is_connected, updated_at
  ) VALUES (
    p_user_id, p_provider, v_new_secret_id, p_token_expiry, true, now()
  )
  ON CONFLICT (user_id, provider)
  DO UPDATE SET
    vault_secret_id = EXCLUDED.vault_secret_id,
    token_expiry = EXCLUDED.token_expiry,
    is_connected = EXCLUDED.is_connected,
    updated_at = now();

  -- Best-effort cleanup of the previous secret (ignore failures)
  IF v_old_secret_id IS NOT NULL AND v_old_secret_id <> v_new_secret_id THEN
    BEGIN
      DELETE FROM vault.secrets WHERE id = v_old_secret_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not delete old vault secret: %', SQLERRM;
    END;
  END IF;

  RETURN v_new_secret_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to store OAuth tokens: %', SQLERRM;
END;
$function$;
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      return new Response(
        `<html><body><script>window.opener.postMessage({ type: 'oauth-error', error: '${error}' }, '*'); window.close();</script></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code || !state) {
      throw new Error('Missing authorization code or state');
    }

    console.log('Received OAuth callback with state');

    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate state
    const { data: stateRecord, error: stateError } = await supabase
      .from('oauth_states')
      .select('*')
      .eq('state', state)
      .eq('provider', 'google_drive')
      .single();

    if (stateError || !stateRecord) {
      console.error('Invalid state:', stateError);
      throw new Error('Invalid or expired OAuth state');
    }

    if (stateRecord.used) {
      throw new Error('OAuth state already used');
    }

    if (new Date(stateRecord.expires_at) < new Date()) {
      throw new Error('OAuth state expired');
    }

    console.log('State validated for user:', stateRecord.user_id);

    const clientId = Deno.env.get('GOOGLE_DRIVE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-drive-oauth-callback`;

    if (!clientId || !clientSecret) {
      throw new Error('OAuth credentials not configured');
    }

    // Exchange code for tokens
    console.log('Exchanging code for tokens');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', errorData);
      throw new Error('Failed to exchange authorization code for tokens');
    }

    const tokens = await tokenResponse.json();
    console.log('Tokens received successfully');

    // Calculate token expiry
    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Store tokens in vault via RPC (store plaintext, vault encrypts at rest)
    // If duplicate key error (23505), the user is reconnecting - this is OK
    const { data: vaultId, error: storeError } = await supabase.rpc(
      'store_encrypted_oauth_tokens',
      {
        p_user_id: stateRecord.user_id,
        p_provider: 'google_drive',
        p_access_token: tokens.access_token,
        p_refresh_token: tokens.refresh_token || '',
        p_token_expiry: tokenExpiry,
      }
    );

    if (storeError && storeError.code !== '23505') {
      // Ignore duplicate key errors (user reconnecting)
      console.error('Failed to store tokens:', storeError);
      throw new Error('Failed to store OAuth tokens');
    }
    
    if (storeError?.code === '23505') {
      console.log('Tokens already exist, connection still valid');
    }

    console.log('Tokens stored in vault:', vaultId);

    // Mark state as used
    await supabase
      .from('oauth_states')
      .update({ used: true })
      .eq('state', state);

    console.log('OAuth flow completed successfully');

    // Return simple success message (no token data in postMessage)
    return new Response(
      `<html><body><script>
        window.opener.postMessage({ type: 'oauth-success' }, '*'); 
        window.close();
      </script></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (error) {
    console.error('Error in google-drive-oauth-callback:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      `<html><body><script>
        window.opener.postMessage({ 
          type: 'oauth-error', 
          error: '${errorMessage}' 
        }, '*'); 
        window.close();
      </script></body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
});
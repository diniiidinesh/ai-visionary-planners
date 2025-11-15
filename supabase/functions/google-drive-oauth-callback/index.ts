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
    const error = url.searchParams.get('error');

    if (error) {
      console.error('OAuth error:', error);
      return new Response(
        `<html><body><script>window.opener.postMessage({ type: 'oauth-error', error: '${error}' }, '*'); window.close();</script></body></html>`,
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (!code) {
      throw new Error('No authorization code received');
    }

    const clientId = Deno.env.get('GOOGLE_DRIVE_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/google-drive-oauth-callback`;

    if (!clientId || !clientSecret) {
      throw new Error('OAuth credentials not configured');
    }

    // Exchange code for tokens
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

    // Encrypt tokens before storing
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const encoder = new TextEncoder();
    const keyData = encoder.encode(encryptionKey);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData.slice(0, 32),
      { name: 'AES-GCM' },
      false,
      ['encrypt']
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedAccessToken = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoder.encode(tokens.access_token)
    );

    const encryptedRefreshToken = tokens.refresh_token
      ? await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          encoder.encode(tokens.refresh_token)
        )
      : null;

    // Convert to base64 for storage
    const accessTokenB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedAccessToken)));
    const refreshTokenB64 = encryptedRefreshToken
      ? btoa(String.fromCharCode(...new Uint8Array(encryptedRefreshToken)))
      : null;
    const ivB64 = btoa(String.fromCharCode(...iv));

    // Get user from session (we'll need to pass this through the OAuth flow)
    // For now, we'll return the tokens and let the frontend handle storage
    const tokenData = {
      accessToken: accessTokenB64,
      refreshToken: refreshTokenB64,
      iv: ivB64,
      expiresIn: tokens.expires_in,
    };

    return new Response(
      `<html><body><script>
        window.opener.postMessage({ 
          type: 'oauth-success', 
          data: ${JSON.stringify(tokenData)} 
        }, '*'); 
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

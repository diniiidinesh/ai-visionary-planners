import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { StoreOAuthTokenSchema } from '../_shared/validation/schemas.ts';

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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: 'User not authenticated' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    
    // Validate input
    const validationResult = StoreOAuthTokenSchema.safeParse(body);
    if (!validationResult.success) {
      console.error('Validation error:', validationResult.error.format());
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input', 
          details: validationResult.error.errors.map(e => e.message).join(', ')
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const { provider, accessToken, refreshToken, iv, expiresIn } = validationResult.data;

    const tokenExpiry = new Date(Date.now() + expiresIn * 1000);

    // Combine IV with tokens for storage
    const encryptedAccessToken = `${iv}:${accessToken}`;
    const encryptedRefreshToken = refreshToken ? `${iv}:${refreshToken}` : null;

    // Store tokens securely in Vault using the database function
    const { data, error } = await supabaseClient.rpc('store_encrypted_oauth_tokens', {
      p_user_id: user.id,
      p_provider: provider,
      p_access_token: encryptedAccessToken,
      p_refresh_token: encryptedRefreshToken,
      p_token_expiry: tokenExpiry.toISOString(),
    });

    if (error) {
      console.error('Database error:', error);
      throw error;
    }

    console.log('OAuth token stored securely in vault for user:', user.id);

    return new Response(
      JSON.stringify({ success: true, vault_secret_id: data }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in store-oauth-token:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

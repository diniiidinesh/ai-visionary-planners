import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Returns booleans only — never any key material.
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: userKeys } = await supabase
      .from('user_api_keys')
      .select('provider')
      .eq('user_id', user.id);

    const userProviders = new Set((userKeys ?? []).map((k: { provider: string }) => k.provider));

    const projectKey = (provider: string) => !!Deno.env.get(`${provider.toUpperCase()}_API_KEY`);

    const providers = ['lovable', 'openai', 'google'].reduce((acc, provider) => {
      const project = provider === 'lovable' ? !!Deno.env.get('LOVABLE_API_KEY') : projectKey(provider);
      const personal = userProviders.has(provider);
      acc[provider] = { project, personal, configured: project || personal };
      return acc;
    }, {} as Record<string, { project: boolean; personal: boolean; configured: boolean }>);

    return new Response(JSON.stringify({ providers }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in ai-provider-status function:', error);
    return new Response(JSON.stringify({ error: 'Failed to load provider status' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

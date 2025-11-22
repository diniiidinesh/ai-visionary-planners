import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      searchProvider, 
      searchModel, 
      searchOrgId,
      summarizeProvider, 
      summarizeModel,
      summarizeOrgId,
      enableCostTracking,
      monthlyBudgetUsd
    } = await req.json();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Updating AI preferences for user ${user.id}`);

    // Upsert preferences
    const { error: upsertError } = await supabase
      .from('user_ai_preferences')
      .upsert({
        user_id: user.id,
        search_provider: searchProvider,
        search_model: searchModel,
        search_org_id: searchOrgId,
        summarize_provider: summarizeProvider,
        summarize_model: summarizeModel,
        summarize_org_id: summarizeOrgId,
        enable_cost_tracking: enableCostTracking,
        monthly_budget_usd: monthlyBudgetUsd,
        updated_at: new Date().toISOString()
      });

    if (upsertError) {
      console.error('Error updating preferences:', upsertError);
      throw new Error(`Failed to update preferences: ${upsertError.message}`);
    }

    console.log('AI preferences updated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'AI preferences updated successfully'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in update-ai-preferences function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

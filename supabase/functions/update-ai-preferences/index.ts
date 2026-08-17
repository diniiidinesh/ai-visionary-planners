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
      monthlyBudgetUsd,
      temperature,
      maxOutputTokens,
      retrievalTopK,
      passagesToModel,
      minSimilarity,
      maxPassagesPerDoc,
      retrievalMode,
      debugRetrieval
    } = await req.json();

    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

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
        temperature: clamp(temperature, 0, 1, 0.3),
        max_output_tokens: Math.round(clamp(maxOutputTokens, 256, 8000, 2000)),
        retrieval_top_k: Math.round(clamp(retrievalTopK, 5, 40, 20)),
        passages_to_model: Math.round(clamp(passagesToModel, 1, 15, 10)),
        min_similarity: clamp(minSimilarity, 0, 0.9, 0.15),
        max_passages_per_doc: Math.round(clamp(maxPassagesPerDoc, 1, 5, 3)),
        retrieval_mode: ['vector', 'hybrid', 'keyword'].includes(retrievalMode) ? retrievalMode : 'hybrid',
        debug_retrieval: debugRetrieval === true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
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

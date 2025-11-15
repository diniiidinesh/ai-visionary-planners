import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { query } = await req.json();
    
    if (!query || query.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Query is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    console.log(`Processing query for user ${user.id}: "${query}"`);

    // Call Lovable AI to process the query
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiPrompt = `You are a search query optimizer. Analyze this question and break it down into searchable components.

Question: "${query}"

Return a JSON object with:
- entities: Array of key entities, concepts, names, or features mentioned (2-5 items)
- searchVariations: Array of 3-5 alternative keyword searches that could find relevant documents
- documentTypes: Array of document types likely to contain the answer (e.g., "document", "spreadsheet", "presentation", "pdf")
- intent: Single word describing user intent (e.g., "find_document", "summarize_topic", "explain_decision", "compare_options", "get_status")

Example output:
{
  "entities": ["feature X", "roadmap", "Q4 2024"],
  "searchVariations": [
    "feature X roadmap decision",
    "why feature X postponed",
    "feature X prioritization meeting",
    "product decision feature X"
  ],
  "documentTypes": ["document", "spreadsheet", "presentation"],
  "intent": "explain_decision"
}

Return ONLY valid JSON, no other text.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: aiPrompt }
        ],
        temperature: 0.3,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'AI service rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI service error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content;
    
    if (!aiContent) {
      throw new Error('No response from AI service');
    }

    console.log('AI raw response:', aiContent);

    // Parse the AI response (handle markdown code blocks if present)
    let processedQueries;
    try {
      const jsonMatch = aiContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                       aiContent.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : aiContent;
      processedQueries = JSON.parse(jsonStr.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError, aiContent);
      // Fallback to basic query processing
      processedQueries = {
        entities: [query],
        searchVariations: [query],
        documentTypes: ["document", "spreadsheet", "presentation"],
        intent: "find_document"
      };
    }

    // Save to database
    const { data: savedQuery, error: saveError } = await supabase
      .from('search_queries')
      .insert({
        user_id: user.id,
        original_query: query,
        processed_queries: processedQueries,
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving query:', saveError);
    }

    console.log('Query processed successfully:', processedQueries);

    return new Response(
      JSON.stringify({
        queryId: savedQuery?.id,
        originalQuery: query,
        ...processedQueries,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-search function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

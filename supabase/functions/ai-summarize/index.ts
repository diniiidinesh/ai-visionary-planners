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
    const { question, documents, queryId } = await req.json();

    if (!question || !documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Question and documents are required' }),
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

    console.log(`Generating AI summary for user ${user.id}`);
    console.log(`Question: "${question}"`);
    console.log(`Documents count: ${documents.length}`);

    // Format documents for AI
    const formattedDocs = documents.map((doc: any, idx: number) => {
      let docText = `[Document ${idx + 1}: "${doc.name}"]\nURL: ${doc.webViewLink}\nType: ${doc.mimeType}\nLast Modified: ${doc.modifiedTime}\n${doc.owners ? `Owner: ${doc.owners[0]?.displayName}` : ''}`;
      
      if (doc.content) {
        docText += `\n\n--- Content Preview ---\n${doc.content}\n--- End Content ---`;
      }
      
      return docText;
    }).join('\n\n');

    // Call Lovable AI for summarization
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiPrompt = `You are a knowledgeable assistant helping answer questions based on document search results.

**Question**: ${question}

**Available Documents**:
${formattedDocs}

**Instructions**:
1. Answer the question based ONLY on the documents provided above
2. Cite sources inline using markdown format: [Source: Document Name](URL)
3. Use direct quotes when available and relevant
4. If documents contain contradictory information, mention it
5. If the answer cannot be found in the documents, clearly state: "I couldn't find information about this in the available documents."
6. Structure your answer with clear paragraphs
7. Be concise but comprehensive
8. Use markdown formatting (bold, lists, etc.) for better readability

Generate a helpful summary that directly answers the user's question.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'user', content: aiPrompt }
        ],
        temperature: 0.4,
        max_tokens: 2000,
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
    const summary = aiData.choices?.[0]?.message?.content;
    
    if (!summary) {
      throw new Error('No summary generated from AI service');
    }

    console.log('Summary generated successfully');

    // Save to database
    if (queryId) {
      try {
        await supabase
          .from('search_results')
          .insert({
            search_query_id: queryId,
            user_id: user.id,
            ai_summary: summary,
            sources_used: documents.map((doc: any) => ({
              id: doc.id,
              name: doc.name,
              url: doc.webViewLink,
              relevance_score: doc.relevanceScore || 0,
            })),
            model_used: 'google/gemini-2.5-pro',
          });
      } catch (saveError) {
        console.error('Error saving search result:', saveError);
        // Continue even if saving fails
      }
    }

    return new Response(
      JSON.stringify({ 
        summary,
        documentsUsed: documents.length,
        model: 'google/gemini-2.5-pro'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-summarize function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

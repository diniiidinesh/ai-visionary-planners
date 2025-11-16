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

    const aiPrompt = `You are an expert assistant providing precise answers based on document search results.

**User Question**: ${question}

**Available Source Documents**:
${formattedDocs}

**Critical Instructions**:
1. **Answer Accuracy**: Base your response EXCLUSIVELY on the documents provided above. Never use external knowledge.

2. **Source Citation**: 
   - Cite ALL sources inline using: [Document Name](URL)
   - Reference specific documents when making claims
   - Example: "According to [Q4 Report](url), revenue increased by 15%"

3. **Content Quality**:
   - Provide specific facts, figures, and quotes when available
   - Use **bold** for key findings and important terms
   - Structure with clear paragraphs and bullet points for lists
   - Include relevant dates, numbers, and specific details

4. **Handling Uncertainty**:
   - If information is contradictory across documents, present both views with sources
   - If confidence is low, state: "Based on limited information in [Doc Name]..."
   - If answer is not found, clearly state: "❌ The available documents do not contain information about this."

5. **Response Format**:
   - Start with a direct answer to the question
   - Follow with supporting details and evidence
   - End with relevant document links if helpful
   - Keep responses concise but thorough (aim for 150-300 words unless more detail is needed)

6. **Confidence Indicator**: 
   - End your response with one of:
     - ✅ **High Confidence**: Answer fully supported by multiple documents
     - ⚠️ **Medium Confidence**: Answer based on limited or single source
     - ❌ **Low Confidence**: Insufficient information in documents

Generate a well-structured, evidence-based response.`;

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

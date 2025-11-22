import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { AIProviderFactory } from '../_shared/ai/provider-factory.ts';
import { AIConfigManager } from '../_shared/ai/config-manager.ts';
import { AISummarizeSchema } from '../_shared/validation/schemas.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Validate input
    const validationResult = AISummarizeSchema.safeParse(body);
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
    
    const { question, documents, queryId } = validationResult.data;

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

    // Get AI provider configuration
    const configManager = new AIConfigManager(supabase, user.id);
    const providerConfig = await configManager.getProviderConfig('summarize');
    
    // Create AI provider
    const aiProvider = AIProviderFactory.create(providerConfig);
    
    console.log(`Using ${providerConfig.provider}/${providerConfig.model} for summarization`);

    // Build AI prompt
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

    // Make AI request
    const startTime = Date.now();
    const aiResponse = await aiProvider.chat({
      messages: [{ role: 'user', content: aiPrompt }],
      temperature: 0.4,
      maxTokens: 2000
    });
    
    const responseTime = Date.now() - startTime;
    
    if (!aiResponse.content) {
      throw new Error('No summary generated from AI service');
    }

    console.log('Summary generated successfully');
    console.log(`Response time: ${responseTime}ms, Provider: ${aiResponse.provider}/${aiResponse.model}`);

    // Save to database
    if (queryId) {
      try {
        await supabase
          .from('search_results')
          .insert({
            search_query_id: queryId,
            user_id: user.id,
            ai_summary: aiResponse.content,
            sources_used: documents.map((doc: any) => ({
              id: doc.id,
              name: doc.name,
              url: doc.webViewLink,
              relevance_score: doc.relevanceScore || 0,
            })),
            model_used: `${aiResponse.provider}/${aiResponse.model}`,
          });
      } catch (saveError) {
        console.error('Error saving search result:', saveError);
        // Continue even if saving fails
      }
    }

    return new Response(
      JSON.stringify({ 
        summary: aiResponse.content,
        documentsUsed: documents.length,
        model: `${aiResponse.provider}/${aiResponse.model}`
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

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { AIProviderFactory } from '../_shared/ai/provider-factory.ts';
import { AIConfigManager } from '../_shared/ai/config-manager.ts';
import { embedQuery, EmbeddingError } from '../_shared/rag/embeddings.ts';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RagAnswerSchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
  queryId: z.string().optional(),
  matchCount: z.number().int().min(1).max(40).optional(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const validation = RagAnswerSchema.safeParse(body);
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid input', details: validation.error.issues }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { question, queryId, matchCount } = validation.data;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Nothing indexed yet -> tell the client to use the live-search fallback.
    const { count: indexedChunks } = await supabase
      .from('document_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (!indexedChunks) {
      return new Response(
        JSON.stringify({ notIndexed: true, error: 'No indexed documents yet. Run an index of your Drive first.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const startTime = Date.now();
    const queryEmbedding = await embedQuery(question);

    const { data: matches, error: matchError } = await supabase.rpc('match_document_chunks', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_count: matchCount ?? 20,
      p_source_type: 'google_drive',
      p_min_similarity: 0.15,
    });

    if (matchError) {
      console.error('Vector search failed:', matchError);
      throw new Error(matchError.message);
    }

    const chunks = (matches || []) as any[];
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({
          summary: '❌ The indexed documents do not contain information about this.',
          sources: [],
          chunksUsed: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Keep at most 3 chunks per document so one file can't crowd out the rest.
    const perDoc = new Map<string, number>();
    const selected = chunks.filter((c) => {
      const used = perDoc.get(c.source_id) ?? 0;
      if (used >= 3) return false;
      perDoc.set(c.source_id, used + 1);
      return true;
    }).slice(0, 10);

    const sources = Array.from(
      new Map(selected.map((c) => [c.source_id, {
        id: c.source_id,
        name: c.title,
        url: c.full_url,
        mimeType: c.mime_type,
        topSimilarity: c.similarity,
      }])).values()
    );

    const context = selected.map((c, i) =>
      `[${i + 1}] Document: "${c.title}"\nURL: ${c.full_url}\nRelevance: ${(c.similarity * 100).toFixed(1)}%\n---\n${c.content}\n---`
    ).join('\n\n');

    const configManager = new AIConfigManager(supabase, user.id);
    const providerConfig = await configManager.getProviderConfig('summarize');
    const aiProvider = AIProviderFactory.create(providerConfig);

    const prompt = `You are answering a question strictly from retrieved excerpts of the user's own documents.

**Question**: ${question}

**Retrieved excerpts**:
${context}

**Instructions**:
1. Use ONLY the excerpts above. Never rely on outside knowledge.
2. Cite every claim inline with the bracket number of the excerpt, e.g. "revenue rose 15% [2]".
3. Be specific: include figures, dates, names and short quotes when present.
4. If excerpts disagree, present both views with their citations.
5. If the excerpts do not answer the question, say: "❌ The indexed documents do not contain information about this."
6. Aim for 150-300 words, using **bold** for key findings and bullets for lists.
7. End with one of: ✅ **High Confidence**, ⚠️ **Medium Confidence**, or ❌ **Low Confidence**.`;

    const aiResponse = await aiProvider.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 2000,
    });

    const responseTime = Date.now() - startTime;
    if (!aiResponse.content) throw new Error('No answer generated from AI service');

    if (queryId) {
      const { error: saveError } = await supabase.from('search_results').insert({
        search_query_id: queryId,
        user_id: user.id,
        ai_summary: aiResponse.content,
        sources_used: sources,
        model_used: `${aiResponse.provider}/${aiResponse.model}`,
      });
      if (saveError) console.error('Error saving search result:', saveError.message);
    }

    const { error: logError } = await supabase.from('ai_usage_logs').insert({
      user_id: user.id,
      provider: aiResponse.provider,
      model: aiResponse.model,
      purpose: 'rag_answer',
      prompt_tokens: aiResponse.usage?.promptTokens ?? null,
      completion_tokens: aiResponse.usage?.completionTokens ?? null,
      total_tokens: aiResponse.usage?.totalTokens ?? null,
      response_time_ms: responseTime,
    });
    if (logError) console.error('Error logging AI usage:', logError.message);

    return new Response(
      JSON.stringify({
        summary: aiResponse.content,
        sources,
        excerpts: selected.map((c, i) => ({
          ref: i + 1,
          title: c.title,
          url: c.full_url,
          similarity: c.similarity,
          content: c.content,
        })),
        chunksUsed: selected.length,
        model: `${aiResponse.provider}/${aiResponse.model}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('Error in rag-answer function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { AIProviderFactory } from '../_shared/ai/provider-factory.ts';
import { AIConfigManager } from '../_shared/ai/config-manager.ts';
import {
  embedQuery,
  EmbeddingError,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  VOYAGE_EMBEDDING_DIMENSIONS,
  VOYAGE_EMBEDDING_MODEL,
  voyageConfigured,
  type EmbeddingSpace,
} from '../_shared/rag/embeddings.ts';
import { CHUNK_SIZE, CHUNK_OVERLAP, METADATA_VERSION } from '../_shared/rag/chunker.ts';
import { rerank, RerankError } from '../_shared/rag/reranker.ts';
import { planQuery } from '../_shared/rag/query-planner.ts';
import { buildCorpusProfile, renderCorpusContext } from '../_shared/rag/corpus-overview.ts';
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const HistoryTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
});

const RagAnswerSchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
  queryId: z.string().optional(),
  matchCount: z.number().int().min(1).max(40).optional(),
  // Prior turns in the conversation, oldest first. Used to (a) resolve
  // follow-up questions ("what about Q3?") into a standalone search query,
  // and (b) give the answer model conversational context. Capped client-side.
  history: z.array(HistoryTurnSchema).max(12).optional(),
  // Per-request overrides (the tuning console can preview without saving).
  overrides: z.object({
    temperature: z.number().min(0).max(1).optional(),
    maxOutputTokens: z.number().int().min(256).max(8000).optional(),
    retrievalTopK: z.number().int().min(5).max(40).optional(),
    passagesToModel: z.number().int().min(1).max(15).optional(),
    minSimilarity: z.number().min(0).max(0.9).optional(),
    maxPassagesPerDoc: z.number().int().min(1).max(5).optional(),
    retrievalMode: z.enum(['vector', 'hybrid', 'keyword']).optional(),
    embeddingProvider: z.enum(['openai', 'voyage']).optional(),
    debugRetrieval: z.boolean().optional(),
    // Forces the answering path instead of trusting the planner's
    // classification. Two jobs: a kill switch if routing ever misbehaves in
    // production (pin every request to 'lookup' without a redeploy), and a way
    // for evals to exercise the catalog path deterministically rather than
    // depending on the classifier being right that run.
    intent: z.enum(['lookup', 'corpus_overview']).optional(),
  }).optional(),
});

const DEFAULTS = {
  temperature: 0.3,
  maxOutputTokens: 2000,
  retrievalTopK: 20,
  passagesToModel: 10,
  minSimilarity: 0.15,
  maxPassagesPerDoc: 3,
  retrievalMode: 'hybrid' as const,
  embeddingProvider: 'openai' as const,
  debugRetrieval: false,
};

/** Documents returned as `sources` on a corpus answer. See the corpus branch. */
const CORPUS_SOURCES_SHOWN = 12;

/** RRF weights per retrieval mode. */
function weightsFor(mode: string): { vector: number; keyword: number } {
  if (mode === 'vector') return { vector: 1, keyword: 0 };
  if (mode === 'keyword') return { vector: 0, keyword: 1 };
  return { vector: 1, keyword: 1 };
}

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
    const { question, queryId, matchCount, overrides, history } = validation.data;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      console.error('rag-answer auth failure:', userError?.message ?? 'no user for token');
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

    // Load tuning preferences, then apply any per-request override.
    const { data: prefs } = await supabase
      .from('user_ai_preferences')
      .select('temperature, max_output_tokens, retrieval_top_k, passages_to_model, min_similarity, max_passages_per_doc, retrieval_mode, embedding_provider, debug_retrieval')
      .eq('user_id', user.id)
      .maybeSingle();

    const settings = {
      temperature: overrides?.temperature ?? Number(prefs?.temperature ?? DEFAULTS.temperature),
      maxOutputTokens: overrides?.maxOutputTokens ?? (prefs?.max_output_tokens ?? DEFAULTS.maxOutputTokens),
      retrievalTopK: overrides?.retrievalTopK ?? matchCount ?? (prefs?.retrieval_top_k ?? DEFAULTS.retrievalTopK),
      passagesToModel: overrides?.passagesToModel ?? (prefs?.passages_to_model ?? DEFAULTS.passagesToModel),
      minSimilarity: overrides?.minSimilarity ?? Number(prefs?.min_similarity ?? DEFAULTS.minSimilarity),
      maxPassagesPerDoc: overrides?.maxPassagesPerDoc ?? (prefs?.max_passages_per_doc ?? DEFAULTS.maxPassagesPerDoc),
      retrievalMode: overrides?.retrievalMode ?? (prefs?.retrieval_mode ?? DEFAULTS.retrievalMode),
      embeddingProvider: (overrides?.embeddingProvider ?? (prefs?.embedding_provider ?? DEFAULTS.embeddingProvider)) as EmbeddingSpace,
      debugRetrieval: overrides?.debugRetrieval ?? (prefs?.debug_retrieval ?? DEFAULTS.debugRetrieval),
    };

    // Voyage retrieval needs both the key and a Voyage-embedded index.
    let embeddingSpace: EmbeddingSpace = settings.embeddingProvider;
    let embeddingFallback: string | null = null;
    if (embeddingSpace === 'voyage') {
      if (!voyageConfigured()) {
        embeddingSpace = 'openai';
        embeddingFallback = 'VOYAGE_API_KEY is not configured — used the OpenAI embedding space.';
      } else {
        const { count: voyageChunks } = await supabase
          .from('document_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .not('embedding_voyage', 'is', null);
        if (!voyageChunks) {
          embeddingSpace = 'openai';
          embeddingFallback = 'No Voyage embeddings indexed yet — run a full re-index. Used the OpenAI embedding space.';
        }
      }
    }
    settings.embeddingProvider = embeddingSpace;

    // Documents indexed with a different embedding model or chunk settings.
    const { count: staleDocuments } = await supabase
      .from('document_index')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('ingest_status', 'indexed')
      .or(
        `embedding_model.neq.${EMBEDDING_MODEL},chunk_size.neq.${CHUNK_SIZE},chunk_overlap.neq.${CHUNK_OVERLAP},metadata_version.neq.${METADATA_VERSION},embedding_model.is.null`
      );

    const startTime = Date.now();
    const configManager = new AIConfigManager(supabase, user.id);

    // Plan the retrieval queries. One model call resolves conversational
    // references into a standalone question (for the embedding) AND produces
    // short keyword queries (for full-text search) — see query-planner.ts for
    // why the two channels need different query shapes. Degrades to the raw
    // question on any failure.
    const planProvider = AIProviderFactory.create(await configManager.getProviderConfig('search'));
    const plan = await planQuery(planProvider, question, history ?? []);
    const retrievalQuery = plan.standaloneQuestion;

    // Corpus-level questions ("what's in my Drive?") are answered from the
    // catalog, not from retrieved passages — top-k retrieval would show the
    // model a handful of documents and let it describe them as the whole
    // collection. Falls through to normal retrieval if the catalog is empty,
    // so an orphaned-chunks state can't produce a description of nothing.
    const effectiveIntent = overrides?.intent ?? plan.intent;

    if (effectiveIntent === 'corpus_overview') {
      const profile = await buildCorpusProfile(supabase, user.id, 'google_drive');

      if (profile.totalDocuments > 0) {
        const overviewProvider = AIProviderFactory.create(await configManager.getProviderConfig('summarize'));

        const overviewPrompt = `You are describing the contents of the user's indexed document collection.

**Question**: ${question}

**Catalog data** (exact counts queried from the index, not estimates):
${renderCorpusContext(profile)}

**Instructions**:
1. Answer using ONLY the catalog data above. Every number you state must appear there — never estimate or extrapolate.
2. Lead with the direct answer to what was asked (a count, the file types, the folders), then add the useful supporting detail.
3. If the document listing is marked PARTIAL, say so explicitly and state how many documents it covers out of the total. Never present a partial list as complete.
4. If the catalog is marked OUT OF DATE, lead with the real figures, say plainly that per-document details are incomplete for documents indexed by an older build, and recommend re-running the Drive index. Never report that nothing is indexed while searchable passages exist.
5. This data describes the documents as FILES — names, types, folders, sizes, dates. It does NOT say what they contain. If the question asks what the documents say or which topics they cover, answer what you can from names and folders, then state plainly that determining actual subject matter would require reading the documents themselves.
6. Group and summarise rather than dumping the raw list — mention notable or representative documents by name instead of listing everything.
7. Aim for 150-300 words, using **bold** for key figures and bullets for breakdowns.
8. End with one of: ✅ **High Confidence**, ⚠️ **Medium Confidence**, or ❌ **Low Confidence**.`;

        const overviewResponse = await overviewProvider.chat({
          messages: [{ role: 'user' as const, content: overviewPrompt }],
          temperature: settings.temperature,
          maxTokens: settings.maxOutputTokens,
        });

        const overviewTime = Date.now() - startTime;
        if (!overviewResponse.content) throw new Error('No answer generated from AI service');

        const { error: overviewLogError } = await supabase.from('ai_usage_logs').insert({
          user_id: user.id,
          provider: overviewResponse.provider,
          model: overviewResponse.model,
          purpose: 'rag_corpus_overview',
          prompt_tokens: overviewResponse.usage?.promptTokens ?? null,
          completion_tokens: overviewResponse.usage?.completionTokens ?? null,
          total_tokens: overviewResponse.usage?.totalTokens ?? null,
          response_time_ms: overviewTime,
        });
        if (overviewLogError) console.error('Error logging AI usage:', overviewLogError.message);

        return new Response(
          JSON.stringify({
            summary: overviewResponse.content,
            answerMode: 'corpus_overview',
            // Capped well below the listing the model saw. Search.tsx renders
            // every source as a chip with a relevance score, and a corpus
            // question can match hundreds of documents at no relevance at all —
            // the answer already carries the real totals, so flooding the UI
            // with 100 zero-percent chips would be noise, not provenance.
            sources: profile.documents.slice(0, CORPUS_SOURCES_SHOWN).map((d) => ({
              id: d.sourceId,
              name: d.title,
              url: d.url,
              mimeType: d.fileType,
              author: null,
              modifiedTime: d.modifiedTime,
              topSimilarity: null,
            })),
            excerpts: [],
            chunksUsed: 0,
            model: `${overviewResponse.provider}/${overviewResponse.model}`,
            settings,
            staleDocuments: staleDocuments ?? 0,
            corpus: {
              totalDocuments: profile.totalDocuments,
              indexedDocuments: profile.indexedDocuments,
              totalChunks: profile.totalChunks,
              listingTruncated: profile.listingTruncated,
              statsComplete: profile.statsComplete,
            },
            retrieval: settings.debugRetrieval
              ? {
                  intent: effectiveIntent,
                  classifiedIntent: plan.intent,
                  intentForced: overrides?.intent != null,
                  // No embedding, search or rerank runs on this path.
                  mode: null,
                  embeddingSpace: null,
                  candidates: [],
                  reranked: false,
                  retrievalQuery: retrievalQuery !== question ? retrievalQuery : null,
                  keywordQueries: null,
                }
              : null,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.warn('corpus_overview intent but the catalog is empty — falling back to retrieval.');
    }

    const weights = weightsFor(settings.retrievalMode);
    const activeDims = embeddingSpace === 'voyage' ? VOYAGE_EMBEDDING_DIMENSIONS : EMBEDDING_DIMENSIONS;
    const queryEmbedding = weights.vector > 0
      ? await embedQuery(retrievalQuery, embeddingSpace)
      : new Array(activeDims).fill(0);

    // The RPC takes both spaces; only the one named by p_embedding_space is read.
    const { data: matches, error: matchError } = await supabase.rpc('match_document_chunks_hybrid_space', {
      query_embedding_openai: JSON.stringify(
        embeddingSpace === 'openai' ? queryEmbedding : new Array(EMBEDDING_DIMENSIONS).fill(0)
      ),
      query_embedding_voyage: JSON.stringify(
        embeddingSpace === 'voyage' ? queryEmbedding : new Array(VOYAGE_EMBEDDING_DIMENSIONS).fill(0)
      ),
      p_embedding_space: embeddingSpace,
      query_texts: plan.keywordQueries,
      match_count: settings.retrievalTopK,
      p_source_type: 'google_drive',
      p_min_similarity: settings.minSimilarity,
      p_vector_weight: weights.vector,
      p_keyword_weight: weights.keyword,
    });

    if (matchError) {
      console.error('Hybrid search failed:', matchError);
      throw new Error(matchError.message);
    }

    let chunks = (matches || []) as any[];
    if (chunks.length === 0) {
      return new Response(
        JSON.stringify({
          summary: '❌ The indexed documents do not contain information about this.',
          answerMode: 'lookup',
          sources: [],
          chunksUsed: 0,
          settings,
          staleDocuments: staleDocuments ?? 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Reranking: a cross-encoder re-scores query+passage pairs together, which
    // catches relevance that cosine similarity / keyword rank alone miss.
    // Silently no-ops (keeps hybrid order) if VOYAGE_API_KEY isn't set.
    let reranked = false;
    try {
      const rerankResult = await rerank(
        retrievalQuery,
        chunks.map((c) => c.content as string),
        Math.min(chunks.length, settings.retrievalTopK)
      );
      if (rerankResult) {
        reranked = true;
        chunks = rerankResult
          .map((r) => ({ ...chunks[r.index], rerank_score: r.relevanceScore }))
          .sort((a, b) => b.rerank_score - a.rerank_score);
      }
    } catch (err) {
      console.error('Rerank failed, falling back to hybrid order:', err);
    }

    // Cap passages per document so one file can't crowd out the rest.
    const perDoc = new Map<string, number>();
    const selected = chunks.filter((c) => {
      const used = perDoc.get(c.source_id) ?? 0;
      if (used >= settings.maxPassagesPerDoc) return false;
      perDoc.set(c.source_id, used + 1);
      return true;
    }).slice(0, settings.passagesToModel);

    const selectedIds = new Set(selected.map((c) => c.id));

    const sources = Array.from(
      new Map(selected.map((c) => [c.source_id, {
        id: c.source_id,
        name: c.title,
        url: c.full_url,
        mimeType: c.mime_type,
        author: c.author ?? null,
        modifiedTime: c.doc_modified_time ?? null,
        topSimilarity: c.similarity,
      }])).values()
    );

    const context = selected.map((c, i) => {
      const header = [
        `Document: "${c.title}"`,
        c.heading ? `Section: ${c.heading}` : null,
        c.author ? `Author: ${c.author}` : null,
        c.doc_modified_time ? `Last modified: ${new Date(c.doc_modified_time).toISOString().slice(0, 10)}` : null,
        `URL: ${c.full_url}`,
        `Relevance: ${(Number(c.similarity ?? 0) * 100).toFixed(1)}%`,
        reranked ? `Rerank score: ${(Number(c.rerank_score ?? 0) * 100).toFixed(1)}%` : null,
      ].filter(Boolean).join('\n');
      return `[${i + 1}] ${header}\n---\n${c.content}\n---`;
    }).join('\n\n');

    const providerConfig = await configManager.getProviderConfig('summarize');
    const aiProvider = AIProviderFactory.create(providerConfig);

    const prompt = `You are answering a question strictly from retrieved excerpts of the user's own documents.
${history && history.length > 0 ? '\nThe user may be asking a follow-up — use the prior conversation only to resolve references (e.g. "that", "the other one"); still answer strictly from the excerpts below.\n' : ''}
**Question**: ${question}

**Retrieved excerpts**:
${context}

**Instructions**:
1. Use ONLY the excerpts above. Never rely on outside knowledge.
2. Cite every claim inline with the bracket number of the excerpt, e.g. "revenue rose 15% [2]".
3. Be specific: include figures, dates, names and short quotes when present. Markdown tables in the excerpts preserve rows and columns — read them as tables.
4. If excerpts disagree, present both views with their citations.
5. If the excerpts do not answer the question, say: "❌ The indexed documents do not contain information about this."
6. Aim for 150-300 words, using **bold** for key findings and bullets for lists.
7. End with one of: ✅ **High Confidence**, ⚠️ **Medium Confidence**, or ❌ **Low Confidence**.`;

    // Prior turns ride as real conversation messages (so the model gets tone
    // and referents "for free"); the current question + excerpts + rules go
    // in the final user turn.
    const conversationMessages = [
      ...(history ?? []).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: prompt },
    ];

    const aiResponse = await aiProvider.chat({
      messages: conversationMessages,
      temperature: settings.temperature,
      maxTokens: settings.maxOutputTokens,
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
        answerMode: 'lookup',
        sources,
        excerpts: selected.map((c, i) => ({
          ref: i + 1,
          title: c.title,
          heading: c.heading ?? null,
          author: c.author ?? null,
          modifiedTime: c.doc_modified_time ?? null,
          url: c.full_url,
          similarity: c.similarity,
          content: c.content,
        })),
        chunksUsed: selected.length,
        model: `${aiResponse.provider}/${aiResponse.model}`,
        settings,
        staleDocuments: staleDocuments ?? 0,
        retrieval: settings.debugRetrieval
          ? {
              intent: effectiveIntent,
              classifiedIntent: plan.intent,
              intentForced: overrides?.intent != null,
              mode: settings.retrievalMode,
              embeddingSpace,
              embeddingModel: embeddingSpace === 'voyage' ? VOYAGE_EMBEDDING_MODEL : EMBEDDING_MODEL,
              embeddingFallback,
              candidates: chunks.map((c) => ({
                title: c.title,
                heading: c.heading ?? null,
                chunkIndex: c.chunk_index,
                similarity: c.similarity,
                keywordScore: c.keyword_score,
                vectorRank: c.vector_rank,
                keywordRank: c.keyword_rank,
                fusedScore: c.fused_score,
                rerankScore: reranked ? c.rerank_score : null,
                used: selectedIds.has(c.id),
                preview: String(c.content ?? '').slice(0, 240),
              })),
              reranked,
              retrievalQuery: retrievalQuery !== question ? retrievalQuery : null,
              keywordQueries: plan.planned ? plan.keywordQueries : null,
            }
          : null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    if (error instanceof EmbeddingError || error instanceof RerankError) {
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

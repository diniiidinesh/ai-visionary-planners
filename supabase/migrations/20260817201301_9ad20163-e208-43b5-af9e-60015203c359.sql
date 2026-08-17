ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS embedding_voyage vector(1024),
  ADD COLUMN IF NOT EXISTS embedding_voyage_model text;

CREATE INDEX IF NOT EXISTS document_chunks_embedding_voyage_idx
  ON public.document_chunks USING hnsw (embedding_voyage vector_cosine_ops)
  WHERE embedding_voyage IS NOT NULL;

ALTER TABLE public.user_ai_preferences
  ADD COLUMN IF NOT EXISTS embedding_provider text NOT NULL DEFAULT 'openai';

ALTER TABLE public.user_ai_preferences
  DROP CONSTRAINT IF EXISTS user_ai_preferences_embedding_provider_check;
ALTER TABLE public.user_ai_preferences
  ADD CONSTRAINT user_ai_preferences_embedding_provider_check
  CHECK (embedding_provider IN ('openai', 'voyage'));

CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid_space(
  query_embedding_openai vector,
  query_embedding_voyage vector,
  p_embedding_space text,
  query_texts text[],
  match_count integer,
  p_source_type text DEFAULT 'google_drive',
  p_min_similarity double precision DEFAULT 0.15,
  p_vector_weight double precision DEFAULT 1.0,
  p_keyword_weight double precision DEFAULT 1.0
)
RETURNS TABLE (
  id uuid,
  source_type text,
  source_id text,
  title text,
  full_url text,
  mime_type text,
  chunk_index integer,
  content text,
  heading text,
  author text,
  doc_modified_time timestamp with time zone,
  similarity double precision,
  keyword_score double precision,
  vector_rank integer,
  keyword_rank integer,
  fused_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH vector_hits AS (
    SELECT
      c.id,
      CASE
        WHEN p_embedding_space = 'voyage'
          THEN 1 - (c.embedding_voyage <=> query_embedding_voyage)
        ELSE 1 - (c.embedding::halfvec(3072) <=> query_embedding_openai::halfvec(3072))
      END AS sim
    FROM public.document_chunks c
    WHERE c.user_id = auth.uid()
      AND c.source_type = p_source_type
      AND (
        (p_embedding_space = 'voyage' AND c.embedding_voyage IS NOT NULL)
        OR (p_embedding_space <> 'voyage')
      )
      AND p_vector_weight > 0
    ORDER BY
      CASE
        WHEN p_embedding_space = 'voyage' THEN c.embedding_voyage <=> query_embedding_voyage
        ELSE (c.embedding::halfvec(3072) <=> query_embedding_openai::halfvec(3072))
      END
    LIMIT match_count * 3
  ),
  vector_ranked AS (
    SELECT id, sim, ROW_NUMBER() OVER (ORDER BY sim DESC)::int AS v_rank
    FROM vector_hits
    WHERE sim >= p_min_similarity
  ),
  keyword_hits AS (
    SELECT
      c.id,
      MAX(ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', q)))::double precision AS kscore
    FROM public.document_chunks c
    CROSS JOIN unnest(coalesce(query_texts, ARRAY[]::text[])) AS q
    WHERE c.user_id = auth.uid()
      AND c.source_type = p_source_type
      AND p_keyword_weight > 0
      AND q <> ''
      AND c.content_tsv @@ websearch_to_tsquery('english', q)
    GROUP BY c.id
    ORDER BY kscore DESC
    LIMIT match_count * 3
  ),
  keyword_ranked AS (
    SELECT id, kscore, ROW_NUMBER() OVER (ORDER BY kscore DESC)::int AS k_rank
    FROM keyword_hits
  ),
  fused AS (
    SELECT
      COALESCE(v.id, k.id) AS id,
      v.sim,
      k.kscore,
      v.v_rank,
      k.k_rank,
      COALESCE(p_vector_weight / (60 + v.v_rank), 0) +
      COALESCE(p_keyword_weight / (60 + k.k_rank), 0) AS fscore
    FROM vector_ranked v
    FULL OUTER JOIN keyword_ranked k ON k.id = v.id
  )
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.title,
    c.full_url,
    c.mime_type,
    c.chunk_index,
    c.content,
    c.heading,
    c.author,
    c.doc_modified_time,
    COALESCE(f.sim, 0)::double precision AS similarity,
    COALESCE(f.kscore, 0)::double precision AS keyword_score,
    f.v_rank AS vector_rank,
    f.k_rank AS keyword_rank,
    f.fscore AS fused_score
  FROM fused f
  JOIN public.document_chunks c ON c.id = f.id
  ORDER BY f.fscore DESC
  LIMIT match_count;
$$;

REVOKE ALL ON FUNCTION public.match_document_chunks_hybrid_space(vector, vector, text, text[], integer, text, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_hybrid_space(vector, vector, text, text[], integer, text, double precision, double precision, double precision) TO authenticated;
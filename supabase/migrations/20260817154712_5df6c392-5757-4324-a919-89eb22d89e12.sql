-- 1. Metadata + bookkeeping on chunks
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS doc_created_time timestamptz,
  ADD COLUMN IF NOT EXISTS doc_modified_time timestamptz,
  ADD COLUMN IF NOT EXISTS folder_path text,
  ADD COLUMN IF NOT EXISTS heading text,
  ADD COLUMN IF NOT EXISTS chunk_size integer,
  ADD COLUMN IF NOT EXISTS chunk_overlap integer,
  ADD COLUMN IF NOT EXISTS metadata_version integer NOT NULL DEFAULT 1;

-- Generated full-text vector over title + heading + content
ALTER TABLE public.document_chunks
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(heading, '') || ' ' || coalesce(content, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS document_chunks_content_tsv_idx
  ON public.document_chunks USING gin (content_tsv);

-- 2. Bookkeeping on the document index
ALTER TABLE public.document_index
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS doc_created_time timestamptz,
  ADD COLUMN IF NOT EXISTS folder_path text,
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS chunk_size integer,
  ADD COLUMN IF NOT EXISTS chunk_overlap integer,
  ADD COLUMN IF NOT EXISTS metadata_version integer NOT NULL DEFAULT 1;

-- 3. Retrieval + generation tuning preferences
ALTER TABLE public.user_ai_preferences
  ADD COLUMN IF NOT EXISTS temperature numeric NOT NULL DEFAULT 0.3,
  ADD COLUMN IF NOT EXISTS max_output_tokens integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS retrieval_top_k integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS passages_to_model integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS min_similarity numeric NOT NULL DEFAULT 0.15,
  ADD COLUMN IF NOT EXISTS max_passages_per_doc integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retrieval_mode text NOT NULL DEFAULT 'hybrid',
  ADD COLUMN IF NOT EXISTS debug_retrieval boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_ai_preferences
  DROP CONSTRAINT IF EXISTS user_ai_preferences_retrieval_mode_check;
ALTER TABLE public.user_ai_preferences
  ADD CONSTRAINT user_ai_preferences_retrieval_mode_check
  CHECK (retrieval_mode IN ('vector', 'hybrid', 'keyword'));

-- 4. Hybrid retrieval: vector + keyword fused with Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 20,
  p_source_type text DEFAULT NULL,
  p_min_similarity double precision DEFAULT 0,
  p_vector_weight double precision DEFAULT 1.0,
  p_keyword_weight double precision DEFAULT 1.0
)
RETURNS TABLE(
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
  doc_modified_time timestamptz,
  similarity double precision,
  keyword_score double precision,
  vector_rank integer,
  keyword_rank integer,
  fused_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT websearch_to_tsquery('english', coalesce(query_text, '')) AS tsq
  ),
  vector_hits AS (
    SELECT
      c.id,
      1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity,
      row_number() OVER (
        ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
      )::int AS rnk
    FROM public.document_chunks c
    WHERE c.user_id = auth.uid()
      AND (p_source_type IS NULL OR c.source_type = p_source_type)
      AND p_vector_weight > 0
      AND 1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) >= p_min_similarity
    ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT greatest(match_count * 3, 30)
  ),
  keyword_hits AS (
    SELECT
      c.id,
      ts_rank_cd(c.content_tsv, q.tsq)::double precision AS score,
      row_number() OVER (ORDER BY ts_rank_cd(c.content_tsv, q.tsq) DESC)::int AS rnk
    FROM public.document_chunks c, q
    WHERE c.user_id = auth.uid()
      AND (p_source_type IS NULL OR c.source_type = p_source_type)
      AND p_keyword_weight > 0
      AND q.tsq IS NOT NULL
      AND c.content_tsv @@ q.tsq
    ORDER BY ts_rank_cd(c.content_tsv, q.tsq) DESC
    LIMIT greatest(match_count * 3, 30)
  ),
  fused AS (
    SELECT
      coalesce(v.id, k.id) AS id,
      v.similarity,
      k.score AS keyword_score,
      v.rnk AS vector_rank,
      k.rnk AS keyword_rank,
      coalesce(p_vector_weight / (60 + v.rnk), 0)
        + coalesce(p_keyword_weight / (60 + k.rnk), 0) AS fused_score
    FROM vector_hits v
    FULL OUTER JOIN keyword_hits k ON k.id = v.id
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
    coalesce(f.similarity, 1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072))) AS similarity,
    coalesce(f.keyword_score, 0) AS keyword_score,
    f.vector_rank,
    f.keyword_rank,
    f.fused_score
  FROM fused f
  JOIN public.document_chunks c ON c.id = f.id
  ORDER BY f.fused_score DESC
  LIMIT match_count;
$function$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks_hybrid(vector, text, integer, text, double precision, double precision, double precision) TO authenticated;
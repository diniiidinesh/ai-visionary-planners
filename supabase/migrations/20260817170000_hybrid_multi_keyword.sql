-- Hybrid retrieval accepting MULTIPLE keyword queries.
--
-- Why: `websearch_to_tsquery` ANDs every term, so feeding it a full
-- natural-language question means a chunk must contain every word to match —
-- in practice almost nothing does, and the keyword channel contributes nothing
-- to the fusion. The vector channel wants a full sentence (more semantic
-- signal); the keyword channel wants a few sharp terms. This variant lets the
-- caller supply each in the shape it actually wants.
--
-- Each keyword variation is ranked independently, then a chunk's keyword rank
-- is its BEST rank across variations — so matching one variation strongly beats
-- matching several weakly, and adding variations can only help a chunk's score.
CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid_multi(
  query_embedding vector,
  query_texts text[],
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
    SELECT t.ord, websearch_to_tsquery('english', t.qt) AS tsq
    FROM unnest(coalesce(query_texts, ARRAY[]::text[])) WITH ORDINALITY AS t(qt, ord)
    WHERE coalesce(t.qt, '') <> ''
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
  -- Rank every chunk separately within each keyword variation.
  keyword_ranked AS (
    SELECT
      c.id,
      ts_rank_cd(c.content_tsv, q.tsq)::double precision AS score,
      row_number() OVER (
        PARTITION BY q.ord ORDER BY ts_rank_cd(c.content_tsv, q.tsq) DESC
      )::int AS rnk
    FROM q
    JOIN public.document_chunks c ON c.content_tsv @@ q.tsq
    WHERE c.user_id = auth.uid()
      AND (p_source_type IS NULL OR c.source_type = p_source_type)
      AND p_keyword_weight > 0
  ),
  -- Collapse to one row per chunk: best rank and best score across variations.
  keyword_hits AS (
    SELECT kr.id, max(kr.score) AS score, min(kr.rnk)::int AS rnk
    FROM keyword_ranked kr
    WHERE kr.rnk <= greatest(match_count * 3, 30)
    GROUP BY kr.id
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

REVOKE EXECUTE ON FUNCTION public.match_document_chunks_hybrid_multi(vector, text[], integer, text, double precision, double precision, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_document_chunks_hybrid_multi(vector, text[], integer, text, double precision, double precision, double precision) TO authenticated;

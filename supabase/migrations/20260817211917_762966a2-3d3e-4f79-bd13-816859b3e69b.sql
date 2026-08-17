CREATE OR REPLACE FUNCTION public.match_document_chunks_hybrid_space(
  query_embedding_openai vector,
  query_embedding_voyage vector,
  p_embedding_space text,
  query_texts text[],
  match_count integer,
  p_source_type text DEFAULT 'google_drive'::text,
  p_min_similarity double precision DEFAULT 0.15,
  p_vector_weight double precision DEFAULT 1.0,
  p_keyword_weight double precision DEFAULT 1.0
)
RETURNS TABLE(id uuid, source_type text, source_id text, title text, full_url text, mime_type text, chunk_index integer, content text, heading text, author text, doc_modified_time timestamp with time zone, similarity double precision, keyword_score double precision, vector_rank integer, keyword_rank integer, fused_score double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH voyage_hits AS (
    SELECT c.id, 1 - (c.embedding_voyage <=> query_embedding_voyage) AS sim
    FROM public.document_chunks c
    WHERE p_embedding_space = 'voyage'
      AND p_vector_weight > 0
      AND c.user_id = auth.uid()
      AND c.source_type = p_source_type
      AND c.embedding_voyage IS NOT NULL
    ORDER BY c.embedding_voyage <=> query_embedding_voyage
    LIMIT match_count * 3
  ),
  openai_hits AS (
    SELECT c.id, 1 - (c.embedding::halfvec(3072) <=> query_embedding_openai::halfvec(3072)) AS sim
    FROM public.document_chunks c
    WHERE p_embedding_space <> 'voyage'
      AND p_vector_weight > 0
      AND c.user_id = auth.uid()
      AND c.source_type = p_source_type
    ORDER BY c.embedding::halfvec(3072) <=> query_embedding_openai::halfvec(3072)
    LIMIT match_count * 3
  ),
  vector_hits AS (
    SELECT * FROM voyage_hits
    UNION ALL
    SELECT * FROM openai_hits
  ),
  vector_ranked AS (
    SELECT id, sim, ROW_NUMBER() OVER (ORDER BY sim DESC)::int AS v_rank
    FROM vector_hits
    WHERE sim >= p_min_similarity
  ),
  keyword_hits AS (
    SELECT c.id,
           MAX(ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', q)))::double precision AS kscore
    FROM public.document_chunks c
    CROSS JOIN unnest(coalesce(query_texts, ARRAY[]::text[])) AS q
    WHERE p_keyword_weight > 0
      AND c.user_id = auth.uid()
      AND c.source_type = p_source_type
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
    SELECT COALESCE(v.id, k.id) AS id, v.sim, k.kscore, v.v_rank, k.k_rank,
           COALESCE(p_vector_weight / (60 + v.v_rank), 0) + COALESCE(p_keyword_weight / (60 + k.k_rank), 0) AS fscore
    FROM vector_ranked v
    FULL OUTER JOIN keyword_ranked k ON k.id = v.id
  )
  SELECT c.id, c.source_type, c.source_id, c.title, c.full_url, c.mime_type, c.chunk_index, c.content,
         c.heading, c.author, c.doc_modified_time,
         COALESCE(f.sim, 0)::double precision, COALESCE(f.kscore, 0)::double precision,
         f.v_rank, f.k_rank, f.fscore
  FROM fused f
  JOIN public.document_chunks c ON c.id = f.id
  ORDER BY f.fscore DESC
  LIMIT match_count;
$function$;
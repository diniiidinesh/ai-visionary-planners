CREATE OR REPLACE FUNCTION public.embedding_coverage_by_document()
RETURNS TABLE(
  source_id text,
  total_chunks bigint,
  openai_chunks bigint,
  voyage_chunks bigint,
  openai_model text,
  voyage_model text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.source_id,
    count(*) AS total_chunks,
    count(*) FILTER (WHERE c.embedding IS NOT NULL) AS openai_chunks,
    count(*) FILTER (WHERE c.embedding_voyage IS NOT NULL) AS voyage_chunks,
    max(c.embedding_model) AS openai_model,
    max(c.embedding_voyage_model) AS voyage_model
  FROM public.document_chunks c
  WHERE c.user_id = auth.uid()
  GROUP BY c.source_id
$$;

GRANT EXECUTE ON FUNCTION public.embedding_coverage_by_document() TO authenticated;
CREATE OR REPLACE FUNCTION public.index_health()
RETURNS TABLE(
  ingest_status text,
  documents bigint,
  chunks bigint,
  oldest_update timestamp with time zone,
  newest_update timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    d.ingest_status,
    count(*)::bigint AS documents,
    coalesce(sum(d.chunk_count), 0)::bigint AS chunks,
    min(d.updated_at) AS oldest_update,
    max(d.updated_at) AS newest_update
  FROM public.document_index d
  WHERE d.user_id = auth.uid()
  GROUP BY d.ingest_status
  ORDER BY count(*) DESC
$$;

GRANT EXECUTE ON FUNCTION public.index_health() TO authenticated;
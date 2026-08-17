create extension if not exists vector;

CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'google_drive',
  source_id text NOT NULL,
  title text NOT NULL,
  full_url text,
  mime_type text,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text,
  embedding vector(3072) NOT NULL,
  embedding_model text NOT NULL,
  char_count integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id, chunk_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;

ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own chunks" ON public.document_chunks
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own chunks" ON public.document_chunks
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own chunks" ON public.document_chunks
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own chunks" ON public.document_chunks
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX document_chunks_embedding_idx
  ON public.document_chunks USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
CREATE INDEX document_chunks_user_source_idx
  ON public.document_chunks (user_id, source_type, source_id);

CREATE TRIGGER update_document_chunks_updated_at
  BEFORE UPDATE ON public.document_chunks
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.document_index
  ADD COLUMN IF NOT EXISTS source_modified_time timestamptz,
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ingest_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS ingest_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_index_user_source_unique'
  ) THEN
    ALTER TABLE public.document_index
      ADD CONSTRAINT document_index_user_source_unique UNIQUE (user_id, source_type, source_id);
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can delete own documents" ON public.document_index;
CREATE POLICY "Users can delete own documents" ON public.document_index
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.match_document_chunks(
  query_embedding vector(3072),
  match_count integer DEFAULT 12,
  p_source_type text DEFAULT NULL,
  p_min_similarity double precision DEFAULT 0
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
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id,
    c.source_type,
    c.source_id,
    c.title,
    c.full_url,
    c.mime_type,
    c.chunk_index,
    c.content,
    1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM public.document_chunks c
  WHERE c.user_id = auth.uid()
    AND (p_source_type IS NULL OR c.source_type = p_source_type)
    AND 1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) >= p_min_similarity
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_document_chunks(vector, integer, text, double precision) TO authenticated;
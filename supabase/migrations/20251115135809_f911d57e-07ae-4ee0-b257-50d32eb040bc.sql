-- Phase 1: Create tables for AI-powered search

-- Table to store user search queries and AI-processed variations
CREATE TABLE public.search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_query TEXT NOT NULL,
  processed_queries JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Table to cache document content from various sources
CREATE TABLE public.document_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content_snippet TEXT,
  full_url TEXT,
  metadata JSONB,
  last_synced TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, source_type, source_id)
);

-- Table to store AI-generated summaries and source references
CREATE TABLE public.search_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  search_query_id UUID NOT NULL REFERENCES public.search_queries(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ai_summary TEXT NOT NULL,
  sources_used JSONB,
  model_used TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies for search_queries
CREATE POLICY "Users can view own queries"
  ON public.search_queries
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queries"
  ON public.search_queries
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for document_index
CREATE POLICY "Users can view own documents"
  ON public.document_index
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents"
  ON public.document_index
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents"
  ON public.document_index
  FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for search_results
CREATE POLICY "Users can view own results"
  ON public.search_results
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own results"
  ON public.search_results
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX idx_search_queries_user_id ON public.search_queries(user_id);
CREATE INDEX idx_search_queries_created_at ON public.search_queries(created_at DESC);
CREATE INDEX idx_document_index_user_id ON public.document_index(user_id);
CREATE INDEX idx_document_index_source ON public.document_index(user_id, source_type, source_id);
CREATE INDEX idx_search_results_user_id ON public.search_results(user_id);
CREATE INDEX idx_search_results_query_id ON public.search_results(search_query_id);
# RAG over Google Drive content

Yes — your instinct is right. The current flow re-searches Drive on every question, pulls the first 5,000 characters of ~12 files, and stuffs them into the prompt. That misses answers buried deep in long documents and re-downloads the same files repeatedly. A proper RAG pipeline (extract -> chunk -> embed -> vector search -> answer) fixes both.

## Target architecture

```text
Drive files ->  ingest (extract text)
            ->  chunk (~1000 chars, 150 overlap)
            ->  embed each chunk
            ->  store vectors in the database (pgvector)

question    ->  embed question
            ->  vector similarity search (per-user, top ~20)
            ->  optional keyword blend + rerank -> top ~8 chunks
            ->  answer with citations back to the source file
```

## What gets built

1. **Vector storage**
   - Enable the `vector` extension.
   - New table `document_chunks`: user, source type/id, file title + link, chunk index, chunk text, embedding vector, token count, content hash, timestamps.
   - Owner-only access rules (each user sees only their own chunks) plus the required table grants.
   - Similarity index (HNSW) and a security-definer `match_document_chunks(query_embedding, match_count, filters)` function scoped to the caller.
   - Extend `document_index` with sync bookkeeping (last modified seen, chunk count, ingest status).

2. **Ingestion function** (`ingest-drive-documents`)
   - Lists the user's Drive files (Docs/Sheets/Slides/PDF/text), skipping files whose `modifiedTime` and content hash are unchanged.
   - Exports each file to plain text (same export endpoints already used in `multi-source-search`).
   - Chunks with overlap on paragraph boundaries, embeds in batches, upserts chunks, deletes stale chunks for re-ingested files.
   - Reuses the existing OAuth token retrieval + refresh logic, moved into a shared helper so search and ingest don't duplicate it.
   - Runs in batches with a resumable cursor so large drives don't hit the function timeout; can be invoked for a full sync or an incremental sync.

3. **Embeddings provider**
   - Add an `embed()` path alongside the existing chat providers, defaulting to the Lovable AI gateway (`google/text-embedding-004`, 768 dims), with the OpenAI provider as the user-key alternative. Same `AIConfigManager` pattern, new `embedding` purpose in `user_ai_preferences`.
   - Dimension is fixed at the column level, so switching providers requires re-embedding — the plan stores the model name per chunk to detect that.

4. **Retrieval + answer** (`rag-answer`)
   - Embeds the question, calls `match_document_chunks`, blends in the existing Drive keyword hits for recall, dedupes by file, and passes the top chunks to the summarize prompt with `[n]` citations mapped to Drive links.
   - Falls back to the current live-search path when the user has no chunks indexed yet.
   - Logs usage into `ai_usage_logs` as today.

5. **UI**
   - Connect page: "Index my Drive" action, progress (files processed / chunks stored), last sync time, re-sync button.
   - Search page: answers cite indexed chunks with expandable source snippets; a notice when indexing hasn't run yet.

## Sequencing

1. Migration: vector extension, `document_chunks`, match function, policies, grants.
2. Shared Drive-token helper + embeddings provider.
3. `ingest-drive-documents` with incremental sync.
4. `rag-answer` retrieval and prompt with citations.
5. UI for indexing status and cited answers.

## Notes and trade-offs

- Cost/time: initial indexing is the expensive step (one embedding call per chunk); after that queries are cheap. Incremental sync keeps ongoing cost near zero.
- Scale: pgvector with HNSW is fine well into the hundreds of thousands of chunks — no external vector DB needed.
- PDFs: scanned PDFs have no extractable text; those files are recorded as skipped rather than silently empty.
- Permissions: each test user's chunks are stored under their own user id and are only readable by them, so Drive sharing boundaries are not crossed.

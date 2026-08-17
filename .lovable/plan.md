# RAG tuning, hybrid search, and metadata upgrades

Five buildable items from the follow-up questions. They are independent — approve all, or tell me which to drop.

## 1. Retrieval tuning console (temperature and friends)

Today temperature is hardcoded (0.3 in the RAG answer path, 0.3 in search, 0.4 in summarize) and retrieval knobs are constants in the function.

Add a "Retrieval & generation" card on the AI Settings page with:
- Temperature (0 - 1 slider)
- Max output tokens
- Candidates retrieved (top-k, 5 - 40)
- Passages sent to the model (3 - 15)
- Minimum similarity floor (0 - 0.5)
- Max passages per document (1 - 5)

Values persist per user in `user_ai_preferences` (new columns) and are read by the answer function instead of the constants. A "Reset to defaults" button and an inline note explaining what each knob trades off.

Also: a debug toggle that shows, under each answer, the retrieved candidates with their similarity scores and which ones made the cut — so you can see why an answer was weak.

## 2. Hybrid search (vector + keyword)

Currently retrieval is pure cosine similarity. Add lexical matching and fuse the two.

**Database**
- Add a generated `tsvector` column on `document_chunks` over the chunk text (English config), plus a GIN index on it.
- New function `match_document_chunks_hybrid(query_embedding, query_text, match_count, ...)` that:
  - runs the vector search, taking the top N by cosine
  - runs a full-text search (`websearch_to_tsquery`) taking the top N by `ts_rank_cd`
  - fuses the two ranked lists with Reciprocal Rank Fusion: each chunk scores `sum over lists of 1 / (60 + rank_in_that_list)`. RRF is used because cosine similarity and text-rank scores are on incomparable scales — ranks are comparable, raw scores are not.
  - returns the fused top-k with both component ranks exposed for debugging.

**Function**
- The answer function calls the hybrid variant, passing the raw question as the keyword side.
- A weight setting (vector-only / balanced / keyword-leaning) surfaced in the tuning console from item 1, implemented as a multiplier on each list's RRF contribution.

**Why RRF over weighted score blending:** blending requires normalising two distributions that drift per query; RRF needs no calibration and is the standard choice in production hybrid systems. Trade-off is that it discards score magnitude, so a chunk that is overwhelmingly the best vector match only gets rank-1 credit.

## 3. Richer chunk metadata

Capture from the Drive API and store on both the index and chunk rows: author (`owners`, `lastModifyingUser`), `createdTime`, `modifiedTime`, and folder path. Prefix each chunk's embedded text with its document title and nearest heading so the vector itself carries context ("Q3 Revenue Plan > EMEA Outlook: ...").

Surface author and date in the passage browser and in answer citations. Requires a re-index to take effect (see item 5).

## 4. Table-aware extraction

Word and PowerPoint tables and spreadsheet rows are currently flattened into loose text, losing row/column structure. Convert them to markdown pipe-tables during extraction so relationships survive into the chunk. Keep whole small tables inside one chunk rather than splitting mid-table, and repeat the header row when a large table must span chunks.

This addresses the "tables get missed" problem far more cheaply than multimodal embeddings, which remain the right answer only for scanned pages and charts.

## 5. Re-index safety and freshness

- Store the active embedding model per chunk (already done) and compare it at query time; if the configured model differs from what is indexed, show a clear "re-index required" banner instead of returning wrong matches.
- Add a "chunk settings changed" detector: chunk size, overlap, and metadata-prefix version are recorded on the index row, so changing them flags affected documents as stale.
- Add a "Sync now" that only touches changed files (already the behaviour) plus an optional daily background sync toggle, so Drive edits get picked up without a manual click.

## Technical notes

- Embeddings stay on `openai/text-embedding-3-large` (3072 dims, halfvec-indexed HNSW). Moving them to your own OpenAI key is a separate one-file change plus a full re-index — say the word and I will add it as item 6.
- New migration touches `document_chunks` (tsvector column, GIN index, metadata columns) and `user_ai_preferences` (tuning columns), with grants and owner-only policies matching the existing tables.
- Items 3 and 4 change chunk content, so both require a full re-index of the 320 existing chunks (roughly a minute, sub-cent cost).

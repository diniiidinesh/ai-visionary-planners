# How this RAG system works — the full architecture

A plain-English, end-to-end walkthrough of every database object, edge function, and shared module in this project, and how a user's question flows from the Search box to a cited answer.

---

## The 30-second version

1. You connect Google Drive (OAuth) → the access token is encrypted and stored.
2. You click "Index my Drive" → an edge function downloads your files, extracts text, splits it into ~1,200-char chunks, embeds each chunk with OpenAI's embedding model, and stores the vectors in a Postgres table.
3. You ask a question → another edge function embeds your question, runs a **hybrid** search (vector similarity + full-text keyword matching), re-ranks the results with a cross-encoder, and feeds the best passages to a chat model that writes a cited answer.
4. Everything is scoped to you via Row-Level Security — no other user can see your chunks, documents, tokens, or conversation history.

---

## Layer 1 — the database (Postgres on Supabase)

### Tables

| Table | What it holds | Who can see it |
|---|---|---|
| `oauth_connections` | Your Google Drive connection: a pointer to the encrypted token in the vault, the token expiry, and `is_connected`. | Only you (RLS: `auth.uid() = user_id`) |
| `oauth_states` | Short-lived OAuth anti-CSRF tokens. Written and consumed by the OAuth flow; no user access. | None (no policies = locked) |
| `user_api_keys` | Your personal AI provider API keys (OpenAI, Google), stored as vault pointers. | Only you |
| `user_ai_preferences` | Your per-user settings: which AI provider/model for search vs. summarize, temperature, top-k, retrieval mode, debug toggle, auto-sync toggle. | Only you |
| `document_index` | One row per Drive file: title, URL, content hash, chunk count, ingest status (indexed/failed/skipped), author, folder path, modified time, and the pipeline settings used (embedding model, chunk size, overlap, metadata version). | Only you |
| `document_chunks` | One row per chunk: the text, its 3,072-dim embedding vector, heading, author, dates, folder path, and a `tsvector` column for keyword search. | Only you |
| `search_queries` | The questions you've asked (original + processed). | Only you |
| `search_results` | The AI summary and sources for each query. | Only you |
| `conversations` / `conversation_messages` | Multi-turn chat threads for follow-up questions. | Only you |
| `ai_usage_logs` | Token counts, response time, and provider/model for every AI call — for cost tracking. | Only you (insert by system) |

### Row-Level Security (RLS)

Every user-facing table has RLS enabled with policies that check `auth.uid() = user_id`. This is enforced at the database level — even if a bug in the app sent the wrong user ID, Postgres would refuse to return rows that don't belong to you. The edge functions pass your JWT through, so `auth.uid()` resolves to you.

### The `vector` extension and `halfvec`

- `document_chunks.embedding` is a `vector(3072)` column — a 3,072-dimensional float array from OpenAI's `text-embedding-3-large` model.
- 3,072 dimensions is too many for standard `vector` + HNSW indexing (the limit is 2,000). So the code casts to `halfvec(3072)` — 16-bit floats — which supports up to 4,000 dimensions under HNSW and halves storage. The cast is done inside the SQL functions (`c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)`).
- The `<=>` operator is **cosine distance**. The functions compute `1 - distance` to get **cosine similarity** (0 to 1).

### The `tsvector` column (keyword search)

- `document_chunks.content_tsv` is a generated `tsvector` over the chunk text (English config).
- A GIN index on it enables fast full-text matching via `websearch_to_tsquery`.
- `ts_rank_cd` scores how well a chunk matches a keyword query.

### Database functions (the retrieval engine)

| Function | Purpose |
|---|---|
| `match_document_chunks` | Pure vector search. Returns top-k chunks by cosine similarity. The original, simplest path. |
| `match_document_chunks_hybrid` | Vector + keyword (single query). Fuses the two ranked lists with Reciprocal Rank Fusion (RRF). |
| `match_document_chunks_hybrid_multi` | The current path. Same as hybrid but accepts **multiple** keyword queries — because `websearch_to_tsquery` ANDs every term, a full question rarely matches. The query planner produces 2–4 short keyword variations; each is ranked independently and a chunk's best rank across variations is used. |
| `get_oauth_tokens` | SECURITY DEFINER. Reads your encrypted Drive tokens from the vault. |
| `store_encrypted_oauth_tokens` | SECURITY DEFINER. Stores/refreshes Drive tokens in the vault. |
| `get_user_api_key` | SECURITY DEFINER. Reads your decrypted API key for a provider. |
| `store_user_api_key` | SECURITY DEFINER. Stores your API key in the vault. |
| `handle_updated_at` | Trigger function that sets `updated_at = now()` on row updates. |
| `touch_conversation_updated_at` | Trigger that bumps a conversation's `updated_at` when a message is added. |

### The vault

API keys and OAuth tokens are never stored in plaintext. They live in Supabase's **vault** — an encrypted secrets store. The `user_api_keys` and `oauth_connections` tables hold only a `vault_secret_id` pointer. The SECURITY DEFINER functions decrypt on demand, and only for the requesting user.

### Triggers

- `update_*_updated_at` — on `document_chunks`, `oauth_connections`, `user_ai_preferences`, `user_api_keys`, `conversations`: auto-maintains `updated_at`.
- `conversation_messages_touch_parent` — after inserting a message, bumps the parent conversation's `updated_at` so threads sort by recent activity.

---

## Layer 2 — edge functions (Deno, running on Supabase)

Edge functions are serverless TypeScript (Deno) that run close to the database. They are the **only** place where secrets (API keys, vault access, the Lovable gateway key) are used — the browser never sees them.

### `google-drive-oauth-init` + `google-drive-oauth-callback`

The two-step OAuth handshake:
1. **init**: generates a CSRF `state`, stores it in `oauth_states`, and redirects you to Google's consent screen with the Drive scope.
2. **callback**: Google redirects back with a code; the function exchanges it for access + refresh tokens, stores them encrypted via `store_encrypted_oauth_tokens`, and redirects to the app.

### `store-oauth-token`

Alternative token-storage path used by the popup flow.

### `ingest-drive-documents` — the indexing pipeline

This is the "Index my Drive" button. Per batch (3 files at a time):

1. Gets your Drive access token (refreshing if expired).
2. Lists files matching indexable MIME types (Google Docs/Sheets/Slides, PDF, text, CSV, .docx/.xlsx/.pptx).
3. For each file:
   - Fetches metadata (author, created/modified time, folder path).
   - **Skips unchanged files** — compares `modifiedTime` and a SHA-256 `content_hash` to the stored row. Also skips if pipeline settings (chunk size, overlap, metadata version, embedding model) haven't changed.
   - Downloads the file. Routes by type:
     - Google Docs/Slides → exported as plain text.
     - Google Sheets/CSV → converted to a **markdown table** (via `csv.ts`) so columns stay meaningful.
     - PDF → text extracted via `unpdf`.
     - .docx/.xlsx/.pptx → decompressed (ZIP) and text extracted from the XML (via `ooxml.ts`), with tables converted to markdown.
   - **Chunks** the text (~1,200 chars, 200 overlap, heading-aware, table-preserving).
   - **Embeds** each chunk via the Lovable AI gateway (`openai/text-embedding-3-large`, 3,072 dims). The embedded text is prefixed with the document title and heading so the vector carries context.
   - Deletes old chunks for this file and inserts the new ones.
   - Records status in `document_index`.
4. Returns a `nextPageToken` so the frontend can paginate through all files.

If AI credits are exhausted (402) or rate-limited (429), it stops the whole batch immediately.

### `rag-answer` — the answer pipeline

This is the heart of the system. When you ask a question:

1. **Auth**: validates your JWT, loads your `user_ai_preferences` (temperature, top-k, retrieval mode, etc.).
2. **Staleness check**: counts documents indexed with a different embedding model or chunk settings — if any, returns a `staleDocuments` count so the UI can warn you.
3. **Query planning** (one model call): turns your question into:
   - A **standalone question** (resolves "that one" → "Q3 Revenue Plan") for the embedding.
   - 2–4 **short keyword queries** for the full-text channel.
4. **Embedding**: embeds the standalone question via the gateway.
5. **Hybrid retrieval**: calls `match_document_chunks_hybrid_multi` with the embedding + keyword queries. Returns chunks with `similarity`, `keyword_score`, `vector_rank`, `keyword_rank`, `fused_score`.
6. **Re-ranking** (optional): if `VOYAGE_API_KEY` is set, sends the query + candidate passages to Voyage's `rerank-2.5` cross-encoder, which re-scores them by true query-passage relevance. Falls back to hybrid order if the key isn't set.
7. **Per-document capping**: limits passages per document (default 3) so one file can't crowd out others.
8. **Answer generation**: builds a context block from the selected passages (with title, heading, author, date, URL, relevance), sends it + your conversation history to the chat model with instructions to cite every claim with bracket numbers and end with a confidence level.
9. **Persistence**: saves the answer to `search_results`, logs token usage to `ai_usage_logs`.
10. Returns: the summary, sources, excerpts (with similarity scores), and an optional debug block showing every candidate's ranks and whether it made the cut.

### `ai-search` / `ai-summarize` / `multi-source-search`

- **ai-search**: live Drive search (the non-indexed fallback) — uses Google Drive API directly when nothing is indexed.
- **ai-summarize**: summarizes a single document or search result.
- **multi-source-search**: searches across multiple connected sources.

### `save-api-key`

Stores your personal AI provider API key (OpenAI/Google) encrypted in the vault via `store_user_api_key`.

### `update-ai-preferences`

Saves your tuning console settings (temperature, top-k, retrieval mode, etc.) to `user_ai_preferences`.

### `ai-provider-status`

Reports which providers/keys are configured (without exposing the keys) — used by the AI Settings page to show status badges.

---

## Layer 3 — shared modules (`_shared/`)

### AI provider abstraction (`_shared/ai/`)

- **`types.ts`**: standard `AIRequest` / `AIResponse` / `AIProviderConfig` interfaces. Every provider speaks this shape.
- **`base-provider.ts`**: abstract `AIProvider` base class. Provides `buildMessages`, `parseJSONResponse`, `estimateCost`.
- **`openai-provider.ts`** / **`google-provider.ts`** / **`lovable-provider.ts`**: concrete implementations that call OpenAI / Gemini / the Lovable gateway respectively.
- **`provider-factory.ts`**: `AIProviderFactory.create(config)` returns the right provider. Also lists supported models per provider.
- **`config-manager.ts`**: `AIConfigManager` — reads your `user_ai_preferences` to determine which provider+model+key to use for a given purpose (`search` or `summarize`). Falls back to the Lovable gateway key. This is why you can use your own OpenAI key for summarization while embeddings use the Lovable gateway.

### RAG pipeline (`_shared/rag/`)

- **`chunker.ts`**: heading-aware, table-preserving chunking. Constants: `CHUNK_SIZE=1200`, `CHUNK_OVERLAP=200`, `METADATA_VERSION=2`. Also `embeddingInput()` (prefixes title+heading) and `hashContent()` (SHA-256 for change detection).
- **`embeddings.ts`**: batched embedding via the Lovable gateway. Model: `openai/text-embedding-3-large`, 3,072 dims, batches of 100.
- **`reranker.ts`**: Voyage AI `rerank-2.5` cross-encoder. No-ops (returns null) if `VOYAGE_API_KEY` isn't set.
- **`query-planner.ts`**: one model call to produce a standalone question + keyword variations.
- **`ooxml.ts`**: extracts text from .docx/.xlsx/.pptx by unzipping (fflate) and parsing the XML, converting tables to markdown.
- **`csv.ts`**: converts CSV to a markdown pipe-table.
- **`token.ts`** (`_shared/drive/`): retrieves and refreshes the Drive access token; defines indexable MIME types and content URLs.

---

## Layer 4 — the data flow (question → answer)

```
User asks: "What was Q3 revenue by region?"
                    │
                    ▼
        ┌───────────────────────┐
        │   rag-answer (edge fn) │
        │   1. Validate JWT      │
        │   2. Load preferences  │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  query-planner (1 AI  │  → standaloneQuestion + keywordQueries[]
        │  call)                │     ["Q3 revenue region", "revenue by region", ...]
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  embedQuery (gateway) │  → 3072-dim vector
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────────────────────────┐
        │  match_document_chunks_hybrid_multi (RPC) │
        │  • vector: cosine top-N                   │
        │  • keyword: ts_rank_cd top-N (per variation)│
        │  • fuse via RRF → ranked chunks            │
        └─────────────────┬─────────────────────────┘
                          │
                          ▼
        ┌───────────────────────┐
        │  rerank (Voyage, if    │  → re-scored by true relevance
        │  VOYAGE_API_KEY set)   │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Cap per-document      │  → max 3 passages per file
        │  → top passagesToModel │  → top 10 to the model
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  chat model (your      │  → cited answer with confidence level
        │  configured provider)  │
        └───────────┬───────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │  Save to search_results│
        │  Log to ai_usage_logs  │
        │  Return summary +      │
        │  sources + excerpts    │
        └───────────────────────┘
```

---

## Key design decisions, summarized

1. **Why edge functions**: secrets never reach the browser. The Lovable gateway key, your OpenAI key, your Drive token — all stay server-side.
2. **Why halfvec(3072)**: standard `vector` caps at 2,000 dims for HNSW. OpenAI's 3-large outputs 3,072. `halfvec` halves storage and lifts the limit to 4,000.
3. **Why RRF for fusion**: cosine similarity (0–1) and `ts_rank_cd` (unbounded) are on incomparable scales. RRF uses only the *rank* in each list, which is always comparable, and needs no calibration.
4. **Why multi-keyword**: `websearch_to_tsquery` ANDs every term. A full question → almost nothing matches. Short, distinct keyword variations → much better recall from the keyword channel.
5. **Why a cross-encoder reranker**: embeddings score query and passage *separately*. A cross-encoder reads them *together*, catching relevance that cosine misses. It's a cheap second stage on a small candidate set.
6. **Why metadata versioning**: when chunking or metadata shape changes, old chunks are flagged as stale without deleting them — the UI shows a "re-index required" banner.
7. **Why per-user preferences**: temperature, top-k, retrieval mode, and passages-to-model are all tunable per user, stored in `user_ai_preferences`, and respected by the answer function.

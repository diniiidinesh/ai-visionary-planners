# Word/Office support, passage browser, and a written RAG deep-dive

## 1. Word/Office files are genuinely being skipped (confirmed)

The ingestion job only asks Google Drive for these file types: Google Docs, Google Sheets, Google Slides, PDF, plain text, markdown, CSV. Uploaded Microsoft files (.docx, .xlsx, .pptx) are not in that list, so they are never even listed, let alone read. Your current index holds 11 PDFs, 1 text file and 1 Google Doc — no Word files at all. That is why the answer had nothing from them.

Fix:
- Add `.docx`, `.xlsx`, `.pptx` to the list of file types requested from Drive.
- Read them via Drive's own conversion export (Drive can convert an uploaded Word file to plain text, a spreadsheet to CSV, a deck to text) — no new parsing library needed, no extra memory cost, and it uses the same code path already proven for Google-native files.
- Add legacy `.doc`/`.xls`/`.ppt` as explicitly "unsupported" so they are recorded as skipped with a clear reason instead of silently missing.
- After the change: run a full re-index so the Word files get picked up.

## 2. Browse indexed passages (the "yes please" item)

New section on the Connect page under the index panel:
- List of indexed documents: title, file type, chunk count, last synced, status (indexed / skipped / failed with the reason).
- Click a document to expand its passages in order: passage number, character count, and the full chunk text.
- Search box to filter passages by keyword across your index.
- Skipped/failed files are visible too, so "why isn't this document in my answers?" is answerable in one click.

Read-only, uses the existing owner-only access rules — you only ever see your own passages.

## 3. Written end-to-end explanation

A `docs/RAG_EXPLAINED.md` written for a non-CS engineer/PM, covering the whole pipeline and every decision with its trade-off:

- What an embedding actually is (text to a list of numbers where distance means meaning), why we can't just keyword-search.
- Why 3072 dimensions, and what dimensionality buys and costs.
- Why OpenAI `text-embedding-3-large` today: the intended default (Google `gemini-embedding-2`) returned "model unavailable" on this workspace, and the OpenAI model is the strongest available alternative at the same 3072 dims. Comparison table of the realistic options (OpenAI small/large, Google Gemini embedding, open-source e.g. BGE/E5) on quality, cost, dimension, hosting, and lock-in.
- The hard constraint nobody warns you about: vectors from different models are not comparable, so switching models means a full re-index. That is why the model name is stored on every chunk.
- Chunking: 1200/200 rationale, paragraph-first splitting, sentence fallback, overlap as insurance against splitting an answer in half.
- Retrieval: cosine similarity, why top-20 then trimmed to 10, the max-3-chunks-per-document rule, the 0.15 similarity floor.
- Indexing: what HNSW is in plain terms, why 3072-dim columns need the halfvec cast.
- Ingestion realities: incremental sync via modified-time + content hash, batch size 3 and the 15 MB cap (worker memory limits), PDF text extraction, scanned PDFs having no text.
- Answer generation: why the prompt forbids outside knowledge, how citations map back to files, the confidence marker.
- Cost model: what is paid once at index time vs per question.
- What to tune first if answers are weak, and how you'd measure that.

## Technical notes

- `supabase/functions/_shared/drive/token.ts`: extend `EXPORTABLE_MIME_TYPES` and `contentUrlFor` with the OOXML mime types mapped to Drive export endpoints; this also improves the live-search path for free.
- `supabase/functions/ingest-drive-documents/index.ts`: record `skipped_unsupported` for legacy binary Office formats.
- New `src/components/IndexedPassagesBrowser.tsx` reading `document_index` and `document_chunks` (never the embedding column), mounted in `src/pages/Connect.tsx`.
- No schema changes, no new secrets.

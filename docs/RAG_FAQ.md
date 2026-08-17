# RAG FAQ — answers to your 11 questions

Each answer explains the decision, the alternatives, and the technical constraint that forced it.
This is a companion to `RAG_EXPLAINED.md` (the end-to-end walkthrough); read that first if you
haven't.

---

## 1. What embedding-model options do we have, and why this one?

The decision space has three "meaningful slicers" — the things that actually distinguish one model
from another for a retrieval use case:

### Slicer A — Dimensions (how much information the vector can hold)
| Tier | Dims | What it means |
| --- | --- | --- |
| Small | 384–768 | Cheap, fast, but blurs fine distinctions. Good enough for simple FAQs. |
| Medium | 1024–1536 | The pragmatic middle. `text-embedding-3-small` lives here (1536). |
| Large | 3072 | Current top tier on hosted APIs. `text-embedding-3-large` and `gemini-embedding-2` live here. |

More dims = finer discrimination, but linearly more storage and search cost. At ~265 passages the
storage is negligible (~3 MB total), so there is no reason to economise on dimensions.

### Slicer B — Max input tokens (how long a passage you can embed in one call)
| Model | Max tokens |
| --- | --- |
| `text-embedding-3-large` / `3-small` | 8,192 |
| `gemini-embedding-2` | 2,048 |
| Open-source (BGE-M3) | 8,192 |

Our 1,200-char chunks are ~300 tokens, so every model here clears the bar. But a higher cap matters
if you ever want to embed larger windows (e.g. whole sections) without splitting.

### Slicer C — Quality / specialisation
- **Multilingual / multimodal:** `gemini-embedding-2` can embed images and audio, not just text.
- **English business-doc quality:** `text-embedding-3-large` is essentially the benchmark.
- **Data residency / no per-token cost:** self-hosted open-source (BGE-M3, E5, Nomic).

### Why `openai/text-embedding-3-large` specifically?
The intended default was `google/gemini-embedding-2` (same 3,072 dims, multimodal, slightly ahead on
multilingual benchmarks). It returned *model unavailable* on this workspace's AI gateway, so the
pipeline fell back to the strongest available alternative at the same dimensionality.

At this corpus size (hundreds, not millions, of passages) the *total* embedding bill is fractions of
a cent per full re-index. So the ranking of criteria is: **quality first, then convenience, cost
last.** That ranking inverts at millions of passages — at that scale `text-embedding-3-small`
(6× cheaper) or self-hosted open-source (no per-token fee) becomes the right call.

---

## 2. Did you use the API I gave you, or Lovable's embedded API?

Two different systems, two different answers — and this is the single most common source of
confusion, so it's worth being explicit:

| Job | Key used | Why |
| --- | --- | --- |
| **Embedding** (turning passages into vectors, at index time) | **Lovable AI Gateway** (`LOVABLE_API_KEY`) | Hardcoded in `_shared/rag/embeddings.ts`. No per-key setup; billed through Lovable credits. |
| **Summarisation / answer generation** (the chat model that writes the final answer) | **Your own configured provider key** via `AIConfigManager` (OpenAI, Anthropic, Google, or Lovable fallback) | You set this in **AI Settings**. It's stored encrypted in the vault. |

So: yes for the chat/answer model, no for embeddings. Embeddings always go through the Lovable
gateway today. Switching embeddings to your own key is a small code change in `embeddings.ts`
(point it at OpenAI's `/v1/embeddings` with your key), **but** — critically — it forces a full
re-index, because vectors from different keys/models are not comparable (see Q3).

There is no UI to swap the embedding key yet because swapping it silently would corrupt the index:
existing vectors were made by one model, new ones by another, and similarity search would return
nonsense. The safe path is: change the key → re-index everything → only then search.

---

## 3. Can I use different APIs for retrieval vs. summarisation? What are the complications?

You already **do** use different APIs for the two jobs — that's exactly the split in Q2. The
question is really *can I independently swap each side*, and the answer is: summarisation yes,
embedding no (without consequences).

The complications, in order of how badly they bite:

1. **Model-lock-in on the embedding side.** Vectors are coordinates in a model-specific space. An
   OpenAI vector and a Google vector are not comparable even at the same dimensionality — they're
   different coordinate systems. So the embedding model is the one component you cannot change
   without re-embedding the entire corpus. Every stored chunk records its `embedding_model` so the
   system can detect and refuse mixed-model searches rather than returning garbage.

2. **Dimensionality must match the index.** The HNSW index is built for a fixed dimension count
   (3,072 here). Switching to a 1,536-dim model means dropping the index, changing the column type,
   and rebuilding.

3. **Query-time embedding must match index-time embedding.** The user's question is embedded with
   the *same* model as the passages were. If you change the embedding model on the query path but
   not the index, every search silently breaks. This is why `rag-answer` imports `EMBEDDING_MODEL`
   from the same module the ingester uses — they cannot drift apart.

4. **Summarisation is decoupled and safe.** The chat model only sees text passages and writes
   prose. Swap OpenAI for Claude for Gemini freely — the retrieval results are unaffected. This is
   why the tuning console lets you change the summarisation model/provider at will but not the
   embedding model.

**Practical rule:** treat the embedding model as a one-way ratchet — pick it once, re-index if you
ever change it. Treat the chat model as a hot-swappable dial.

---

## 4. How do we track embedding history? What about changes to an existing file — automatic or manual?

### What's tracked
Two tables, both scoped by RLS to the owner:

- **`document_index`** — one row per file: `source_modified_time`, `content_hash` (SHA-256 of the
  extracted text), `last_synced`, `ingest_status`, `chunk_count`, plus the `embedding_model`,
  `chunk_size`, `chunk_overlap`, `metadata_version` it was indexed with.
- **`document_chunks`** — one row per passage: the text, the vector, `content_hash`, the
  `embedding_model`, and the chunking parameters used to make it.

### Change detection (the staleness logic)
A file is considered *stale* (needs re-indexing) when **any** of these differ from what's stored:
- Drive's `modifiedTime` changed, **or**
- The `content_hash` of the extracted text changed (the backstop — Drive bumps `modifiedTime` for
  trivial events like just opening a file), **or**
- The `embedding_model`, `chunk_size`, `chunk_overlap`, or `metadata_version` changed (i.e. *you*
  changed the chunking/embedding settings — every existing chunk is now from the old regime and
  must be remade).

### Automatic or manual?
- **Manual:** the default. You open the **Connect** page, see "X documents indexed with older
  settings" if anything is stale, and press **Re-index stale files**.
- **Automatic (opt-in):** there's a **"Daily auto-sync"** toggle on the Connect/Drive panel. When
  on, opening that page triggers a sync if more than 24 hours have passed since the last one. It's
  incremental — unchanged files are skipped, so the cost is proportional to what actually changed,
  not the whole Drive.

It is not a true background cron (Edge Functions don't run on a server-side schedule here); it's a
"when you next visit the app, catch up" model, which is the honest constraint of a client-side app
with no always-on worker.

---

## 5. Are we using meaningful metadata along with chunks?

Yes — after the upgrade, both tables carry rich metadata:

| Field | Where | Source |
| --- | --- | --- |
| `title` | both | Drive file name |
| `full_url` | both | Direct open-in-Drive link |
| `mime_type` / `source_type` | both | `application/vnd.google-apps.document`, etc. |
| `author` | both | Drive file owner / last modifying user |
| `doc_created_time` | both | Drive `createdTime` |
| `doc_modified_time` | chunks | Drive `modifiedTime` |
| `folder_path` | both | Resolved by walking the file's parent folder chain to the root (e.g. `/Finance/Q3/Reports`) |
| `heading` | chunks | The nearest preceding heading detected during chunking — gives each passage its section context |
| `chunk_index` | chunks | Position of the passage within its document |
| `content_hash` | both | SHA-256 of the passage text (integrity + dedup) |
| `embedding_model`, `chunk_size`, `chunk_overlap`, `metadata_version` | both | Provenance of *how* this vector was made |

The `heading` and `folder_path` are the most useful for answer quality: they get folded into the
text that's embedded and into the prompt, so a passage knows it's from "Q3 Reports" even if the
words "Q3" don't appear in the passage itself.

---

## 6. What is `halfvec`, in detail?

`pgvector` (the Postgres extension for vector search) offers two storage types:

| Type | Element size | Max dims for HNSW | Precision |
| --- | --- | --- | --- |
| `vector` | 32-bit float | **2,000** | full |
| `halfvec` | 16-bit float | **4,000** | half |

The problem: our embeddings are **3,072 dimensions**, but `vector`'s HNSW index tops out at 2,000.
So a 3,072-dim `vector` column is searchable *only by brute force* (every query scans every row) —
fine at 265 rows, fatal at a million.

`halfvec` lifts the HNSW limit to 4,000 dims, which comfortably fits 3,072. The trade-off is
precision: 16-bit floats have ~3 decimal digits of accuracy instead of ~7. For cosine similarity
that's a non-issue — the magnitude of noise from quantisation is far smaller than the gaps between
genuinely-similar and genuinely-dissimilar passages. You'd only worry about it in a pathological
case where two passages were near-identical and you needed to rank them apart to 4 decimal places.

**Why not just use fewer dimensions?** OpenAI lets you truncate `text-embedding-3-large` down to
e.g. 1,536 dims (it's a supported, mathematically-correct truncation called Matryoshka). That would
fit `vector`. But it throws away retrieval quality for the sake of using the 32-bit type, which is
backwards — precision is cheaper to give up than quality. `halfvec` keeps the full 3,072 dims and
sacrifices only float precision, which is the right thing to trade.

Storage bonus: 16-bit halves the memory footprint of the index, which directly speeds up search.

---

## 7. If 1,200 chars isn't a good chunk size, I have to re-embed everything, right?

Correct — and this is by design, not a bug. Chunk size is a property of the *stored vectors*, not
just a query-time dial. Change it and every existing chunk is the wrong shape, so:

1. The new chunking settings are written to each chunk row (`chunk_size`, `chunk_overlap`,
   `metadata_version`).
2. The staleness detector flags **every** existing chunk as stale (its stored `chunk_size` no longer
   matches the new setting).
3. A full re-index rebuilds all chunks and re-embeds them.

**Why it can't be incremental:** you can't "trim" an existing 1,200-char chunk into a 1,000-char
one — the vector is a fingerprint of the whole 1,200 chars. Cut the text and the vector is wrong.
You must re-embed from the source text.

**How to make this cheap:** the chunking constants live in `_shared/rag/chunker.ts`
(`CHUNK_SIZE`, `CHUNK_OVERLAP`). Changing them and re-indexing is the supported path. Because the
ingester is incremental on *files* but not on *chunking settings*, the re-index cost is one full
pass — at hundreds of passages that's seconds and fractions of a cent. It only becomes a real cost
at millions of passages, which is the threshold where you'd also revisit the embedding model.

The `metadata_version` constant exists specifically so that non-size changes to the chunker (e.g.
adding heading extraction) can also invalidate the index in a controlled way without touching
`CHUNK_SIZE`.

---

## 8. Where do I adjust temperature and other generation knobs?

In the **AI Settings** page, under the **"Retrieval & Generation"** card.

**How to get there:** open the **Search** page → click your **profile avatar** (top-right) →
**AI Settings**. (Direct URL: `/ai-settings`.)

The tuning console exposes:

| Control | Range | What it does |
| --- | --- | --- |
| **Retrieval mode** | `hybrid` / `vector` / `keyword` | How passages are found. Hybrid blends vector + keyword via RRF (see Q10). |
| **Temperature** | 0.0 – 1.0 | Chat-model randomness. 0 = deterministic/factual, 1 = creative. Default 0.3 for grounded answers. |
| **Max output tokens** | 256 – 8000 | Cap on answer length. |
| **Retrieval top-K** | 5 – 40 | How many candidate passages the search returns before filtering. |
| **Passages to model** | 1 – 15 | How many of those survivors actually go into the prompt. |
| **Min similarity** | 0.0 – 0.9 | Drop passages below this cosine score — filters out weak matches. |
| **Max passages per doc** | 1 – 5 | Prevent one long document from dominating the answer. |
| **Debug retrieval** | on/off | Shows the retrieved passages + scores under each answer, for tuning. |

There's also a **Reset to defaults** button. Changes are saved to `user_ai_preferences` and apply
to every subsequent RAG answer. The `rag-answer` function reads these per-user, so each person can
tune their own behaviour.

---

## 9. What are the different indexing methods, and why HNSW?

The three families of approximate-nearest-neighbour (ANN) indexes for vector search:

### A. Flat / brute force
Compare the query against every row, exact results. `pgvector`'s default when no index is present.
- **Pro:** exact, zero setup, great recall.
- **Con:** O(n) per query. At 265 rows it's instant; at 1M rows it's a multi-second query.
- **When:** small corpora, or as the ground-truth to validate an ANN index.

### B. IVF (Inverted File)
Partition the space into `nlist` cells; only search the few cells nearest the query.
- **Pro:** simple, faster than flat, decent recall.
- **Con:** recall drops if `nlist` is too high for the corpus size; needs a training pass to build
  centroids; tuning `nlist`/`nprobe` is fiddly.
- **When:** medium corpora where you want predictable, tunable speed/recall trade-off.

### C. HNSW (Hierarchical Navigable Small World) — **what we use**
A multi-layer graph: a sparse top layer for long "motorway" jumps, denser layers below for local
refinement. Search hops toward the query on the top layer, then descends.
- **Pro:** best speed/recall ratio in practice; no training pass; incremental (inserts/deletes don't
  rebuild the index); the de-facto standard in modern vector DBs.
- **Con:** more memory (the graph), and results are *approximate* (can occasionally miss a true
  nearest neighbour).
- **When:** most production vector search — which is why it's the default in pgvector, Pinecone,
  Weaviate, Qdrant, etc.

### Why HNSW here, specifically
- The corpus will grow, so O(n) flat search is a dead end.
- Recall matters (a missed passage = a wrong answer), and HNSW's recall at `m=16, ef_construction=64`
  is effectively indistinguishable from exact for this workload.
- It pairs with `halfvec` to fit the 3,072-dim vectors (the `vector` type's HNSW caps at 2,000 dims —
  see Q6).
- No training pass means re-indexing after settings changes is just "delete + insert", not
  "retrain centroids".

The one non-obvious knob: `ef_search` (search-time, controls how wide the graph walk is — higher =
slower + better recall). pgvector sets a sensible default; we don't expose it because at this corpus
size the default is already at the recall ceiling.

---

## 10. How does hybrid search (vector + keyword) work, in detail?

### Why hybrid at all
Pure vector search is great at *paraphrase* ("pricing change" finds "revised list rates") but bad
at *literal* matches — an invoice number, a person's name, a specific SKU. Pure keyword (full-text
search) is the mirror image: exact on identifiers, blind to synonyms. Real questions mix both, so
the best systems blend them.

### The two channels
1. **Vector channel:** embed the question → cosine similarity against `document_chunks.embedding`
   (via the HNSW index) → top-K passages by cosine score.
2. **Keyword channel:** Postgres full-text search over `document_chunks.content_tsv` (a `tsvector`
   column with a GIN index). The query is parsed with `websearch_to_tsquery` (supports quoted
   phrases, boolean operators), ranked by `ts_rank_cd` (cover density — how close the matching terms
   are within the passage).

### The fusion problem (and why you can't just add scores)
The two channels return scores on **incomparable scales**: cosine is 0–1, `ts_rank_cd` is
0.0–~unbounded and distribution-shaped very differently. Adding or averaging them is meaningless —
whichever has bigger numbers just wins.

### The fix: Reciprocal Rank Fusion (RRF)
RRF ignores the *magnitude* of scores and uses only the *rank*. For each passage, in each channel:

```
rrf_score = Σ  1 / (k + rank_in_channel)
```

where `k` is a smoothing constant (commonly 60) that stops rank-1 from drowning out everything else.
A passage that's rank 1 in vector and rank 3 in keyword beats one that's rank 1 in vector but
unranked in keyword — which is exactly the behaviour you want: the passage that *both* methods
agree on wins.

RRF needs no score calibration, no training, and no per-channel weight tuning to work well — which is
why it's the default fusion method in Elasticsearch, OpenSearch, and Postgres-based hybrid setups.

### The per-mode weighting
`rag-answer`'s `weightsFor(mode)` sets each channel's RRF weight:
- `hybrid` → `{vector: 1, keyword: 1}` — both contribute equally.
- `vector` → `{vector: 1, keyword: 0}` — keyword channel disabled (pure semantic).
- `keyword` → `{vector: 0, keyword: 1}` — vector channel disabled (pure full-text).

So the tuning console's "Retrieval mode" selector is literally choosing which channels contribute to
the RRF sum. The RPC `match_document_chunks_hybrid` runs both searches, fuses with RRF, applies
`min_similarity` and `max_passages_per_doc` caps, and returns the final ranked passages.

### The SQL shape (simplified)
```sql
-- vector channel
SELECT id, '<const>' AS channel, row_number() OVER (ORDER BY embedding <=> query_vec) AS rank
FROM document_chunks WHERE user_id = $1
ORDER BY embedding <=> query_vec LIMIT $topk

UNION ALL

-- keyword channel
SELECT id, '<const>' AS channel, row_number() OVER (ORDER BY ts_rank_cd(content_tsv, q) DESC) AS rank
FROM document_chunks WHERE user_id = $1 AND content_tsv @@ q
ORDER BY ts_rank_cd(content_tsv, q) DESC LIMIT $topk

-- then fuse
SELECT id, SUM(weight / (60 + rank)) AS rrf_score
FROM channels GROUP BY id
ORDER BY rrf_score DESC LIMIT $match;
```

`<=>` is pgvector's cosine-distance operator; `@@` is the tsvector match operator.

---

## 11. Can we use multimodal embeddings so we don't miss tables?

### What "multimodal embedding" means
A multimodal embedding model maps *different modalities* (text, image, audio) into the **same**
vector space, so a text query can retrieve an image and vice versa. `gemini-embedding-2` and
OpenAI's CLIP-family models do this.

### Why we don't use them for tables
Tables aren't really a "modality" problem — they're a *format* problem. A table in a PDF/DOCX is
stored as positioned text (cells with coordinates), not as an image. A multimodal model would
embed a *picture* of the table, which:

- Requires rendering each table to an image (expensive, lossy).
- Loses the actual cell values — you can't copy a number out of an image embedding.
- Is worse at exact numeric/identifier recall than keyword search (see Q10).

### What we do instead: convert tables to markdown at extraction time
The chunker and extractors (`ooxml.ts`, `csv.ts`) detect tables in DOCX/XLSX/PPTX/CSV and emit them as
**markdown pipe-tables**:

```
| Quarter | Revenue | Growth |
|---------|---------|--------|
| Q3      | $4.2M   | 14%    |
```

This is strictly better for RAG:
- The structure is preserved as text, so both the embedding *and* keyword search see the real values.
- "14%" is now a literal token the keyword channel can match exactly.
- The passage embeds as a coherent text block (the model reads markdown tables well).
- No image rendering, no extra model, no precision loss.

### When multimodal embeddings *would* be worth it
- **Scanned PDFs** that are literally images of pages (currently recorded as `skipped_no_text`).
  There, OCR or a multimodal embedder is the only way in. That's a separate, heavier pipeline.
- **Charts/diagrams** whose meaning is visual, not tabular — a multimodal model could embed a
  screenshot of a chart so "revenue trend" retrieves it. Worth it only if your corpus is
  chart-heavy; for text-and-table documents, markdown conversion covers it.

### The honest trade-off
Markdown-table conversion catches structured data perfectly and is free. Multimodal embeddings
catch *unstructured* visuals (charts, scanned pages) but cost an image-capable model and an
extraction/render step. For a Drive corpus of business documents, the former is the right call; the
latter is a future upgrade gated on "do you have scanned PDFs or charts you need to search?"

---

## Quick reference: where each decision lives in the code

| Concern | File |
| --- | --- |
| Embedding model & gateway call | `supabase/functions/_shared/rag/embeddings.ts` |
| Chunk size, overlap, heading/table extraction | `supabase/functions/_shared/rag/chunker.ts` |
| Office/CSV table → markdown | `supabase/functions/_shared/rag/ooxml.ts`, `csv.ts` |
| Drive file listing, metadata, staleness | `supabase/functions/ingest-drive-documents/index.ts` |
| Hybrid retrieval, RRF, tuning overrides | `supabase/functions/rag-answer/index.ts` |
| Hybrid search RPC (SQL) | `match_document_chunks_hybrid` (database) |
| Tuning console UI | `src/pages/AISettings.tsx` ("Retrieval & Generation" card) |
| Index status, stale detection, auto-sync | `src/components/DriveIndexPanel.tsx` |

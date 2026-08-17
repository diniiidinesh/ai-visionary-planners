# How the RAG pipeline works, end to end

Written for an engineer who is not a machine-learning specialist. Every decision below has a
trade-off; where a decision could reasonably have gone the other way, the alternative is named.

---

## 0. The problem

You ask: *"What did we commit to on the Q3 pricing change?"*

The answer lives in one paragraph of one 60-page PDF, among 13 files. Three naive options all fail:

| Approach | Why it fails |
| --- | --- |
| Send all documents to the model | Too many tokens: cost and latency explode, and models get *worse* at finding a needle in a huge haystack ("lost in the middle"). |
| Keyword search, then send hits | Misses paraphrase. "Pricing change" never matches a doc that says "revised list rates". |
| Fine-tune a model on your docs | Expensive, slow, stale the moment a doc changes, and it cannot cite sources. |

RAG (Retrieval-Augmented Generation) is the fourth option: **find the few relevant paragraphs
first, then ask the model to answer using only those.** Retrieval is a search problem; generation is
a writing problem. Keeping them separate is what makes citations and freshness possible.

---

## 1. Embeddings: turning meaning into geometry

An **embedding model** takes a piece of text and returns a fixed-length list of numbers — a vector.
The property that makes it useful: texts that *mean* similar things land close together in that
space, even with no words in common. "Revised list rates" ends up near "pricing change".

Closeness is measured with **cosine similarity** — the angle between two vectors, from 1.0
(identical direction) to 0 (unrelated). We use the angle rather than the distance because vector
*length* mostly encodes text length, which we don't care about.

Two consequences worth internalising:

1. **An embedding is lossy.** It captures topic and gist very well, exact identifiers poorly. A
   vector search for an invoice number or a person's surname is weaker than a plain keyword search.
   That's why hybrid search (vector + keyword) is the standard next upgrade.
2. **Vectors from different models are not comparable.** They are coordinates in different,
   unrelated spaces. Comparing an OpenAI vector to a Google vector produces a number, and that
   number is meaningless. **Changing the embedding model requires re-embedding everything.** This is
   the single biggest lock-in decision in the whole pipeline, which is why every stored passage
   records the model it was created with (`embedding_model` column).

### Why 3072 dimensions

Dimensions are how much room the model has to encode distinctions. More dimensions generally means
finer discrimination, at a cost:

- Storage: 3072 numbers per passage. Postgres stores them as 4-byte floats, so ~12 KB per passage
  before compression. 265 passages is trivial; 5 million passages is ~60 GB and a real decision.
- Search speed: every comparison touches every dimension.

3072 is the native output of the large models on both OpenAI and Google. Below ~1000 dims quality
starts to drop noticeably on nuanced retrieval; above 3072 there is nothing widely available. It's
the current sweet spot for a corpus of this size, and this corpus is small enough that the storage
cost is irrelevant.

### Why OpenAI `text-embedding-3-large`

The intended default was Google's `gemini-embedding-2` (also 3072 dims, multimodal, and slightly
ahead on multilingual benchmarks). It returned *model unavailable* on this workspace's AI gateway,
so the pipeline uses the strongest available alternative at the same dimensionality.

The realistic option space:

| Model | Dims | Quality | Cost per 1M tokens | Notes |
| --- | --- | --- | --- | --- |
| `openai/text-embedding-3-large` (**in use**) | 3072 | Very high | ~$0.13 | Strong on English business documents, well-behaved with long passages, supports truncation to fewer dims if storage ever matters. |
| `openai/text-embedding-3-small` | 1536 | Good | ~$0.02 | ~6x cheaper, measurably weaker on subtle paraphrase. Correct choice at millions of passages, over-thrifty at hundreds. |
| `google/gemini-embedding-2` | 3072 | Very high | comparable | Preferred default; multimodal (can embed images/audio). Unavailable here. |
| Open-source (BGE-M3, E5-large, Nomic) | 768–1024 | Good | infra cost only | No per-token fee and no data leaves your infrastructure, but you must host a GPU or accept slow CPU inference. Worth it at very high volume or under strict data-residency rules; pure overhead at this scale. |

Decision rule applied: at 265 passages the *total* embedding bill is fractions of a cent, so
retrieval quality wins over cost, and a hosted API wins over operating inference infrastructure.
If this grows to millions of passages, revisit — the ranking of these criteria inverts.

### The API constraints that shape the code

- **Batching:** up to 100 inputs per request; the code chunks the list into batches of 100.
- **Per-input token cap:** ~8192 tokens for these models. Our 1200-character passages are ~300
  tokens, so we're an order of magnitude clear — deliberately.
- **Failures:** 429 (rate limited) and 402 (out of credits) abort the whole ingestion batch rather
  than burning through remaining files with calls that will fail identically.

---

## 2. Chunking: 1200 characters, 200 overlap

We split documents before embedding because one vector can only represent one idea well. Embed a
whole 60-page PDF and you get the *average* of everything in it, which is near nothing.

**Size = 1200 characters (~200–300 words, roughly 300 tokens).**

- Too small (say 300) and passages lose their context: "it increased by 14%" with no clue what
  "it" is. The model then can't answer even with the right passage in hand.
- Too large (say 5000) and the embedding blurs — a passage covering five topics is a weak match for
  all five — plus you waste prompt budget dragging in irrelevant text with each hit.
- 1200 is about one dense paragraph or a short section: a self-contained thought, still specific.

**Overlap = 200 characters.** Chunk boundaries are arbitrary and will eventually land in the middle
of the one sentence that answers the question. Repeating the last 200 characters of each chunk at
the start of the next means any statement shorter than 200 characters survives intact in at least
one chunk. Cost: ~17% more chunks to store and embed. Cheap insurance.

**Splitting strategy, in priority order:**

1. Split on blank lines (paragraphs) — authors already marked their semantic boundaries; use them.
2. If a single paragraph exceeds 1200 chars, split it on sentence endings.
3. If a single *sentence* exceeds 1200 chars (tables, minified text, OCR output), hard-cut it.
4. Re-pack the resulting pieces into chunks up to 1200 chars, carrying the 200-char overlap.

This is why chunks aren't exactly 1200 characters — they're "as close to 1200 as the document's own
structure allows", which is the point.

---

## 3. Ingestion: getting text out of Drive

For each file the pipeline lists from Drive:

- **Google Docs / Slides** → Drive's export endpoint, converted to plain text.
- **Google Sheets** → exported to CSV (rows become comma-separated lines, which chunk and embed
  reasonably).
- **PDF** → downloaded raw, text extracted with `unpdf`. A **scanned** PDF is just images; it yields
  no text and is recorded as `skipped_no_text` rather than silently indexing nothing. Making those
  searchable would require OCR — a separate, much heavier pipeline.
- **Word / Excel / PowerPoint (.docx/.xlsx/.pptx)** → downloaded raw and unzipped in memory. OOXML
  files are ZIP archives of XML, so the text is pulled from `word/document.xml`, the shared-strings
  and sheet XML, or the per-slide XML. Note Drive's export endpoint does **not** work on these —
  it only converts Google-native files — which is exactly why they need their own path.
- **Legacy .doc/.xls/.ppt** → recorded as `skipped_unsupported`. These are proprietary binary
  formats needing a heavyweight converter; the fix is to re-save them as modern formats.

**Incremental sync.** Re-embedding unchanged files every run would be pure waste, so a file is
skipped when both Drive's `modifiedTime` and a SHA-256 hash of the extracted text match what was
stored last time. The hash is the backstop: Drive bumps `modifiedTime` for trivial events like
opening a file in some clients.

**Batch size 3, and a 15 MB file cap.** Edge functions run with a hard memory ceiling. Extracting a
large PDF holds the file, the parsed document object and the extracted text in memory at once;
processing ten of those concurrently killed the worker during testing. Three files per invocation,
with the client looping until the function reports `done`, keeps every invocation inside its limits
and makes the work resumable if one call fails.

---

## 4. Storage and the vector index

Passages go into `document_chunks`: the text, the 3072-dim vector, the file title and link, the
passage number, the content hash and the embedding model. Row-level security scopes every row to
its owner, so one user's Drive content is never reachable by another.

Finding nearest vectors by brute force means comparing against every row — fine at 265 rows, not at
a million. **HNSW** (Hierarchical Navigable Small World) is the index that fixes it. Intuition: a
road network with a motorway layer for long jumps and local streets for the final approach. A search
starts on the sparse top layer, hops toward the query, then descends to progressively denser layers
to refine. It's *approximate* — it can miss a true nearest neighbour occasionally — in exchange for
logarithmic instead of linear search time. For document retrieval that trade is obviously correct.

One Postgres quirk: `pgvector`'s HNSW index supports at most 2000 dimensions on the `vector` type.
Our vectors are 3072. The workaround is `halfvec`, which stores 16-bit instead of 32-bit floats —
half the memory, negligible accuracy loss at this precision — and indexes up to 4000 dims. So the
index is built on `embedding::halfvec(3072)`, and **queries must apply the identical cast** or
Postgres silently ignores the index and scans the table.

---

## 5. Retrieval: from question to passages

1. Embed the question with the *same model* used for the passages (non-negotiable — see §1).
2. `match_document_chunks` returns the top **20** by cosine similarity, filtered to the caller's own
   rows, discarding anything below **0.15** similarity.
   - Why 20 and not 8: retrieval is cheap; the filters that follow need candidates to work with.
   - Why a 0.15 floor: cosine similarity always returns *something*. Without a floor, a question
     about topics absent from your Drive returns the 20 least-irrelevant passages and the model
     dutifully hallucinates around them. The floor lets the system say "not in your documents".
3. **Max 3 passages per document.** Without this, one long document that is broadly on-topic
   monopolises all 10 slots and the answer can't compare sources or spot disagreement.
4. Keep the top **10**. At ~1200 chars each that's ~12 K characters (~3 K tokens) of context —
   enough for a well-grounded answer, small enough to stay fast, cheap, and inside the region where
   models reliably attend to everything they're given.

---

## 6. Generation: the answer, with citations

The selected passages are numbered `[1]…[10]` and inserted into the prompt with each one's title,
Drive URL and similarity score. The instructions are deliberately strict:

- **Use only the excerpts.** The whole value proposition is "answers from *your* documents". A model
  blending in general knowledge would be indistinguishable from a plain chatbot, and unverifiable.
- **Cite inline with the bracket number.** Numbers map back to real Drive links in the UI, so every
  claim is one click from its source. This is the main defence against hallucination — not because
  the model can't fabricate a citation, but because you can check it in seconds.
- **Surface disagreement** rather than silently picking one document.
- **Say "not in the documents"** explicitly when the excerpts don't answer the question. Models
  default to being helpful; you have to authorise them to fail.
- **Temperature 0.3.** Low, because this is extraction and synthesis, not creative writing.
- **End with a confidence marker.** Cheap self-assessment; useful as a reading cue, not as a metric.

The UI shows the summary plus an expander with the exact passages used, so the retrieval step is
auditable rather than a black box.

---

## 7. Cost model

- **Indexing (once per document version):** one embedding call per passage. 265 passages ≈ 80 K
  tokens ≈ **~$0.01 total**. Re-indexing only touches changed files.
- **Per question:** one embedding of the question (negligible) + one chat completion over ~3 K
  tokens of context, at chat-model rates — cents at most, and independent of how large your Drive
  gets. That last property is the real payoff of RAG.

---

## 8. What to tune first if answers are weak

Diagnose in this order — the fix is different at each stage, and fixing the wrong one wastes effort.

1. **Is the document indexed at all?** Check the passage browser on the Connect page. Skipped,
   failed and unsupported files are listed with reasons. This has been the actual cause more than
   once (Word files, scanned PDFs).
2. **Is the right passage being retrieved?** Expand "cited passages" under an answer. If the correct
   passage isn't in the list, it's a *retrieval* problem: raise the candidate count, lower the
   similarity floor, or add keyword search alongside vectors (hybrid search) — that's the highest-
   value upgrade for questions containing names, IDs or exact figures.
3. **Is the passage retrieved but the answer still wrong or vague?** That's a *chunking* or *prompt*
   problem. If passages read as fragments missing their context, increase chunk size. If the answer
   ignores a passage that plainly contains the fact, tighten the prompt or use a stronger chat model.
4. **Is one document crowding out the rest?** Raise or lower the per-document cap of 3.

Worth building before tuning seriously: a fixed list of ~20 real questions with known correct source
documents, run after every change. Without it you're tuning on anecdote — and every knob here trades
one failure mode for another.

---

## 9. Known limitations, stated plainly

- **No hybrid search yet.** Pure vector search is weak on exact identifiers.
- **No reranker.** A cross-encoder reranking the top 20 down to 5 typically gives a solid quality
  bump for one extra model call.
- **Scanned PDFs are invisible.** No OCR in the pipeline.
- **Tables and spreadsheets flatten to text.** Row/column relationships partly survive as CSV, but
  complex multi-sheet models will not answer well.
- **Images and charts are ignored.** A multimodal embedding model would change this.
- **Permissions are point-in-time.** Passages are indexed under the user who ran the index. If Drive
  access is revoked later, the already-indexed passages remain until re-indexed. Sharing boundaries
  between users are respected (each user's rows are private), but revocation is not instant.

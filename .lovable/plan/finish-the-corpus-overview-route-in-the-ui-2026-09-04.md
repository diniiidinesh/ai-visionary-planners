# Finish the corpus-overview route in the UI

The backend route added via Claude Code is in place: the query planner now classifies each question as `lookup` or `corpus_overview`, `rag-answer` branches on that, and `corpus-overview.ts` builds an exact profile from the document catalog instead of retrieving passages. `LiveRun.tsx` and the stage-6 write-up on `/pipeline` were already updated to describe it.

What is missing is the wiring between them, plus the places the new route is still invisible.

## What is broken right now

The corpus branch in `rag-answer/index.ts` returns:

```
corpus: { totalDocuments, indexedDocuments, totalChunks, listingTruncated, statsComplete }
```

but `buildCorpusProfile` never produces a `totalChunks` field — it produces `catalogChunks`, `searchableChunks` and `catalogStale`. So `corpus.totalChunks` is always `undefined`, and the two fields `LiveRun.tsx` reads (`corpus.searchableChunks` for the "searchable passages" tile, `corpus.catalogStale` for the stale-catalog warning) are never sent. The catalog panel on a corpus turn renders a blank number and the staleness warning can never appear.

This is a one-line-shaped backend fix, but without it none of the UI below has data.

## Changes

### 1. Send the fields the UI reads (`supabase/functions/rag-answer/index.ts`)

Replace the `corpus` payload with the profile's real field names: `totalDocuments`, `indexedDocuments`, `catalogChunks`, `searchableChunks`, `catalogStale`, `listingTruncated`, `statsComplete`. Add `catalogChunks` to the `Corpus` interface in `LiveRun.tsx` and show it next to the searchable count, since the gap between the two is exactly what `catalogStale` is about.

### 2. Route-aware stage rail (`LiveRun.tsx`)

The progress rail is hardcoded to the nine lookup stages, and the fake stage timer counts to 9 — so a corpus turn animates through "embed the query", "rerank" and other stages it never ran, then renders a four-stage breakdown. Fix:

- Keep the nine-stage rail while a run is in flight (the route isn't known until the response lands), but stop at stage 2 with a "classifying…" state rather than marching through retrieval stages.
- After the response, render the rail from a route-specific stage list: the existing nine for `lookup`, and the four-step catalog list for `corpus_overview`.
- Badge each completed turn with its route (`lookup` / `corpus overview`) in the turn header, so a scrolled-back conversation shows which path each answer took.

### 3. Route override control (`LiveRun.tsx`)

`overrides.intent` already exists in the edge function and is the single best teaching device on this page: the same question, forced down either path, produces visibly different answers. Add a small three-way selector above the input — **Auto (classifier)** / **Force lookup** / **Force corpus overview** — passed through as `overrides.intent` (omitted on Auto). When a run was forced, note it on the turn so the classifier's own verdict (`retrieval.classifiedIntent`, already returned) can be shown alongside: "classifier said lookup, forced to corpus_overview".

### 4. Two example questions (`LiveRun.tsx`)

Add clickable example chips under the input — one lookup, one corpus ("What does my Drive contain?") — so the routing behaviour is discoverable without the user guessing which phrasings trigger it.

### 5. Explain the Lab's pinning (`EmbeddingLab.tsx`)

The Lab hardcodes `intent: "lookup"` because a corpus answer is identical in both embedding spaces and would make the A/B comparison meaningless. That reasoning is a code comment only. Surface it as one line of helper text under the Lab header.

### 6. Corpus answers in the main search UI (`src/pages/Search.tsx`)

Outside `/pipeline`, a corpus answer is indistinguishable from a normal one: `Search.tsx` ignores `answerMode` entirely, so it shows up to 12 source chips with no relevance score and an empty "cited passages" section. Add: an "Answered from the document catalog" badge on the message, suppress the empty passages block when `excerpts` is empty, and label the chips "Documents in your index" rather than sources for that turn.

## Technical notes

- No database or migration work; the catalog reads all go through the existing RLS-scoped client.
- `rag-answer` needs a redeploy after the payload change.
- `retrieval.intent`, `classifiedIntent` and `intentForced` are only returned when `debugRetrieval` is on. `/pipeline` always sets it; `Search.tsx` must not depend on those fields and should branch on top-level `answerMode` instead.
- Corpus turns legitimately return `chunksUsed: 0` and no excerpts — the UI should treat that as a valid state, not an empty result.

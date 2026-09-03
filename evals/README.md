# Evaluating this RAG pipeline

A harness for answering one question with evidence instead of vibes: **is the
system actually getting better when I change something?**

Everything here runs against *your* deployed `rag-answer` function, signed in as
*your* account, over *your* indexed corpus. Nothing is mocked.

---

## 0. Why bother

Every knob in this pipeline trades one failure mode for another:

| Turn this up | You gain | You lose |
| --- | --- | --- |
| `minSimilarity` | fewer irrelevant passages | more false refusals |
| `passagesToModel` | more context to answer from | dilution, cost, "lost in the middle" |
| `maxPassagesPerDoc` | one doc can dominate | you stop seeing disagreement between sources |
| `chunkSize` | passages keep their context | embeddings blur across topics |

There is no setting that is better on every axis. Without measurement you are
choosing between failure modes blindfolded, and the natural human bias is to
tune until the *one question you keep typing* works — which is overfitting to a
sample of one.

The fix is boring and it works: **a fixed set of questions with known correct
sources, run after every change.**

---

## 1. The three layers

RAG fails in three distinct places, and the fix is different at each. Measuring
them together tells you *that* something is wrong; measuring them separately
tells you *what*.

```
Question
   │
   ├─ 1. RETRIEVAL ── did the right passage come back at all?
   │                   fix: chunking, embeddings, hybrid search, reranking
   │
   ├─ 2. GENERATION ─ given the right passage, was the answer faithful?
   │                   fix: prompt, model, temperature
   │
   └─ 3. GUARDRAILS ─ what happens when there IS no right answer?
                       fix: similarity floor, refusal instruction
```

**Retrieval is the ceiling.** If the correct passage was never retrieved, no
prompt and no model can produce a correct answer — it is not in the context.
That is why retrieval metrics come first in the report and why you should fix
retrieval before touching the prompt.

---

## 2. The metrics, properly

These four get mixed up constantly. Here they are on one concrete example.

Your corpus has **3 passages** that answer "what are the pricing tiers?". Your
system retrieves **10 passages**, of which **2** are among those 3.

| Metric | Formula | Here | Reads as |
| --- | --- | --- | --- |
| **Precision@10** | relevant retrieved ÷ **retrieved** | 2/10 = 0.20 | "20% of what I showed the model was useful" |
| **Recall@10** | relevant retrieved ÷ **relevant that exist** | 2/3 = 0.67 | "I found 67% of the good stuff" |
| **F1** | harmonic mean of the two | 0.31 | one number when you need to balance both |
| **MRR** | 1 ÷ rank of *first* relevant hit | if first hit is at rank 3 → 0.33 | "how far down was the first good result" |

The way to keep them straight: **precision's denominator is what you returned;
recall's denominator is what existed.** Precision punishes noise. Recall
punishes misses.

**Which one matters here?** For RAG with a strong LLM, **recall dominates**.
A few irrelevant passages in a 10-passage context are mostly harmless — the
model ignores them. A *missing* passage is fatal, because the answer simply
isn't there. So optimise Recall@k first, and only worry about precision when
context cost or dilution becomes measurable.

**Why MRR and NDCG on top of those?** Because position matters. Precision@10
treats a relevant passage at rank 1 and rank 10 identically, but the model does
not — attention degrades down a long context ("lost in the middle"). MRR
captures "was the best hit near the top". **NDCG@k** generalises that: it
discounts each relevant hit by `1/log2(rank+1)`, so it rewards getting *several*
relevant results high up, not just the first one. Use MRR when one good passage
is enough; use NDCG when the answer needs synthesis across several.

**F1 is the one you can usually skip.** It is a scalar summary for when you must
rank configurations by a single number. It hides *which* side regressed, so
report P and R alongside it, always.

### Two metrics specific to RAG that people forget

- **False refusal rate** — answerable questions where the system said "not in
  the documents". This is retrieval failure wearing a polite mask, and it is
  invisible if you only measure faithfulness (a refusal is perfectly faithful).
- **False answer rate** — unanswerable questions where the system answered
  anyway. This is the hallucination number, and it is the single most important
  safety figure in the report.

These two trade directly against each other via `minSimilarity`. Raise the
floor: false answers drop, false refusals rise. Report both or you are only
seeing half the tradeoff.

---

## 3. What counts as a hit

This harness judges relevance at the **document** level: a retrieved candidate
counts as relevant if it came from a document the golden set lists in
`expectedDocs`.

**Why not chunk level?** Chunk-level ground truth is more precise, but chunk
identity is unstable here — `chunk_index` shifts whenever `CHUNK_SIZE`,
`CHUNK_OVERLAP`, or `METADATA_VERSION` changes, which is exactly when you most
want to compare before/after. Document identity survives re-chunking, so
document-level ground truth stays valid across the changes you actually make.

The tradeoff, stated plainly: if a document is long and only one of its 30
chunks truly answers the question, this harness will score any of those 30 as a
hit. That inflates precision. Live with it at this corpus size; if you later
need chunk-level truth, add a stable `chunk_uid` at ingest time and record it in
`expectedChunks`.

---

## 4. Building the golden set

### Step 1 — generate a draft from your real corpus

```bash
cd evals
npm install
cp .env.local.example .env.local     # then edit it with your credentials
node generate-golden-set.mjs --per-doc 3
```

This reads your indexed chunks (RLS means you see exactly your own), samples
across each document, and asks a model to write one realistic question per
sampled passage. Output: `golden-set.draft.json`.

**Why generated rather than hand-written?** A golden set is only useful if its
questions are genuinely answerable from your corpus. Questions written from
memory tend to ask about things that *aren't* in the documents, and then every
metric measures your question set rather than your pipeline.

**Why a draft?** Because auto-drafted questions have predictable defects, which
is what step 2 is for.

### Step 2 — review the draft (this is the part that matters)

Open `golden-set.draft.json` and work through every case. Set `"reviewed": true`
only when it passes all of these:

- [ ] **Answerable from the listed document.** Open the doc and confirm.
- [ ] **Not trivially keyword-matchable.** If the question reuses the passage's
      rare wording verbatim, it tests string overlap, not retrieval. Paraphrase it.
- [ ] **Not answerable from three other documents too.** If it is, either add
      them all to `expectedDocs` or make the question more specific — otherwise
      you will score correct retrievals as misses.
- [ ] **`expectedFacts` are short and exact.** `"29"` not `"$29 per month"` —
      these are substring-matched against the answer, so punctuation and
      phrasing variance will produce false failures.
- [ ] **Not a duplicate** of another case in spirit.

Then rename to `golden-set.json`.

**Aim for ~20-40 reviewed cases.** Below ~20, one question flipping moves the
headline number by 5%+ and you cannot distinguish signal from noise. Above ~40
you are paying real API cost per run for diminishing resolution.

### Step 3 — add the cases a generator cannot invent

The generator writes questions *from* passages, so by construction it can only
produce answerable ones. Add by hand:

- **Multi-turn cases** (`"history": [...]`) — a follow-up whose referent lives
  in a previous turn. These are the ones that fail without query condensation.
  See `s006` in `golden-set.seed.json`.
- **Multi-hop cases** — questions needing two documents at once. Put both in
  `expectedDocs`. These expose the `maxPassagesPerDoc` cap doing its job (or not).
- **Known-absent questions** — things that sound like they should be in your
  corpus but aren't. Harder and more useful than "capital of France", because
  retrieval will return semi-related passages and the model must still refuse.

---

## 5. Running it

**Set up credentials once** — copy `.env.local.example` to `.env.local` and fill
it in. That file is gitignored, works identically on PowerShell / bash / zsh, and
keeps your password out of shell history files (which are stored on disk in
plain text).

```
EVAL_EMAIL=you@example.com
EVAL_PASSWORD=your-password
ANTHROPIC_API_KEY=sk-ant-...
```

Then simply:

```bash
node run-eval.mjs
```

Real environment variables still override the file, so CI can inject secrets
without touching it.

Add `--judge` for LLM-scored faithfulness. Without it you still get every
deterministic metric — which is most of them.

```bash
node run-eval.mjs --set golden-set.seed.json   # smoke test the harness first
node run-eval.mjs --k 5                        # metrics at a different cutoff
node run-eval.mjs --judge                      # + faithfulness scoring
```

Results are written to `results/<timestamp>.json`. Keep them — the point is the
trend across changes, not any single run.

### First-time setup on macOS

```bash
# Node 18+ (ships with fetch, which the harness relies on)
node --version || brew install node

cd evals
npm install
cp .env.local.example .env.local
open -e .env.local          # fill in EVAL_EMAIL / EVAL_PASSWORD, save, close
node run-eval.mjs --set golden-set.seed.json
```

No shell-syntax differences to worry about: credentials come from `.env.local`,
not from `export` lines, so the same commands work in zsh, bash and PowerShell.

### Routing regression set

`golden-set.routing.json` tests one thing: does a question get sent down the
right path — retrieval, or the document catalog? It is **corpus-agnostic and
committed to the repo**, because unlike the content golden sets no case quotes
or depends on any document. It works against any account.

```bash
node run-eval.mjs --set golden-set.routing.json --out results/routing.json
```

Read the `ROUTING` block. `routingAccuracy` must be **1.0**:

- The `c00*` cases must route to `corpus_overview`. For these the harness also
  checks the stated document count against a direct `COUNT(*)` on the database —
  this path has one exact right answer, so it is graded exactly.
- The `r00*` cases must route to `lookup`. **These are the important half.**
  They are lookups that *sound* like catalog questions ("which documents mention
  pricing?", "how many people are mentioned in my notes?"), and they are what
  catches an over-eager classifier. A misroute here is worse than the bug this
  feature fixed, because it breaks questions that used to work.

Run it after any change to the query-planner prompt — that prompt is on the path
of *every* question, so a tweak intended to help routing can quietly degrade
standalone-question rewriting for everything else. For that, re-run the main set
too and compare against the previous run.


### Deterministic vs judged

As much as possible is measured **without** an LLM judge, because judges are
themselves noisy and cost money:

| Checked deterministically | Needs a judge |
| --- | --- |
| Was the right document retrieved (and at what rank) | Is each claim actually supported by the cited passage |
| Did it refuse | |
| Are cited `[n]` numbers real excerpts | |
| Do required facts appear in the answer | |
| Latency | |

**Citation validity is a genuinely good cheap proxy.** If the answer cites `[7]`
but only 5 excerpts were supplied, the model fabricated a source — caught with a
regex, no judge needed.

---

## 6. Reading the report

```
════════ RETRIEVAL ════════
  Hit@10          85.0%   (at least one correct doc retrieved)
  Recall@10       71.2%   (share of expected docs found)
  Precision@10    31.0%
  MRR             0.612
  NDCG@10         0.688
  Keyword coverage 15.0%  ← see below
  Reranked         100.0%
```

### Diagnostic order — fix top-down

**1. Hit@k is low (< ~80%)** → retrieval is the bottleneck. Nothing downstream
can help. In order of expected payoff:
   - Are the documents even indexed? Check the passage browser for
     `skipped_no_text` (scanned PDFs) and `skipped_unsupported` (legacy .doc).
   - Any documents needing re-index? Stale chunk/embedding settings rank wrongly.
   - Raise `retrievalTopK`, lower `minSimilarity`, re-measure.
   - Look at **keyword coverage** (next item).

**2. Keyword coverage is near zero** → your "hybrid" search is running on one
engine. `websearch_to_tsquery` ANDs every term, so a full-sentence question
requires a chunk containing *every* word — almost none do. This was measured at
**5% (1 of 20 candidates)** on this corpus before the query-planner change; it
should be substantially higher now. If it is still near zero, the keyword
queries being generated don't match your documents' actual vocabulary.

**3. Hit@k is fine but MRR/NDCG are low** → retrieval finds it but ranks it
badly. This is exactly what reranking fixes. Confirm `Reranked` is 100% (if it
is 0%, `VOYAGE_API_KEY` isn't set and the reranker is silently no-oping).

**4. Retrieval is good but answers are wrong** → now it's generation.
   - High false-refusal with good Hit@k → the model isn't recognising the answer
     in the passage. Usually a chunking problem: the passage is a fragment
     missing its context. Check `heading` quality (see §8).
   - Low faithfulness → tighten the prompt, or use a stronger summarize model.
   - Invalid citations → prompt problem, or too many passages to keep track of.

**5. False answer rate > 0** → the system hallucinated on an unanswerable
question. Raise `minSimilarity` and re-run; watch false refusal rate rise in
exchange. Pick the point on that curve you can defend.

### What "good" looks like

Do not chase absolutes — chase *your own baseline*. But rough orientation for a
small, clean corpus:

| Metric | Concerning | Reasonable | Good |
| --- | --- | --- | --- |
| Hit@10 | < 70% | 80-90% | > 90% |
| MRR | < 0.4 | 0.5-0.7 | > 0.7 |
| False refusal | > 15% | 5-15% | < 5% |
| False answer | > 10% | 3-10% | < 3% |
| Invalid citations | > 5% | 1-5% | ~0% |

---

## 7. Discipline that makes the numbers mean anything

- **Change one thing per run.** Two changes, one number, no attribution.
- **Re-run the whole set, not the failures.** Fixing a failure by breaking three
  passes is the most common way to move backwards while feeling productive.
- **Watch the tradeoff pairs.** `minSimilarity` moves false-refusal and
  false-answer in opposite directions. Reporting only one is self-deception.
- **Regenerate the golden set when the corpus changes materially.** Ground truth
  about documents you no longer have is worse than no ground truth.
- **Keep the raw JSON.** Aggregates hide which cases flipped; the per-case
  records are where the actual learning is.

---

## 8. Known limits of this harness

Stated plainly, because an eval you trust too much is worse than none:

- **Document-level relevance inflates precision** on long documents (§3).
- **The golden set is model-drafted.** Reviewing catches most defects, not all —
  in particular a drafted question can be subtly easier than a real user's.
- **`expectedFacts` is substring matching.** "$29" vs "29 dollars" vs "twenty-nine"
  all differ. Keep facts short and numeric; treat this metric as a smoke test.
- **The LLM judge is one model's opinion**, with its own biases (it tends to
  reward fluent answers). Use it for trend, not as truth.
- **Guardrail cases are few.** Six adversarial prompts is not a security
  assessment. Prompt injection *via document content* — a poisoned file in your
  Drive — is not tested here at all and is the more realistic attack.
- **No cost tracking per run.** `ai_usage_logs` records it server-side; join on
  it if per-eval spend matters to you.

---

## 9. If you're talking about this in an interview

The framework itself is the answer to "how would you know if your RAG system is
good?" — but the specific things worth saying:

- **Separate retrieval from generation.** Most people describe one blended
  "accuracy" number; naming the layers and noting *retrieval is the ceiling*
  signals you have actually debugged one of these.
- **Recall over precision for RAG**, with the reason (a missing passage is
  fatal, a noisy one is usually ignored).
- **The refusal tradeoff.** False-refusal and false-answer as a tunable curve
  rather than a bug is a genuinely senior framing.
- **Public benchmark to shortlist, private eval to decide.** MTEB Retrieval to
  narrow embedding models, your own golden set to choose — because leaderboards
  are gameable and don't know your domain vocabulary.
- **The keyword-coverage finding.** "Our hybrid search was silently running on
  one channel because full-text search ANDs every term and we were feeding it
  whole sentences" is a concrete, measured, non-obvious debugging story. Those
  are worth more in an interview than any framework recitation.

---

## Files

| File | What it is |
| --- | --- |
| `generate-golden-set.mjs` | Drafts questions from your real indexed chunks |
| `run-eval.mjs` | Runs the set, computes metrics, writes `results/` |
| `lib/metrics.mjs` | Precision / recall / MRR / NDCG / citation validity |
| `lib/client.mjs` | Auth + `rag-answer` invocation |
| `.env.local.example` | Template for your credentials — copy to `.env.local` (gitignored) |
| `golden-set.seed.json` | 10 hand-seeded cases — smoke test only, see its `provenance` field |
| `chunker-probe.mjs` | Reproduces the chunker findings in §8 of the chunking review |

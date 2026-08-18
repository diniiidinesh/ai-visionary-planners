// Retrieval metrics over a ranked candidate list with binary relevance.
//
// "Relevant" here means: this candidate came from a document the golden set
// says should answer the question. That's DOCUMENT-level judgement — the
// coarser but reliable unit, since the debug payload identifies candidates by
// title + chunk index rather than a stable chunk id. See README §"What counts
// as a hit" for why this is the right granularity for a corpus this size.

/** @param relevance boolean[] in rank order (index 0 = top-ranked candidate). */
export function precisionAtK(relevance, k) {
  const top = relevance.slice(0, k);
  if (top.length === 0) return 0;
  return top.filter(Boolean).length / top.length;
}

/**
 * Recall needs the total number of relevant items that EXIST, which for
 * document-level judgement is the count of expected documents. We approximate
 * "found" as the number of distinct expected docs represented in the top k.
 */
export function recallAtK(foundDocs, expectedDocs) {
  if (expectedDocs.length === 0) return 1;
  const found = new Set(foundDocs);
  const hit = expectedDocs.filter((d) => found.has(d)).length;
  return hit / expectedDocs.length;
}

/** Reciprocal of the rank of the FIRST relevant result. 0 if none. */
export function reciprocalRank(relevance) {
  const i = relevance.findIndex(Boolean);
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Binary-relevance NDCG@k — rewards putting relevant results near the top. */
export function ndcgAtK(relevance, k) {
  const dcg = relevance
    .slice(0, k)
    .reduce((sum, rel, i) => sum + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  const idealCount = Math.min(relevance.filter(Boolean).length, k);
  const idcg = Array.from({ length: idealCount })
    .reduce((sum, _, i) => sum + 1 / Math.log2(i + 2), 0);
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Did at least one relevant result appear in the top k? */
export function hitAtK(relevance, k) {
  return relevance.slice(0, k).some(Boolean);
}

export function mean(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

/**
 * Citation validity WITHOUT an LLM judge: every [n] the answer cites must refer
 * to an excerpt that was actually supplied. Catches the specific failure where
 * a model invents a source number. It does NOT verify the cited text supports
 * the claim — that needs the LLM judge (see run-eval.mjs --judge).
 */
export function citationValidity(answerText, excerptCount) {
  const cited = [...String(answerText ?? '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const unique = [...new Set(cited)];
  if (unique.length === 0) return { cited: [], invalid: [], validRatio: null, anyCitation: false };
  const invalid = unique.filter((n) => n < 1 || n > excerptCount);
  return {
    cited: unique,
    invalid,
    validRatio: (unique.length - invalid.length) / unique.length,
    anyCitation: true,
  };
}

/**
 * The app's refusal sentence, defined in rag-answer/index.ts, is "...do not
 * contain information about this." — but the model doesn't always complete
 * it verbatim; it sometimes paraphrases the trailing noun phrase (e.g. "...
 * about a board meeting from March 2019"). Match the stable prefix only.
 */
export const REFUSAL_MARKER = 'do not contain information about';

export function isRefusal(answerText) {
  return String(answerText ?? '').toLowerCase().includes(REFUSAL_MARKER);
}

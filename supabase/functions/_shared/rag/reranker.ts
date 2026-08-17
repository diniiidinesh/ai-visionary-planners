// Reranking via Voyage AI's dedicated cross-encoder reranker.
// Unlike embeddings (which score query and passage independently, then compare
// vectors), a reranker reads the query and each passage TOGETHER in one forward
// pass, so it can catch relevance signals cosine similarity misses. Used as a
// second stage after retrieval: cheap embedding search gets a wide candidate set,
// the reranker re-scores and narrows it before generation.
export const RERANK_MODEL = 'rerank-2.5';
const VOYAGE_RERANK_URL = 'https://api.voyageai.com/v1/rerank';

export interface RerankedItem {
  index: number; // position in the input `documents` array
  relevanceScore: number; // 0-1, Voyage's cross-encoder score
}

export class RerankError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Reranks `documents` against `query`, returning the top `topK` by relevance,
 * best first. Returns null if VOYAGE_API_KEY isn't configured, so callers can
 * fall back to the pre-rerank (hybrid search) order without special-casing.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK: number
): Promise<RerankedItem[] | null> {
  const apiKey = Deno.env.get('VOYAGE_API_KEY');
  if (!apiKey) return null;
  if (documents.length === 0) return [];

  const response = await fetch(VOYAGE_RERANK_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      documents,
      model: RERANK_MODEL,
      top_k: topK,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Voyage rerank failed [${response.status}]: ${body}`);
    if (response.status === 429) throw new RerankError('Rate limited by Voyage. Please retry shortly.', 429);
    throw new RerankError(`Rerank request failed: ${body}`, response.status);
  }

  const json = await response.json();
  return (json.data as any[]).map((d) => ({
    index: d.index,
    relevanceScore: d.relevance_score,
  }));
}

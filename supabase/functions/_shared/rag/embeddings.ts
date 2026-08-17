// Two embedding spaces live side by side so Voyage can be A/B'd against OpenAI
// without discarding the existing index:
//   'openai' -> Lovable AI Gateway, text-embedding-3-large, 3072 dims  (column `embedding`)
//   'voyage' -> Voyage API, voyage-3-large @ 1024 dims                 (column `embedding_voyage`)
// Vectors from different models are NOT comparable — never mix them in one search.
export type EmbeddingSpace = 'openai' | 'voyage';
/** Voyage distinguishes indexing from searching; it measurably improves retrieval. */
export type EmbeddingInputType = 'document' | 'query';

export const EMBEDDING_MODEL = 'openai/text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 3072;

export const VOYAGE_EMBEDDING_MODEL = 'voyage-3-large';
export const VOYAGE_EMBEDDING_DIMENSIONS = 1024;

const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MAX_BATCH = 100;
// Voyage accepts up to 1000 inputs but caps total tokens per request (120k for
// voyage-3-large). Chars/4 approximates tokens; stay well under the ceiling.
const VOYAGE_MAX_BATCH = 96;
const VOYAGE_MAX_BATCH_CHARS = 300_000;

export function modelFor(space: EmbeddingSpace): string {
  return space === 'voyage' ? VOYAGE_EMBEDDING_MODEL : EMBEDDING_MODEL;
}

export function dimensionsFor(space: EmbeddingSpace): number {
  return space === 'voyage' ? VOYAGE_EMBEDDING_DIMENSIONS : EMBEDDING_DIMENSIONS;
}

export function voyageConfigured(): boolean {
  return !!Deno.env.get('VOYAGE_API_KEY');
}

export class EmbeddingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function embedBatchOpenAI(inputs: string[]): Promise<number[][]> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new EmbeddingError('LOVABLE_API_KEY is not configured', 401);

  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Embedding request failed [${response.status}]: ${body}`);
    if (response.status === 429) throw new EmbeddingError('Rate limited by the AI gateway. Please retry shortly.', 429);
    if (response.status === 402) throw new EmbeddingError('AI credits exhausted. Please top up to continue indexing.', 402);
    throw new EmbeddingError(`Embedding request failed: ${body}`, response.status);
  }

  const json = await response.json();
  const sorted = [...json.data].sort((a: any, b: any) => a.index - b.index);
  return sorted.map((d: any) => d.embedding as number[]);
}

async function embedBatchVoyage(inputs: string[], inputType: EmbeddingInputType): Promise<number[][]> {
  const apiKey = Deno.env.get('VOYAGE_API_KEY');
  if (!apiKey) throw new EmbeddingError('VOYAGE_API_KEY is not configured', 401);

  const response = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOYAGE_EMBEDDING_MODEL,
      input: inputs,
      input_type: inputType,
      output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
      truncation: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`Voyage embedding request failed [${response.status}]: ${body}`);
    if (response.status === 429) throw new EmbeddingError('Rate limited by Voyage. Please retry shortly.', 429);
    throw new EmbeddingError(`Voyage embedding request failed: ${body}`, response.status);
  }

  const json = await response.json();
  const sorted = [...json.data].sort((a: any, b: any) => a.index - b.index);
  return sorted.map((d: any) => d.embedding as number[]);
}

/** Splits inputs into batches respecting both the item and character budgets. */
function batches(texts: string[], maxItems: number, maxChars: number): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let chars = 0;
  for (const t of texts) {
    if (current.length > 0 && (current.length >= maxItems || chars + t.length > maxChars)) {
      out.push(current);
      current = [];
      chars = 0;
    }
    current.push(t);
    chars += t.length;
  }
  if (current.length) out.push(current);
  return out;
}

/** Embeds any number of inputs in the given space, batching to the provider limit. */
export async function embedTexts(
  texts: string[],
  space: EmbeddingSpace = 'openai',
  inputType: EmbeddingInputType = 'document'
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];
  if (space === 'voyage') {
    for (const batch of batches(texts, VOYAGE_MAX_BATCH, VOYAGE_MAX_BATCH_CHARS)) {
      out.push(...await embedBatchVoyage(batch, inputType));
    }
  } else {
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      out.push(...await embedBatchOpenAI(texts.slice(i, i + MAX_BATCH)));
    }
  }
  return out;
}

export async function embedQuery(text: string, space: EmbeddingSpace = 'openai'): Promise<number[]> {
  const [vector] = await embedTexts([text], space, 'query');
  return vector;
}

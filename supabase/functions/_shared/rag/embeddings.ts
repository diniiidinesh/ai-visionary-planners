// Embeddings via the Lovable AI Gateway (OpenAI-compatible /embeddings).
export const EMBEDDING_MODEL = 'google/gemini-embedding-2';
export const EMBEDDING_DIMENSIONS = 3072;
const GATEWAY_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
const MAX_BATCH = 100;

export class EmbeddingError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function embedBatch(inputs: string[]): Promise<number[][]> {
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

/** Embeds any number of inputs, batching to the provider limit. */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    out.push(...await embedBatch(texts.slice(i, i + MAX_BATCH)));
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vector] = await embedTexts([text]);
  return vector;
}

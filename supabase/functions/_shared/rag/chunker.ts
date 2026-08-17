export interface TextChunk {
  index: number;
  content: string;
}

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;

/** Splits text on paragraph boundaries into overlapping chunks. */
export function chunkText(raw: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): TextChunk[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return [];

  const paragraphs = text.split(/\n\n+/);
  const pieces: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= chunkSize) {
      pieces.push(paragraph);
      continue;
    }
    // Hard-split oversized paragraphs on sentence boundaries.
    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    let buffer = '';
    for (const sentence of sentences) {
      if ((buffer + ' ' + sentence).trim().length > chunkSize) {
        if (buffer) pieces.push(buffer.trim());
        buffer = sentence.length > chunkSize ? '' : sentence;
        if (sentence.length > chunkSize) {
          for (let i = 0; i < sentence.length; i += chunkSize) {
            pieces.push(sentence.slice(i, i + chunkSize));
          }
        }
      } else {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
    }
    if (buffer.trim()) pieces.push(buffer.trim());
  }

  // Pack pieces into chunks with overlap carried from the previous chunk.
  const chunks: TextChunk[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current && (current.length + piece.length + 2) > chunkSize) {
      chunks.push({ index: chunks.length, content: current.trim() });
      const tail = current.slice(-overlap);
      current = `${tail}\n\n${piece}`;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push({ index: chunks.length, content: current.trim() });

  return chunks;
}

export async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

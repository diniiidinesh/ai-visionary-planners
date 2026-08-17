export interface TextChunk {
  index: number;
  content: string;
  heading: string | null;
}

export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;
/** Bumped whenever chunking/metadata behaviour changes, so old rows can be detected as stale. */
export const METADATA_VERSION = 3;

/**
 * Cuts a long string at whitespace instead of mid-word.
 * Returns pieces no longer than `size`, each ending on a word boundary when one
 * exists in the last 20% of the window.
 */
function splitOnWordBoundaries(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const cut = window.lastIndexOf(' ');
    const at = cut > size * 0.8 ? cut : size;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trimStart();
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

/**
 * Tail of the previous chunk reused as overlap, snapped to a clean boundary:
 * prefer the start of a sentence, else the start of a word — never mid-word.
 */
function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return '';
  const tail = text.slice(-overlap);
  if (tail.length === text.length) return tail.trim();

  const sentenceStart = tail.search(/(?<=[.!?])\s+\S/);
  if (sentenceStart !== -1 && tail.length - sentenceStart > overlap * 0.3) {
    return tail.slice(sentenceStart).trim();
  }
  const wordStart = tail.search(/\s\S/);
  if (wordStart !== -1) return tail.slice(wordStart + 1).trim();
  return '';
}

interface Piece {
  text: string;
  heading: string | null;
  isTable: boolean;
}

function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^(slide\s+\d+)$/i.test(trimmed)) return true;
  if (/[.!?,;:]$/.test(trimmed)) return false;
  // Short, capitalised, standalone line -> treat as a section heading.
  return /^[A-Z0-9]/.test(trimmed) && trimmed.split(/\s+/).length <= 12;
}

function cleanHeading(line: string): string {
  return line.trim().replace(/^#{1,6}\s+/, '').slice(0, 120);
}

function isTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

/** Splits a markdown table into row groups that fit the size budget, repeating the header. */
function splitTable(lines: string[], chunkSize: number): string[] {
  const joined = lines.join('\n');
  if (joined.length <= chunkSize) return [joined];

  const header = lines.slice(0, Math.min(2, lines.length));
  const headerText = header.join('\n');
  const body = lines.slice(header.length);
  const out: string[] = [];
  let current = headerText;
  for (const row of body) {
    if (current.length + row.length + 1 > chunkSize && current !== headerText) {
      out.push(current);
      current = `${headerText}\n${row}`;
    } else {
      current = `${current}\n${row}`;
    }
  }
  if (current !== headerText) out.push(current);
  return out;
}

/** Breaks raw text into heading-aware pieces, keeping markdown tables intact. */
function toPieces(text: string, chunkSize: number): Piece[] {
  const pieces: Piece[] = [];
  let heading: string | null = null;

  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');

    // Table block: keep whole (or split by rows with a repeated header).
    if (lines.filter(isTableLine).length >= 2) {
      for (const part of splitTable(lines, chunkSize)) {
        pieces.push({ text: part, heading, isTable: true });
      }
      continue;
    }

    if (lines.length === 1 && isHeadingLine(lines[0])) {
      heading = cleanHeading(lines[0]);
      pieces.push({ text: lines[0].trim(), heading, isTable: false });
      continue;
    }

    if (block.length <= chunkSize) {
      pieces.push({ text: block.trim(), heading, isTable: false });
      continue;
    }

    // Oversized paragraph -> split on sentence boundaries, then hard-split monsters.
    const sentences = block.split(/(?<=[.!?])\s+/);
    let buffer = '';
    for (const sentence of sentences) {
      if (sentence.length > chunkSize) {
        if (buffer.trim()) { pieces.push({ text: buffer.trim(), heading, isTable: false }); buffer = ''; }
        for (const part of splitOnWordBoundaries(sentence, chunkSize)) {
          pieces.push({ text: part, heading, isTable: false });
        }
        continue;
      }
      if ((buffer + ' ' + sentence).trim().length > chunkSize) {
        if (buffer.trim()) pieces.push({ text: buffer.trim(), heading, isTable: false });
        buffer = sentence;
      } else {
        buffer = buffer ? `${buffer} ${sentence}` : sentence;
      }
    }
    if (buffer.trim()) pieces.push({ text: buffer.trim(), heading, isTable: false });
  }

  return pieces.filter((p) => p.text.length > 0);
}

/** Splits text into overlapping, heading-tagged chunks on natural boundaries. */
export function chunkText(raw: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): TextChunk[] {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return [];

  const pieces = toPieces(text, chunkSize);
  const chunks: TextChunk[] = [];

  let current = '';
  let currentHeading: string | null = null;

  const flush = () => {
    if (current.trim()) chunks.push({ index: chunks.length, content: current.trim(), heading: currentHeading });
  };

  for (const piece of pieces) {
    const wouldOverflow = current && (current.length + piece.text.length + 2) > chunkSize;
    // Never merge a table into a chunk that already has other content.
    const tableNeedsOwnChunk = piece.isTable && current.length > 0;

    if (wouldOverflow || tableNeedsOwnChunk) {
      flush();
      const tail = piece.isTable ? '' : overlapTail(current, overlap);
      current = tail ? `${tail}\n\n${piece.text}` : piece.text;
      currentHeading = piece.heading;
    } else {
      if (!current) currentHeading = piece.heading;
      current = current ? `${current}\n\n${piece.text}` : piece.text;
    }
  }
  flush();

  return chunks;
}

/** Text actually sent to the embedding model: context prefix + chunk body. */
export function embeddingInput(title: string, heading: string | null, content: string): string {
  const prefix = heading ? `${title} > ${heading}` : title;
  return `${prefix}:\n${content}`;
}

export async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

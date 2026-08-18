// Verbatim port of supabase/functions/_shared/rag/chunker.ts with types stripped.
export const CHUNK_SIZE = 1200;
export const CHUNK_OVERLAP = 200;

function isHeadingLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/^#{1,6}\s+\S/.test(trimmed)) return true;
  if (/^(slide\s+\d+)$/i.test(trimmed)) return true;
  if (/[.!?,;:]$/.test(trimmed)) return false;
  return /^[A-Z0-9]/.test(trimmed) && trimmed.split(/\s+/).length <= 12;
}

function cleanHeading(line) {
  return line.trim().replace(/^#{1,6}\s+/, '').slice(0, 120);
}

function isTableLine(line) {
  return /^\s*\|.*\|\s*$/.test(line);
}

function splitTable(lines, chunkSize) {
  const joined = lines.join('\n');
  if (joined.length <= chunkSize) return [joined];
  const header = lines.slice(0, Math.min(2, lines.length));
  const headerText = header.join('\n');
  const body = lines.slice(header.length);
  const out = [];
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

function toPieces(text, chunkSize) {
  const pieces = [];
  let heading = null;
  const blocks = text.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n');
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
    const sentences = block.split(/(?<=[.!?])\s+/);
    let buffer = '';
    for (const sentence of sentences) {
      if (sentence.length > chunkSize) {
        if (buffer.trim()) { pieces.push({ text: buffer.trim(), heading, isTable: false }); buffer = ''; }
        for (let i = 0; i < sentence.length; i += chunkSize) {
          pieces.push({ text: sentence.slice(i, i + chunkSize), heading, isTable: false });
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

export function chunkText(raw, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const text = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return [];
  const pieces = toPieces(text, chunkSize);
  const chunks = [];
  let current = '';
  let currentHeading = null;
  const flush = () => {
    if (current.trim()) chunks.push({ index: chunks.length, content: current.trim(), heading: currentHeading });
  };
  for (const piece of pieces) {
    const wouldOverflow = current && (current.length + piece.text.length + 2) > chunkSize;
    const tableNeedsOwnChunk = piece.isTable && current.length > 0;
    if (wouldOverflow || tableNeedsOwnChunk) {
      flush();
      const tail = piece.isTable ? '' : current.slice(-overlap);
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

export { isHeadingLine, toPieces };

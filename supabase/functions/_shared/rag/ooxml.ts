// Text extraction for uploaded Microsoft Office files (.docx / .xlsx / .pptx).
// These are ZIP archives of XML parts, so we unzip in memory and pull the text runs.
import { unzipSync, strFromU8 } from 'https://esm.sh/fflate@0.8.2';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const OOXML_MIME_TYPES = [DOCX_MIME, XLSX_MIME, PPTX_MIME];

// Legacy binary Office formats cannot be parsed without a heavy converter.
export const UNSUPPORTED_LEGACY_MIME_TYPES = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
];

export function isOoxml(mimeType: string): boolean {
  return OOXML_MIME_TYPES.includes(mimeType);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Strips XML tags, turning paragraph/row/break markers into newlines. */
function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<(w:br|w:cr)[^>]*\/>/g, '\n')
      .replace(/<\/(w:p|a:p|w:tr)>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sortedSlideNames(names: string[]): string[] {
  return names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      const nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
}

/** Extracts plain text from a .docx / .xlsx / .pptx buffer. */
export function extractOoxmlText(buffer: Uint8Array, mimeType: string): string {
  const files = unzipSync(buffer);
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  if (mimeType === DOCX_MIME) {
    const parts = [read('word/document.xml')];
    // Headers/footers rarely matter, but footnotes and endnotes often do.
    for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
      if (files[name]) parts.push(read(name));
    }
    return xmlToText(parts.join('\n'));
  }

  if (mimeType === PPTX_MIME) {
    const slides = sortedSlideNames(Object.keys(files));
    return slides
      .map((name, i) => `Slide ${i + 1}\n${xmlToText(read(name))}`)
      .filter((s) => s.trim().length > 8)
      .join('\n\n')
      .trim();
  }

  if (mimeType === XLSX_MIME) {
    // Shared strings hold most cell text; numeric cells live inline in the sheets.
    const shared: string[] = [];
    const sharedXml = read('xl/sharedStrings.xml');
    for (const match of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(xmlToText(match[1]).replace(/\n+/g, ' ').trim());
    }

    const sheetNames = Object.keys(files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();

    const out: string[] = [];
    for (const sheetName of sheetNames) {
      const xml = read(sheetName);
      const rows: string[] = [];
      for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells: string[] = [];
        for (const cellMatch of rowMatch[1].matchAll(/<c[^>]*?(?:\st="(\w+)")?[^>]*>([\s\S]*?)<\/c>/g)) {
          const type = cellMatch[1];
          const inner = cellMatch[2];
          const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          if (type === 's' && valueMatch) {
            cells.push(shared[Number(valueMatch[1])] ?? '');
          } else if (type === 'inlineStr') {
            cells.push(xmlToText(inner).replace(/\n+/g, ' ').trim());
          } else if (valueMatch) {
            cells.push(decodeEntities(valueMatch[1]));
          }
        }
        if (cells.some((c) => c !== '')) rows.push(cells.join(', '));
      }
      if (rows.length) out.push(rows.join('\n'));
    }
    return out.join('\n\n').trim();
  }

  return '';
}

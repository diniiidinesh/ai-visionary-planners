// Text extraction for uploaded Microsoft Office files (.docx / .xlsx / .pptx).
// These are ZIP archives of XML parts, so we unzip in memory and pull the text runs.
// Tables are converted to markdown pipe-tables so row/column relationships survive
// into the chunk (plain flattening loses which value belongs to which column).
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

function cellText(xml: string): string {
  return xmlToText(xml).replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Renders a matrix of cells as a markdown pipe-table. */
export function rowsToMarkdown(rows: string[][]): string {
  const clean = rows.filter((r) => r.some((c) => c !== ''));
  if (clean.length === 0) return '';
  const width = Math.max(...clean.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const [header, ...body] = clean.map(pad);
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}

/**
 * Replaces every table block in an XML part with a markdown table.
 * Tables are swapped for placeholders first so the generic tag-stripper
 * does not mangle the markdown we just built.
 */
function extractWithTables(
  xml: string,
  tableTag: string,
  rowTag: string,
  cellTag: string,
): string {
  const tables: string[] = [];
  const tableRe = new RegExp(`<${tableTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tableTag}>`, 'g');
  const rowRe = new RegExp(`<${rowTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${rowTag}>`, 'g');
  const cellRe = new RegExp(`<${cellTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${cellTag}>`, 'g');

  const withPlaceholders = xml.replace(tableRe, (_full, inner: string) => {
    const rows: string[][] = [];
    for (const rowMatch of inner.matchAll(rowRe)) {
      const cells: string[] = [];
      for (const cell of rowMatch[1].matchAll(cellRe)) cells.push(cellText(cell[1]));
      rows.push(cells);
    }
    const markdown = rowsToMarkdown(rows);
    if (!markdown) return '';
    tables.push(markdown);
    return `<w:p>@@TABLE_${tables.length - 1}@@</w:p>`;
  });

  let text = xmlToText(withPlaceholders);
  text = text.replace(/@@TABLE_(\d+)@@/g, (_m, i) => `\n\n${tables[Number(i)]}\n\n`);
  return text.replace(/\n{3,}/g, '\n\n').trim();
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

/** Column letter from an A1-style cell reference. */
function columnOf(ref: string): string {
  return (ref.match(/^([A-Z]+)/) ?? ['', ''])[1];
}

/** Extracts plain text from a .docx / .xlsx / .pptx buffer. */
export function extractOoxmlText(buffer: Uint8Array, mimeType: string): string {
  const files = unzipSync(buffer);
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : '');

  if (mimeType === DOCX_MIME) {
    const parts = [extractWithTables(read('word/document.xml'), 'w:tbl', 'w:tr', 'w:tc')];
    // Headers/footers rarely matter, but footnotes and endnotes often do.
    for (const name of ['word/footnotes.xml', 'word/endnotes.xml']) {
      if (files[name]) parts.push(xmlToText(read(name)));
    }
    return parts.filter(Boolean).join('\n\n').trim();
  }

  if (mimeType === PPTX_MIME) {
    const slides = sortedSlideNames(Object.keys(files));
    return slides
      .map((name, i) => `Slide ${i + 1}\n\n${extractWithTables(read(name), 'a:tbl', 'a:tr', 'a:tc')}`)
      .filter((s) => s.trim().length > 12)
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

    // Sheet display names, so chunks say which tab they came from.
    const sheetLabels = new Map<string, string>();
    const workbookXml = read('xl/workbook.xml');
    let sheetOrdinal = 0;
    for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*\/>/g)) {
      sheetOrdinal++;
      sheetLabels.set(`sheet${sheetOrdinal}`, decodeEntities(m[1]));
    }

    const sheetNames = Object.keys(files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));

    const out: string[] = [];
    for (const sheetName of sheetNames) {
      const xml = read(sheetName);
      const rows: string[][] = [];
      const columns = new Set<string>();
      const parsedRows: Array<Map<string, string>> = [];

      for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const cells = new Map<string, string>();
        for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
          const attrs = cellMatch[1];
          const inner = cellMatch[2];
          const ref = (attrs.match(/r="([A-Z]+\d+)"/) ?? [])[1] ?? '';
          const type = (attrs.match(/t="(\w+)"/) ?? [])[1];
          const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
          let value = '';
          if (type === 's' && valueMatch) value = shared[Number(valueMatch[1])] ?? '';
          else if (type === 'inlineStr') value = xmlToText(inner).replace(/\n+/g, ' ').trim();
          else if (valueMatch) value = decodeEntities(valueMatch[1]);
          if (value !== '') {
            const col = columnOf(ref);
            cells.set(col, value.replace(/\|/g, '\\|'));
            columns.add(col);
          }
        }
        if (cells.size) parsedRows.push(cells);
      }

      if (!parsedRows.length) continue;

      // Align every row to the same column set so the markdown grid stays square.
      const ordered = Array.from(columns).sort((a, b) =>
        a.length === b.length ? a.localeCompare(b) : a.length - b.length
      );
      for (const row of parsedRows) rows.push(ordered.map((c) => row.get(c) ?? ''));

      const key = sheetName.match(/(sheet\d+)\.xml$/)![1];
      const label = sheetLabels.get(key) ?? key;
      const table = rowsToMarkdown(rows);
      if (table) out.push(`${label}\n\n${table}`);
    }
    return out.join('\n\n').trim();
  }

  return '';
}

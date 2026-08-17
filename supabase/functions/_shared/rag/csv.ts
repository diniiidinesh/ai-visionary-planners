import { rowsToMarkdown } from './ooxml.ts';

/** Parses CSV (quoted fields supported) into rows. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Converts CSV (e.g. an exported Google Sheet) into a markdown pipe-table. */
export function csvToMarkdown(text: string): string {
  const rows = parseCsv(text).map((r) => r.map((c) => c.trim().replace(/\|/g, '\\|')));
  const markdown = rowsToMarkdown(rows);
  return markdown || text;
}

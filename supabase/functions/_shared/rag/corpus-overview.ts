// Answering "what's actually in here?" from the catalog instead of the passages.
//
// Passage retrieval can't answer corpus-level questions: it returns the ~10
// best-matching chunks, capped at a few per document, so the model sees a
// handful of files and describes them as though they were the whole collection.
// The counts it would need are already sitting in `document_index` as structured
// data — one row per source file — so this path reads them directly and skips
// embedding, search and reranking entirely.
//
// Everything here goes through the caller's RLS-scoped client, so a profile can
// only ever describe the signed-in user's own corpus.

/** Rows read for the profile. Bounded so a huge corpus can't blow up the request. */
const PROFILE_ROW_LIMIT = 2000;
/** Documents named individually in the rendered context. */
const MAX_LISTED_DOCUMENTS = 100;
/** Distinct folders / file types listed before collapsing the tail into "other". */
const MAX_GROUPS = 12;

export interface CorpusDocument {
  sourceId: string;
  title: string;
  folderPath: string | null;
  fileType: string;
  chunkCount: number;
  modifiedTime: string | null;
  url: string | null;
}

export interface CorpusProfile {
  /** Exact count of catalog rows for this user, whatever their ingest status. */
  totalDocuments: number;
  indexedDocuments: number;
  totalChunks: number;
  byFileType: { label: string; count: number }[];
  byFolder: { label: string; count: number }[];
  byStatus: { label: string; count: number }[];
  oldestModified: string | null;
  newestModified: string | null;
  /** Indexed documents, largest first, capped at MAX_LISTED_DOCUMENTS. */
  documents: CorpusDocument[];
  listingTruncated: boolean;
  /** False when the corpus exceeds PROFILE_ROW_LIMIT, so breakdowns cover only part of it. */
  statsComplete: boolean;
}

const MIME_LABELS: Record<string, string> = {
  'application/vnd.google-apps.document': 'Google Doc',
  'application/vnd.google-apps.spreadsheet': 'Google Sheet',
  'application/vnd.google-apps.presentation': 'Google Slides',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint deck',
  'text/csv': 'CSV',
  'text/plain': 'Text file',
  'text/markdown': 'Markdown',
};

function fileTypeLabel(mimeType: unknown): string {
  if (typeof mimeType !== 'string' || !mimeType) return 'Unknown type';
  return MIME_LABELS[mimeType] ?? mimeType.split('/').pop() ?? mimeType;
}

/** Counts values, biggest first, collapsing everything past MAX_GROUPS into "other". */
function tally(values: string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);

  const sorted = [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length <= MAX_GROUPS) return sorted;
  const head = sorted.slice(0, MAX_GROUPS);
  const tail = sorted.slice(MAX_GROUPS).reduce((sum, g) => sum + g.count, 0);
  return [...head, { label: `other (${sorted.length - MAX_GROUPS} more)`, count: tail }];
}

/**
 * Reads the catalog and reduces it to a profile of the corpus.
 *
 * Totals come from an exact count so they stay correct no matter how large the
 * corpus is; the breakdowns and listing come from a bounded row read, and
 * `statsComplete` says which of the two you're looking at.
 */
export async function buildCorpusProfile(
  supabase: any,
  userId: string,
  sourceType = 'google_drive'
): Promise<CorpusProfile> {
  const { count: totalDocuments } = await supabase
    .from('document_index')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source_type', sourceType);

  const { data: rows, error } = await supabase
    .from('document_index')
    .select('source_id, title, folder_path, chunk_count, ingest_status, source_modified_time, full_url, metadata')
    .eq('user_id', userId)
    .eq('source_type', sourceType)
    .order('chunk_count', { ascending: false })
    .limit(PROFILE_ROW_LIMIT);

  if (error) throw new Error(`Failed to read the document catalog: ${error.message}`);

  const all = (rows ?? []) as any[];
  const indexed = all.filter((r) => r.ingest_status === 'indexed');

  const modifiedTimes = indexed
    .map((r) => r.source_modified_time)
    .filter((t): t is string => typeof t === 'string' && !!t)
    .sort();

  const documents: CorpusDocument[] = indexed.slice(0, MAX_LISTED_DOCUMENTS).map((r) => ({
    sourceId: r.source_id,
    title: r.title,
    folderPath: r.folder_path ?? null,
    fileType: fileTypeLabel(r.metadata?.mimeType),
    chunkCount: r.chunk_count ?? 0,
    modifiedTime: r.source_modified_time ?? null,
    url: r.full_url ?? null,
  }));

  return {
    totalDocuments: totalDocuments ?? all.length,
    indexedDocuments: indexed.length,
    totalChunks: indexed.reduce((sum, r) => sum + (r.chunk_count ?? 0), 0),
    byFileType: tally(indexed.map((r) => fileTypeLabel(r.metadata?.mimeType))),
    byFolder: tally(indexed.map((r) => r.folder_path || 'My Drive (root)')),
    byStatus: tally(all.map((r) => String(r.ingest_status ?? 'unknown'))),
    oldestModified: modifiedTimes[0] ?? null,
    newestModified: modifiedTimes[modifiedTimes.length - 1] ?? null,
    documents,
    listingTruncated: indexed.length > MAX_LISTED_DOCUMENTS,
    statsComplete: all.length < PROFILE_ROW_LIMIT,
  };
}

function dateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Renders the profile as grounded context for the answer model.
 *
 * The numbers here are query results, not estimates, so the model's job is to
 * present them — not to infer them. Where the picture is partial (a truncated
 * listing, a corpus past the row limit) the text says so outright, because the
 * failure this whole path exists to prevent is describing part of a collection
 * as though it were all of it.
 */
export function renderCorpusContext(profile: CorpusProfile): string {
  const lines: string[] = [];

  lines.push('CORPUS SUMMARY (exact counts from the document catalog):');
  lines.push(`- Documents in the catalog: ${profile.totalDocuments}`);
  lines.push(`- Successfully indexed and searchable: ${profile.indexedDocuments}`);
  lines.push(`- Total passages (chunks) indexed: ${profile.totalChunks}`);

  if (profile.oldestModified || profile.newestModified) {
    lines.push(
      `- Documents last modified between ${dateOnly(profile.oldestModified) ?? 'unknown'} and ${dateOnly(profile.newestModified) ?? 'unknown'}`
    );
  }

  if (profile.byStatus.length > 1) {
    lines.push('');
    lines.push('INGEST STATUS BREAKDOWN:');
    for (const s of profile.byStatus) lines.push(`- ${s.label}: ${s.count}`);
  }

  lines.push('');
  lines.push('BY FILE TYPE:');
  for (const t of profile.byFileType) lines.push(`- ${t.label}: ${t.count}`);

  lines.push('');
  lines.push('BY FOLDER:');
  for (const f of profile.byFolder) lines.push(`- ${f.label}: ${f.count}`);

  lines.push('');
  lines.push(
    profile.listingTruncated
      ? `DOCUMENT LISTING — the ${profile.documents.length} largest of ${profile.indexedDocuments} indexed documents (THIS LIST IS PARTIAL):`
      : `DOCUMENT LISTING — all ${profile.documents.length} indexed documents:`
  );
  for (const d of profile.documents) {
    const bits = [
      d.fileType,
      d.folderPath ? `in ${d.folderPath}` : null,
      `${d.chunkCount} passages`,
      dateOnly(d.modifiedTime) ? `modified ${dateOnly(d.modifiedTime)}` : null,
    ].filter(Boolean).join(', ');
    lines.push(`- "${d.title}" (${bits})`);
  }

  if (!profile.statsComplete) {
    lines.push('');
    lines.push(
      `NOTE: this corpus is larger than the ${PROFILE_ROW_LIMIT}-document profiling limit. The total document count above is exact, but the breakdowns and listing cover only part of the collection.`
    );
  }

  return lines.join('\n');
}

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
  /** Chunk total according to the catalog's own per-document bookkeeping. */
  catalogChunks: number;
  /** Chunk rows that actually exist and are actually searchable. Ground truth. */
  searchableChunks: number;
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
  /**
   * True when searchable chunks exist but the catalog doesn't account for them.
   *
   * The catalog gained its bookkeeping columns (`ingest_status`, `chunk_count`,
   * `folder_path`) in later migrations, which backfilled existing rows with
   * defaults — `ingest_status = 'pending'`, `chunk_count = 0`. So a document
   * indexed by an older build is fully searchable while its catalog row claims
   * it was never indexed. Reporting the catalog's view alone would tell that
   * user their Drive is empty when search plainly works, so the profile carries
   * both numbers and this flag says when they disagree.
   */
  catalogStale: boolean;
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

  // Ground truth for "how much is actually searchable", independent of whatever
  // the catalog's bookkeeping columns happen to say.
  const { count: searchableChunks } = await supabase
    .from('document_chunks')
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

  // Normally we list what the catalog calls indexed. When nothing is marked
  // indexed but chunks exist (a pre-bookkeeping catalog), listing the indexed
  // set would show the user an empty Drive they can visibly search — so fall
  // back to listing every catalog row and let the staleness note explain it.
  const listable = indexed.length > 0 ? indexed : all;

  const documents: CorpusDocument[] = listable.slice(0, MAX_LISTED_DOCUMENTS).map((r) => ({
    sourceId: r.source_id,
    title: r.title,
    folderPath: r.folder_path ?? null,
    fileType: fileTypeLabel(r.metadata?.mimeType),
    chunkCount: r.chunk_count ?? 0,
    modifiedTime: r.source_modified_time ?? null,
    url: r.full_url ?? null,
  }));

  const catalogChunks = indexed.reduce((sum, r) => sum + (r.chunk_count ?? 0), 0);
  const chunkRows = searchableChunks ?? 0;

  return {
    totalDocuments: totalDocuments ?? all.length,
    indexedDocuments: indexed.length,
    catalogChunks,
    searchableChunks: chunkRows,
    byFileType: tally(indexed.map((r) => fileTypeLabel(r.metadata?.mimeType))),
    byFolder: tally(indexed.map((r) => r.folder_path || '(folder not recorded)')),
    byStatus: tally(all.map((r) => String(r.ingest_status ?? 'unknown'))),
    oldestModified: modifiedTimes[0] ?? null,
    newestModified: modifiedTimes[modifiedTimes.length - 1] ?? null,
    documents,
    listingTruncated: listable.length > MAX_LISTED_DOCUMENTS,
    statsComplete: all.length < PROFILE_ROW_LIMIT,
    // Searchable content the catalog can't account for: rows written before the
    // bookkeeping columns existed report 'pending' / 0 chunks forever, until the
    // document is re-ingested.
    catalogStale: chunkRows > 0 && (indexed.length === 0 || catalogChunks === 0),
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

  lines.push('CORPUS SUMMARY (exact counts, queried live):');
  lines.push(`- Documents in the catalog: ${profile.totalDocuments}`);
  lines.push(`- Catalog rows marked successfully indexed: ${profile.indexedDocuments}`);
  lines.push(`- Searchable passages actually in the index: ${profile.searchableChunks}`);

  if (profile.catalogStale) {
    lines.push('');
    lines.push('IMPORTANT — THE CATALOG IS OUT OF DATE:');
    lines.push(
      `There are ${profile.searchableChunks} searchable passages in the index, but the catalog records only ${profile.indexedDocuments} document(s) as indexed and ${profile.catalogChunks} passage(s). These documents were indexed by an earlier version of the ingest pipeline that did not record per-document status, so the catalog understates what is actually searchable. Treat the ${profile.totalDocuments} catalog documents and ${profile.searchableChunks} passages as the real figures, say that per-document details (status, folders, sizes) are incomplete for these older documents, and recommend re-running the Drive index to refresh them.`
    );
  }

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
  const listedOf = profile.indexedDocuments > 0 ? profile.indexedDocuments : profile.totalDocuments;
  lines.push(
    profile.listingTruncated
      ? `DOCUMENT LISTING — the ${profile.documents.length} largest of ${listedOf} documents (THIS LIST IS PARTIAL):`
      : `DOCUMENT LISTING — all ${profile.documents.length} documents:`
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

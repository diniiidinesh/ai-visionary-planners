import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { getDriveAccessToken, DriveConnectionError, EXPORTABLE_MIME_TYPES, contentUrlFor } from '../_shared/drive/token.ts';
import { chunkText, hashContent, embeddingInput, CHUNK_SIZE, CHUNK_OVERLAP, METADATA_VERSION } from '../_shared/rag/chunker.ts';
import {
  embedTexts,
  EMBEDDING_MODEL,
  EmbeddingError,
  VOYAGE_EMBEDDING_MODEL,
  voyageConfigured,
} from '../_shared/rag/embeddings.ts';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';
import { extractOoxmlText, isOoxml, UNSUPPORTED_LEGACY_MIME_TYPES } from '../_shared/rag/ooxml.ts';
import { csvToMarkdown } from '../_shared/rag/csv.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Discovery is metadata-only and cheap, so it can page through many files at once.
const DISCOVER_PAGE_SIZE = 100;
// Extraction + embedding is CPU heavy: a single big PDF can exhaust the worker's
// budget, so exactly one document is processed per invocation.
const MAX_FILE_BYTES = 15 * 1024 * 1024;
// A file that kills the worker this many times is reported instead of retried forever.
const MAX_ATTEMPTS = 3;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode: 'discover' | 'process' = body.mode === 'process' ? 'process' : 'discover';
    const pageToken: string | undefined = body.pageToken || undefined;
    const fullResync: boolean = body.fullResync === true;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Authorization required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { accessToken } = await getDriveAccessToken(supabase, user.id);

    if (mode === 'discover') {
      return await discover(supabase, user.id, accessToken, pageToken, fullResync);
    }
    return await processNext(supabase, user.id, accessToken);
  } catch (error) {
    if (error instanceof DriveConnectionError) {
      return new Response(JSON.stringify({ error: error.message, needsConnection: true }), {
        status: error.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    console.error('Error in ingest-drive-documents:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Phase 1 — walk the Drive file list (metadata only) and queue everything that
 * needs (re)indexing as a `pending` row. No downloads, no parsing, no embedding.
 */
async function discover(
  supabase: any,
  userId: string,
  accessToken: string,
  pageToken: string | undefined,
  fullResync: boolean,
): Promise<Response> {
  const mimeFilter = EXPORTABLE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(' or ');
  const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
  listUrl.searchParams.set('q', `trashed=false and (${mimeFilter})`);
  listUrl.searchParams.set(
    'fields',
    'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents,owners(displayName,emailAddress),lastModifyingUser(displayName))'
  );
  listUrl.searchParams.set('pageSize', String(DISCOVER_PAGE_SIZE));
  listUrl.searchParams.set('orderBy', 'modifiedTime desc');
  listUrl.searchParams.set('supportsAllDrives', 'true');
  listUrl.searchParams.set('includeItemsFromAllDrives', 'true');
  listUrl.searchParams.set('corpora', 'allDrives');
  if (pageToken) listUrl.searchParams.set('pageToken', pageToken);

  const listResponse = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    console.error(`Drive list failed [${listResponse.status}]: ${errorText}`);
    return json({ error: 'Failed to list Google Drive files', details: errorText }, listResponse.status);
  }

  const listData = await listResponse.json();
  const files: any[] = listData.files || [];

  // Existing rows for this page, to decide what actually needs work.
  const ids = files.map((f) => f.id);
  const { data: existingRows } = ids.length
    ? await supabase
        .from('document_index')
        .select('source_id, ingest_status, source_modified_time, chunk_size, chunk_overlap, metadata_version, embedding_model')
        .eq('user_id', userId)
        .eq('source_type', 'google_drive')
        .in('source_id', ids)
    : { data: [] };
  const existing = new Map<string, any>((existingRows ?? []).map((r: any) => [r.source_id, r]));

  let queued = 0;
  let upToDate = 0;
  const rows: any[] = [];

  for (const file of files) {
    const prev = existing.get(file.id);
    const settingsMatch = prev
      && prev.chunk_size === CHUNK_SIZE
      && prev.chunk_overlap === CHUNK_OVERLAP
      && prev.metadata_version === METADATA_VERSION
      && prev.embedding_model === EMBEDDING_MODEL;
    const unchanged = !!prev?.source_modified_time && !!file.modifiedTime
      && new Date(prev.source_modified_time).getTime() === new Date(file.modifiedTime).getTime();

    if (!fullResync && settingsMatch && prev?.ingest_status === 'indexed' && unchanged) {
      upToDate++;
      continue;
    }

    rows.push({
      user_id: userId,
      source_type: 'google_drive',
      source_id: file.id,
      title: file.name,
      full_url: file.webViewLink,
      source_modified_time: file.modifiedTime ?? null,
      doc_created_time: file.createdTime ?? null,
      author: file.owners?.[0]?.displayName
        ?? file.owners?.[0]?.emailAddress
        ?? file.lastModifyingUser?.displayName
        ?? null,
      metadata: {
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        size: file.size ?? null,
        parentId: file.parents?.[0] ?? null,
      },
      ingest_status: 'pending',
      ingest_error: null,
      ingest_attempts: 0,
      updated_at: new Date().toISOString(),
    });
    queued++;
  }

  if (rows.length) {
    const { error } = await supabase
      .from('document_index')
      .upsert(rows, { onConflict: 'user_id,source_type,source_id' });
    if (error) throw new Error(`Failed to queue documents: ${error.message}`);
  }

  const nextPageToken = listData.nextPageToken ?? null;
  console.log(`🔎 Discovered ${files.length} files — queued ${queued}, already current ${upToDate}`);
  return json({
    mode: 'discover',
    seen: files.length,
    queued,
    upToDate,
    nextPageToken,
    done: !nextPageToken,
  });
}

/**
 * Phase 2 — take one queued document, extract, chunk, embed and store it.
 * Attempts are recorded before the heavy work starts, so a file that crashes
 * the worker is retried a couple of times and then reported as failed instead
 * of blocking every later document.
 */
async function processNext(supabase: any, userId: string, accessToken: string): Promise<Response> {
  // Anything that burned through its attempts is retired so the queue can drain.
  await supabase
    .from('document_index')
    .update({
      ingest_status: 'failed',
      ingest_error: 'This file repeatedly exceeded the indexing time limit and was skipped.',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('source_type', 'google_drive')
    .in('ingest_status', ['pending', 'processing'])
    .gte('ingest_attempts', MAX_ATTEMPTS);

  const { data: queue, error: queueError } = await supabase
    .from('document_index')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', 'google_drive')
    .in('ingest_status', ['pending', 'processing'])
    .lt('ingest_attempts', MAX_ATTEMPTS)
    .order('ingest_attempts', { ascending: true })
    .order('updated_at', { ascending: true })
    .limit(1);
  if (queueError) throw new Error(queueError.message);

  const { count: remaining } = await supabase
    .from('document_index')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('source_type', 'google_drive')
    .in('ingest_status', ['pending', 'processing'])
    .lt('ingest_attempts', MAX_ATTEMPTS);

  const row = queue?.[0];
  if (!row) {
    return json({ mode: 'process', done: true, remaining: 0, processed: 0, skipped: 0, failed: 0, chunksStored: 0 });
  }

  // Claim it (and count the attempt) BEFORE any heavy work.
  await supabase
    .from('document_index')
    .update({ ingest_status: 'processing', ingest_attempts: (row.ingest_attempts ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id);

  const file = {
    id: row.source_id,
    name: row.title,
    mimeType: row.metadata?.mimeType,
    webViewLink: row.full_url,
    modifiedTime: row.source_modified_time,
    size: row.metadata?.size ?? null,
  };
  const meta = {
    author: row.author ?? null,
    createdTime: row.doc_created_time ?? null,
    folderPath: row.folder_path ?? await resolveFolderPath(row.metadata?.parentId, accessToken, new Map()),
  };

  const result = { processed: 0, skipped: 0, failed: 0, chunksStored: 0 };

  try {
    if (UNSUPPORTED_LEGACY_MIME_TYPES.includes(file.mimeType)) {
      await recordStatus(supabase, userId, file, meta, 'skipped_unsupported', 0, null,
        'Legacy Office format (.doc/.xls/.ppt). Save it as .docx/.xlsx/.pptx or a Google Doc to index it.');
      result.skipped++;
      return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
    }

    if (file.size && Number(file.size) > MAX_FILE_BYTES) {
      await recordStatus(supabase, userId, file, meta, 'skipped_too_large', 0, null, 'File too large to index');
      result.skipped++;
      return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
    }

    const contentUrl = new URL(contentUrlFor(file.id, file.mimeType));
    contentUrl.searchParams.set('supportsAllDrives', 'true');
    const contentResponse = await fetch(contentUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!contentResponse.ok) {
      const errorText = await contentResponse.text();
      console.error(`Export failed for ${file.name} [${contentResponse.status}]: ${errorText}`);
      await recordStatus(supabase, userId, file, meta, 'failed', 0, null, `Export failed (${contentResponse.status})`);
      result.failed++;
      return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
    }

    let text: string;
    if (file.mimeType === 'application/pdf') {
      const buffer = new Uint8Array(await contentResponse.arrayBuffer());
      const pdf = await getDocumentProxy(buffer);
      const { text: pdfText } = await extractText(pdf, { mergePages: true });
      text = String(pdfText).replace(/\u0000/g, '').trim();
    } else if (isOoxml(file.mimeType)) {
      const buffer = new Uint8Array(await contentResponse.arrayBuffer());
      text = extractOoxmlText(buffer, file.mimeType).replace(/\u0000/g, '').trim();
    } else if (
      file.mimeType === 'application/vnd.google-apps.spreadsheet' ||
      file.mimeType === 'text/csv'
    ) {
      text = csvToMarkdown((await contentResponse.text()).replace(/\u0000/g, '')).trim();
    } else {
      text = (await contentResponse.text()).replace(/\u0000/g, '').trim();
    }

    if (!text || text.length < 30) {
      await recordStatus(supabase, userId, file, meta, 'skipped_no_text', 0, null, 'No extractable text');
      result.skipped++;
      return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
    }

    const contentHash = await hashContent(text);
    const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
    const inputs = chunks.map((c) => embeddingInput(file.name, c.heading, c.content));
    const embeddings = await embedTexts(inputs, 'openai');
    const withVoyage = voyageConfigured();
    const voyageEmbeddings = withVoyage ? await embedTexts(inputs, 'voyage', 'document') : null;

    await supabase
      .from('document_chunks')
      .delete()
      .eq('user_id', userId)
      .eq('source_type', 'google_drive')
      .eq('source_id', file.id);

    const rows = chunks.map((chunk, i) => ({
      user_id: userId,
      source_type: 'google_drive',
      source_id: file.id,
      title: file.name,
      full_url: file.webViewLink,
      mime_type: file.mimeType,
      chunk_index: chunk.index,
      heading: chunk.heading,
      content: chunk.content,
      content_hash: contentHash,
      embedding: JSON.stringify(embeddings[i]),
      embedding_model: EMBEDDING_MODEL,
      embedding_voyage: voyageEmbeddings ? JSON.stringify(voyageEmbeddings[i]) : null,
      embedding_voyage_model: voyageEmbeddings ? VOYAGE_EMBEDDING_MODEL : null,
      char_count: chunk.content.length,
      author: meta.author,
      doc_created_time: meta.createdTime,
      doc_modified_time: file.modifiedTime ?? null,
      folder_path: meta.folderPath,
      chunk_size: CHUNK_SIZE,
      chunk_overlap: CHUNK_OVERLAP,
      metadata_version: METADATA_VERSION,
    }));

    for (let i = 0; i < rows.length; i += 50) {
      const { error: insertError } = await supabase.from('document_chunks').insert(rows.slice(i, i + 50));
      if (insertError) throw new Error(insertError.message);
    }

    await recordStatus(supabase, userId, file, meta, 'indexed', rows.length, contentHash, null, text.slice(0, 500));
    result.processed++;
    result.chunksStored += rows.length;
    console.log(`✅ Indexed "${file.name}" (${rows.length} chunks)`);
    return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
  } catch (fileError) {
    const message = fileError instanceof Error ? fileError.message : 'Unknown error';
    console.error(`❌ Failed to ingest ${file.name}:`, message);
    if (fileError instanceof EmbeddingError && (fileError.status === 402 || fileError.status === 429)) {
      // Give the file its attempt back — this failure is not the file's fault.
      await supabase
        .from('document_index')
        .update({ ingest_status: 'pending', ingest_attempts: row.ingest_attempts ?? 0 })
        .eq('id', row.id);
      return json({ error: fileError.message, status: fileError.status, done: false, remaining, ...result }, fileError.status);
    }
    await recordStatus(supabase, userId, file, meta, 'failed', 0, null, message);
    result.failed++;
    return json({ mode: 'process', done: false, remaining: Math.max((remaining ?? 1) - 1, 0), title: file.name, ...result });
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface FileMeta {
  author: string | null;
  createdTime: string | null;
  folderPath: string | null;
}

/** Walks up to 4 parent folders to build a readable path, caching lookups. */
async function resolveFolderPath(
  parentId: string | undefined | null,
  accessToken: string,
  cache: Map<string, string>,
): Promise<string | null> {
  if (!parentId) return null;
  const parts: string[] = [];
  let current: string | undefined = parentId;

  for (let depth = 0; depth < 4 && current; depth++) {
    if (cache.has(current)) {
      parts.unshift(cache.get(current)!);
      break;
    }
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${current}?fields=id,name,parents&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!response.ok) break;
      const folder = await response.json();
      cache.set(folder.id, folder.name);
      parts.unshift(folder.name);
      current = folder.parents?.[0];
    } catch (_e) {
      break;
    }
  }

  return parts.length ? parts.join(' / ') : null;
}

async function recordStatus(
  supabase: any,
  userId: string,
  file: any,
  meta: FileMeta,
  status: string,
  chunkCount: number,
  contentHash: string | null,
  errorMessage: string | null,
  snippet?: string,
) {
  const { error } = await supabase.from('document_index').upsert({
    user_id: userId,
    source_type: 'google_drive',
    source_id: file.id,
    title: file.name,
    full_url: file.webViewLink,
    content_snippet: snippet,
    metadata: { mimeType: file.mimeType, modifiedTime: file.modifiedTime, size: file.size ?? null },
    source_modified_time: file.modifiedTime,
    content_hash: contentHash,
    chunk_count: chunkCount,
    ingest_status: status,
    ingest_error: errorMessage,
    author: meta.author,
    doc_created_time: meta.createdTime,
    folder_path: meta.folderPath,
    embedding_model: EMBEDDING_MODEL,
    chunk_size: CHUNK_SIZE,
    chunk_overlap: CHUNK_OVERLAP,
    metadata_version: METADATA_VERSION,
    last_synced: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,source_type,source_id' });
  if (error) console.error('Failed to record document status:', error.message);
}

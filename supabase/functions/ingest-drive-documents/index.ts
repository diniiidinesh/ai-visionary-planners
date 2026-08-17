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

const FILES_PER_BATCH = 3;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
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

    // List a page of the user's indexable Drive files.
    const mimeFilter = EXPORTABLE_MIME_TYPES.map((m) => `mimeType='${m}'`).join(' or ');
    const q = `trashed=false and (${mimeFilter})`;
    const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
    listUrl.searchParams.set('q', q);
    listUrl.searchParams.set(
      'fields',
      'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,createdTime,size,parents,owners(displayName,emailAddress),lastModifyingUser(displayName))'
    );
    listUrl.searchParams.set('pageSize', String(FILES_PER_BATCH));
    listUrl.searchParams.set('orderBy', 'modifiedTime desc');
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken);

    const listResponse = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      console.error(`Drive list failed [${listResponse.status}]: ${errorText}`);
      return new Response(
        JSON.stringify({ error: 'Failed to list Google Drive files', details: errorText }),
        { status: listResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const listData = await listResponse.json();
    const files: any[] = listData.files || [];
    console.log(`📄 Ingest batch: ${files.length} files (fullResync=${fullResync})`);

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let chunksStored = 0;

    const folderCache = new Map<string, string>();

    for (const file of files) {
      try {
        const meta = {
          author: file.owners?.[0]?.displayName
            ?? file.owners?.[0]?.emailAddress
            ?? file.lastModifyingUser?.displayName
            ?? null,
          createdTime: file.createdTime ?? null,
          folderPath: await resolveFolderPath(file.parents?.[0], accessToken, folderCache),
        };

        // Skip unchanged files unless a full resync was requested, or the pipeline
        // settings (chunk size / overlap / metadata shape / embedding model) changed.
        const { data: existing } = await supabase
          .from('document_index')
          .select('source_modified_time, ingest_status, chunk_count, content_hash, chunk_size, chunk_overlap, metadata_version, embedding_model')
          .eq('user_id', user.id)
          .eq('source_type', 'google_drive')
          .eq('source_id', file.id)
          .maybeSingle();

        const settingsMatch = existing
          && existing.chunk_size === CHUNK_SIZE
          && existing.chunk_overlap === CHUNK_OVERLAP
          && existing.metadata_version === METADATA_VERSION
          && existing.embedding_model === EMBEDDING_MODEL;

        if (
          !fullResync && settingsMatch && existing?.ingest_status === 'indexed' &&
          existing.source_modified_time &&
          new Date(existing.source_modified_time).getTime() === new Date(file.modifiedTime).getTime()
        ) {
          skipped++;
          continue;
        }

        if (file.size && Number(file.size) > MAX_FILE_BYTES) {
          await recordStatus(supabase, user.id, file, meta, 'skipped_too_large', 0, null, 'File too large to index');
          skipped++;
          continue;
        }

        if (UNSUPPORTED_LEGACY_MIME_TYPES.includes(file.mimeType)) {
          await recordStatus(
            supabase, user.id, file, meta, 'skipped_unsupported', 0, null,
            'Legacy Office format (.doc/.xls/.ppt). Save it as .docx/.xlsx/.pptx or a Google Doc to index it.',
          );
          skipped++;
          continue;
        }

        const contentResponse = await fetch(contentUrlFor(file.id, file.mimeType), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!contentResponse.ok) {
          const errorText = await contentResponse.text();
          console.error(`Export failed for ${file.name} [${contentResponse.status}]: ${errorText}`);
          await recordStatus(supabase, user.id, file, meta, 'failed', 0, null, `Export failed (${contentResponse.status})`);
          failed++;
          continue;
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
          // Exported as CSV -> render as a markdown table so columns stay meaningful.
          text = csvToMarkdown((await contentResponse.text()).replace(/\u0000/g, '')).trim();
        } else {
          text = (await contentResponse.text()).replace(/\u0000/g, '').trim();
        }
        if (!text || text.length < 30) {
          // e.g. scanned PDFs with no extractable text
          await recordStatus(supabase, user.id, file, meta, 'skipped_no_text', 0, null, 'No extractable text');
          skipped++;
          continue;
        }

        const contentHash = await hashContent(text);
        if (!fullResync && settingsMatch && existing?.content_hash === contentHash && existing?.ingest_status === 'indexed') {
          await recordStatus(supabase, user.id, file, meta, 'indexed', existing.chunk_count ?? 0, contentHash, null);
          skipped++;
          continue;
        }

        const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
        // Embed title + heading alongside the body so the vector carries document context.
        const inputs = chunks.map((c) => embeddingInput(file.name, c.heading, c.content));
        const embeddings = await embedTexts(inputs, 'openai');
        // Dual-write the Voyage space when the key is present, so both indexes
        // stay in sync and can be compared on identical content.
        const withVoyage = voyageConfigured();
        const voyageEmbeddings = withVoyage ? await embedTexts(inputs, 'voyage', 'document') : null;

        // Replace previous chunks for this file.
        await supabase
          .from('document_chunks')
          .delete()
          .eq('user_id', user.id)
          .eq('source_type', 'google_drive')
          .eq('source_id', file.id);

        const rows = chunks.map((chunk, i) => ({
          user_id: user.id,
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

        await recordStatus(supabase, user.id, file, meta, 'indexed', rows.length, contentHash, null, text.slice(0, 500));
        chunksStored += rows.length;
        processed++;
        console.log(`✅ Indexed "${file.name}" (${rows.length} chunks)`);
      } catch (fileError) {
        const message = fileError instanceof Error ? fileError.message : 'Unknown error';
        console.error(`❌ Failed to ingest ${file.name}:`, message);
        if (fileError instanceof EmbeddingError && (fileError.status === 402 || fileError.status === 429)) {
          // Stop the whole batch — retrying more files will fail the same way.
          return new Response(
            JSON.stringify({ error: fileError.message, status: fileError.status, processed, skipped, failed, chunksStored, nextPageToken: pageToken ?? null, done: false }),
            { status: fileError.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        await recordStatus(supabase, user.id, file, { author: null, createdTime: null, folderPath: null }, 'failed', 0, null, message);
        failed++;
      }
    }

    const nextPageToken = listData.nextPageToken ?? null;

    return new Response(
      JSON.stringify({ processed, skipped, failed, chunksStored, nextPageToken, done: !nextPageToken }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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

interface FileMeta {
  author: string | null;
  createdTime: string | null;
  folderPath: string | null;
}

/** Walks up to 4 parent folders to build a readable path, caching lookups. */
async function resolveFolderPath(
  parentId: string | undefined,
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
        `https://www.googleapis.com/drive/v3/files/${current}?fields=id,name,parents`,
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
    metadata: { mimeType: file.mimeType, modifiedTime: file.modifiedTime },
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

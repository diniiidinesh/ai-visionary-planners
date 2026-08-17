import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';
import { getDriveAccessToken, DriveConnectionError, EXPORTABLE_MIME_TYPES, contentUrlFor } from '../_shared/drive/token.ts';
import { chunkText, hashContent } from '../_shared/rag/chunker.ts';
import { embedTexts, EMBEDDING_MODEL, EmbeddingError } from '../_shared/rag/embeddings.ts';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

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
    listUrl.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)');
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

    for (const file of files) {
      try {
        // Skip unchanged files unless a full resync was requested.
        const { data: existing } = await supabase
          .from('document_index')
          .select('source_modified_time, ingest_status, chunk_count, content_hash')
          .eq('user_id', user.id)
          .eq('source_type', 'google_drive')
          .eq('source_id', file.id)
          .maybeSingle();

        if (
          !fullResync && existing?.ingest_status === 'indexed' &&
          existing.source_modified_time &&
          new Date(existing.source_modified_time).getTime() === new Date(file.modifiedTime).getTime()
        ) {
          skipped++;
          continue;
        }

        if (file.size && Number(file.size) > MAX_FILE_BYTES) {
          await recordStatus(supabase, user.id, file, 'skipped_too_large', 0, null, 'File too large to index');
          skipped++;
          continue;
        }

        const contentResponse = await fetch(contentUrlFor(file.id, file.mimeType), {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!contentResponse.ok) {
          const errorText = await contentResponse.text();
          console.error(`Export failed for ${file.name} [${contentResponse.status}]: ${errorText}`);
          await recordStatus(supabase, user.id, file, 'failed', 0, null, `Export failed (${contentResponse.status})`);
          failed++;
          continue;
        }

        let text: string;
        if (file.mimeType === 'application/pdf') {
          const buffer = new Uint8Array(await contentResponse.arrayBuffer());
          const pdf = await getDocumentProxy(buffer);
          const { text: pdfText } = await extractText(pdf, { mergePages: true });
          text = String(pdfText).replace(/\u0000/g, '').trim();
        } else {
          text = (await contentResponse.text()).replace(/\u0000/g, '').trim();
        }
        if (!text || text.length < 30) {
          // e.g. scanned PDFs with no extractable text
          await recordStatus(supabase, user.id, file, 'skipped_no_text', 0, null, 'No extractable text');
          skipped++;
          continue;
        }

        const contentHash = await hashContent(text);
        if (!fullResync && existing?.content_hash === contentHash && existing?.ingest_status === 'indexed') {
          await recordStatus(supabase, user.id, file, 'indexed', existing.chunk_count ?? 0, contentHash, null);
          skipped++;
          continue;
        }

        const chunks = chunkText(text);
        const embeddings = await embedTexts(chunks.map((c) => c.content));

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
          content: chunk.content,
          content_hash: contentHash,
          embedding: JSON.stringify(embeddings[i]),
          embedding_model: EMBEDDING_MODEL,
          char_count: chunk.content.length,
        }));

        for (let i = 0; i < rows.length; i += 50) {
          const { error: insertError } = await supabase.from('document_chunks').insert(rows.slice(i, i + 50));
          if (insertError) throw new Error(insertError.message);
        }

        await recordStatus(supabase, user.id, file, 'indexed', rows.length, contentHash, null, text.slice(0, 500));
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
        await recordStatus(supabase, user.id, file, 'failed', 0, null, message);
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

async function recordStatus(
  supabase: any,
  userId: string,
  file: any,
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
    last_synced: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,source_type,source_id' });
  if (error) console.error('Failed to record document status:', error.message);
}

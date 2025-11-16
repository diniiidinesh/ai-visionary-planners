import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchResult {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  owners?: Array<{ displayName: string; emailAddress: string }>;
  relevanceScore: number;
  source: string;
  snippet?: string;
  content?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { searchVariations, documentTypes, entities, originalQuery, dateRange } = await req.json();

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Multi-source search for user ${user.id}`);
    console.log('Search variations:', searchVariations);

    // Get OAuth tokens for Google Drive
    const { data: tokens, error: tokenError } = await supabase.rpc(
      'get_oauth_tokens',
      { p_user_id: user.id, p_provider: 'google_drive' }
    );

    if (tokenError || !tokens) {
      console.error('Failed to get OAuth tokens:', tokenError);
      return new Response(
        JSON.stringify({ 
          error: 'No Google Drive connection found. Please connect your account first.',
          needsConnection: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const accessToken = tokens.access_token;

    // Build search query for Google Drive
    const queries = searchVariations || [originalQuery];
    const searchQuery = queries.join(' OR ');
    
    let mimeTypeQuery = '';
    if (documentTypes && documentTypes.length > 0) {
      const mimeTypes = documentTypes.map((type: string) => {
        switch(type.toLowerCase()) {
          case 'document': return "mimeType='application/vnd.google-apps.document'";
          case 'spreadsheet': return "mimeType='application/vnd.google-apps.spreadsheet'";
          case 'presentation': return "mimeType='application/vnd.google-apps.presentation'";
          case 'pdf': return "mimeType='application/pdf'";
          default: return '';
        }
      }).filter(Boolean);
      
      if (mimeTypes.length > 0) {
        mimeTypeQuery = ` and (${mimeTypes.join(' or ')})`;
      }
    }

    // Add date range filter
    let dateQuery = '';
    if (dateRange && dateRange !== 'all') {
      const now = new Date();
      let startDate: Date;
      
      switch(dateRange) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'quarter':
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case 'year':
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = now;
      }
      
      dateQuery = ` and modifiedTime > '${startDate.toISOString()}'`;
    }

    const fullQuery = `fullText contains '${searchQuery.replace(/'/g, "\\'")}'${mimeTypeQuery}${dateQuery}`;
    console.log('Google Drive query:', fullQuery);

    // Search Google Drive
    const driveResponse = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fullQuery)}&fields=files(id,name,mimeType,webViewLink,modifiedTime,owners)&pageSize=20`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
        },
      }
    );

    if (!driveResponse.ok) {
      const errorText = await driveResponse.text();
      console.error('Google Drive API error:', driveResponse.status, errorText);
      throw new Error(`Google Drive search failed: ${driveResponse.status}`);
    }

    const driveData = await driveResponse.json();
    const files = driveData.files || [];

    console.log(`Found ${files.length} files from Google Drive`);

    // Calculate relevance scores
    const results: SearchResult[] = files.map((file: any) => {
      let relevanceScore = 0;
      const fileName = file.name.toLowerCase();
      
      // Score based on entity matches
      if (entities) {
        entities.forEach((entity: string) => {
          if (fileName.includes(entity.toLowerCase())) {
            relevanceScore += 10;
          }
        });
      }
      
      // Score based on query variations
      queries.forEach((q: string) => {
        const queryWords = q.toLowerCase().split(' ');
        queryWords.forEach((word: string) => {
          if (word.length > 3 && fileName.includes(word)) {
            relevanceScore += 5;
          }
        });
      });
      
      // Boost recent documents
      const modifiedDate = new Date(file.modifiedTime);
      const daysSinceModified = (Date.now() - modifiedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceModified < 30) relevanceScore += 5;
      if (daysSinceModified < 7) relevanceScore += 5;

      return {
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        modifiedTime: file.modifiedTime,
        owners: file.owners,
        relevanceScore,
        source: 'google_drive',
      };
    });

    // Sort by relevance score
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Fetch content for top 12 results
    const topResults = results.slice(0, 12);
    console.log(`Fetching content for top ${topResults.length} documents...`);
    
    for (const result of topResults) {
      try {
        let contentUrl = '';
        
        // Determine export format based on MIME type
        if (result.mimeType === 'application/vnd.google-apps.document') {
          contentUrl = `https://www.googleapis.com/drive/v3/files/${result.id}/export?mimeType=text/plain`;
        } else if (result.mimeType === 'application/vnd.google-apps.spreadsheet') {
          contentUrl = `https://www.googleapis.com/drive/v3/files/${result.id}/export?mimeType=text/csv`;
        } else if (result.mimeType === 'application/vnd.google-apps.presentation') {
          contentUrl = `https://www.googleapis.com/drive/v3/files/${result.id}/export?mimeType=text/plain`;
        } else if (result.mimeType === 'application/pdf') {
          contentUrl = `https://www.googleapis.com/drive/v3/files/${result.id}?alt=media`;
        } else {
          // For other types, try to get as plain text
          contentUrl = `https://www.googleapis.com/drive/v3/files/${result.id}?alt=media`;
        }
        
        if (contentUrl) {
          const contentResponse = await fetch(contentUrl, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          });
          
          if (contentResponse.ok) {
            let content = await contentResponse.text();
            // Limit content to first 5000 characters
            if (content.length > 5000) {
              content = content.substring(0, 5000) + '... (truncated)';
            }
            result.content = content;
            console.log(`Fetched content for ${result.name} (${content.length} chars)`);
          }
        }
      } catch (contentError) {
        console.error(`Failed to fetch content for ${result.name}:`, contentError);
        // Continue without content for this document
      }
    }

    // Cache documents in document_index
    for (const result of results.slice(0, 15)) { // Cache top 15
      try {
        await supabase
          .from('document_index')
          .upsert({
            user_id: user.id,
            source_type: 'google_drive',
            source_id: result.id,
            title: result.name,
            full_url: result.webViewLink,
            metadata: {
              mimeType: result.mimeType,
              modifiedTime: result.modifiedTime,
              owners: result.owners,
            },
            last_synced: new Date().toISOString(),
          }, {
            onConflict: 'user_id,source_type,source_id'
          });
      } catch (cacheError) {
        console.error('Error caching document:', cacheError);
        // Continue even if caching fails
      }
    }

    console.log(`Returning ${results.length} ranked results`);

    return new Response(
      JSON.stringify({ 
        results: results.slice(0, 15),
        totalFound: results.length 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in multi-source-search function:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

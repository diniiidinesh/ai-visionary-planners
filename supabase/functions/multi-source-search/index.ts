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

    console.log(`🔍 Multi-source search for user ${user.id}`);
    console.log('📝 Search variations:', searchVariations);
    console.log('📅 Date range:', dateRange || 'all');
    console.log('📄 Document types:', documentTypes);

    // Get OAuth connection info including token expiry
    const { data: connectionData, error: connectionError } = await supabase
      .from('oauth_connections')
      .select('vault_secret_id, token_expiry')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .eq('is_connected', true)
      .single();

    if (connectionError || !connectionData) {
      console.error('❌ No Google Drive connection found:', connectionError);
      return new Response(
        JSON.stringify({ 
          error: 'No Google Drive connection found. Please connect your account first.',
          needsConnection: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get OAuth tokens from vault
    const { data: tokens, error: tokenError } = await supabase.rpc(
      'get_oauth_tokens',
      { p_user_id: user.id, p_provider: 'google_drive' }
    );

    if (tokenError || !tokens) {
      console.error('❌ Failed to get OAuth tokens:', tokenError);
      return new Response(
        JSON.stringify({ 
          error: 'Failed to retrieve access tokens. Please reconnect your Google Drive account.',
          needsConnection: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = tokens.access_token;
    const refreshToken = tokens.refresh_token;
    
    // Check if token is expired and refresh if needed
    const tokenExpiry = new Date(connectionData.token_expiry);
    const now = new Date();
    
    console.log(`⏰ Token expiry: ${tokenExpiry.toISOString()}`);
    console.log(`⏰ Current time: ${now.toISOString()}`);
    console.log(`⏰ Token expired: ${tokenExpiry <= now}`);
    
    if (tokenExpiry <= now) {
      console.log('🔄 Access token expired, refreshing...');
      
      try {
        // Refresh the token using Google OAuth endpoint
        const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') ?? '',
            client_secret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET') ?? '',
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
          })
        });

        if (!refreshResponse.ok) {
          const errorText = await refreshResponse.text();
          console.error('❌ Token refresh failed:', refreshResponse.status, errorText);
          return new Response(
            JSON.stringify({ 
              error: 'Failed to refresh access token. Please reconnect your Google Drive account.',
              needsConnection: true 
            }),
            { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const newTokens = await refreshResponse.json();
        console.log('✅ Token refreshed successfully');
        
        // Calculate new expiry (Google tokens typically expire in 1 hour)
        const expiresInSeconds = newTokens.expires_in || 3600;
        const newExpiry = new Date(Date.now() + (expiresInSeconds * 1000));
        
        console.log(`⏰ New token expiry: ${newExpiry.toISOString()}`);
        
        // Update vault with new access token
        const { data: vaultUpdateResult, error: vaultError } = await supabase.rpc(
          'store_encrypted_oauth_tokens',
          {
            p_user_id: user.id,
            p_provider: 'google_drive',
            p_access_token: newTokens.access_token,
            p_refresh_token: refreshToken, // Keep existing refresh token
            p_token_expiry: newExpiry.toISOString()
          }
        );

        if (vaultError) {
          console.error('❌ Failed to update vault with new token:', vaultError);
          // Continue with the new token even if vault update fails
        } else {
          console.log('✅ Vault updated with new token');
        }

        // Use the new access token
        accessToken = newTokens.access_token;
      } catch (refreshError) {
        console.error('❌ Token refresh error:', refreshError);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to refresh access token. Please reconnect your Google Drive account.',
            needsConnection: true 
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else {
      console.log('✅ Access token is still valid');
    }

    // Prepare search queries - limit to top 3 variations
    const queries = (searchVariations || [originalQuery]).slice(0, 3);
    console.log(`🎯 Using ${queries.length} search variations:`, queries);
    
    // Build mime type filter
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

    // Build date range filter
    let dateQuery = '';
    const effectiveDateRange = dateRange || 'all';
    if (effectiveDateRange !== 'all') {
      const now = new Date();
      let startDate: Date;
      
      switch(effectiveDateRange) {
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
      console.log(`📅 Date filter: documents modified after ${startDate.toISOString()}`);
    }

    // Make separate queries for each search variation to avoid Google Drive API limitations
    console.log('🔎 Executing separate queries for each variation...');
    const allFiles: any[] = [];
    let queryCount = 0;

    for (const query of queries) {
      try {
        queryCount++;
        const escapedQuery = query.replace(/'/g, "\\'");
        const fullQuery = `fullText contains '${escapedQuery}'${mimeTypeQuery}${dateQuery}`;
        
        console.log(`Query ${queryCount}/${queries.length}:`, fullQuery);

        const driveResponse = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(fullQuery)}&fields=files(id,name,mimeType,webViewLink,modifiedTime,owners)&pageSize=100`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
            },
          }
        );

        if (!driveResponse.ok) {
          const errorText = await driveResponse.text();
          console.error(`❌ Query ${queryCount} failed:`, errorText);
          continue; // Skip failed queries, continue with others
        }

        const driveData = await driveResponse.json();
        const files = driveData.files || [];
        console.log(`✅ Query ${queryCount} returned ${files.length} files`);
        allFiles.push(...files);
      } catch (error) {
        console.error(`❌ Error in query ${queryCount}:`, error);
        // Continue with other queries
      }
    }

    // Deduplicate files by ID
    const uniqueFilesMap = new Map();
    for (const file of allFiles) {
      if (!uniqueFilesMap.has(file.id)) {
        uniqueFilesMap.set(file.id, file);
      }
    }
    const files = Array.from(uniqueFilesMap.values());
    
    console.log(`📊 Total files after deduplication: ${files.length}`);

    // Calculate relevance scores with enhanced algorithm
    const results: SearchResult[] = files.map((file: any) => {
      let relevanceScore = 0;
      const fileName = file.name.toLowerCase();
      const fileOwner = file.owners?.[0]?.emailAddress?.toLowerCase() || '';
      
      // Exact phrase matching (highest priority)
      const originalQueryLower = originalQuery.toLowerCase();
      if (fileName.includes(originalQueryLower)) {
        relevanceScore += 25; // High boost for exact query match
      }
      
      // Score based on entity matches
      if (entities) {
        entities.forEach((entity: string) => {
          const entityLower = entity.toLowerCase();
          if (fileName.includes(entityLower)) {
            relevanceScore += 15; // Increased from 10
          }
          // Check if entity appears in owner email (e.g., person name)
          if (fileOwner.includes(entityLower)) {
            relevanceScore += 8;
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
      
      // Document type preference scoring
      const preferredTypes = [
        'application/vnd.google-apps.document',
        'application/vnd.google-apps.spreadsheet',
        'application/pdf'
      ];
      if (preferredTypes.includes(file.mimeType)) {
        relevanceScore += 8;
      }
      
      // Owner relevance - boost documents owned by current user
      if (fileOwner === user.email?.toLowerCase()) {
        relevanceScore += 10;
      }
      
      // Boost recent documents
      const modifiedDate = new Date(file.modifiedTime);
      const daysSinceModified = (Date.now() - modifiedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceModified < 7) relevanceScore += 10;
      else if (daysSinceModified < 30) relevanceScore += 5;

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

    // Fetch content for top 10-12 results (optimized selection)
    const topResults = results.slice(0, 12);
    console.log(`📊 Relevance scores for top 12: ${topResults.map(r => `${r.name}: ${r.relevanceScore}`).join(', ')}`);
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
    for (const result of results.slice(0, 12)) { // Cache top 12
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

    console.log(`Returning top 12 best-ranked results out of ${results.length} total`);

    return new Response(
      JSON.stringify({ 
        results: results.slice(0, 12), // Return top 10-12 for AI processing
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

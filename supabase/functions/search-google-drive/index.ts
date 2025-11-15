import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Error getting user:', userError);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('User authenticated:', user.id);

    // Get search query from request body
    const { query, fileTypes } = await req.json();
    
    if (!query) {
      return new Response(
        JSON.stringify({ error: 'Search query is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Search query:', query);

    // Get OAuth tokens from vault
    const { data: tokensData, error: tokensError } = await supabase.rpc(
      'get_oauth_tokens',
      { p_user_id: user.id, p_provider: 'google_drive' }
    );

    if (tokensError || !tokensData) {
      console.error('Error getting OAuth tokens:', tokensError);
      return new Response(
        JSON.stringify({ error: 'Google Drive not connected. Please connect your account first.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tokens = typeof tokensData === 'string' ? JSON.parse(tokensData) : tokensData;
    const accessToken = tokens.access_token;

    if (!accessToken) {
      console.error('No access token found');
      return new Response(
        JSON.stringify({ error: 'Invalid OAuth tokens' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Access token retrieved successfully');

    // Build Google Drive search query
    let driveQuery = `fullText contains '${query}'`;
    
    // Add file type filters if provided
    if (fileTypes && fileTypes.length > 0) {
      const mimeTypeFilters = fileTypes.map((type: string) => {
        switch(type) {
          case 'document':
            return "mimeType='application/vnd.google-apps.document'";
          case 'spreadsheet':
            return "mimeType='application/vnd.google-apps.spreadsheet'";
          case 'presentation':
            return "mimeType='application/vnd.google-apps.presentation'";
          case 'pdf':
            return "mimeType='application/pdf'";
          default:
            return null;
        }
      }).filter(Boolean);
      
      if (mimeTypeFilters.length > 0) {
        driveQuery += ` and (${mimeTypeFilters.join(' or ')})`;
      }
    }

    console.log('Drive API query:', driveQuery);

    // Search Google Drive
    const driveApiUrl = new URL('https://www.googleapis.com/drive/v3/files');
    driveApiUrl.searchParams.set('q', driveQuery);
    driveApiUrl.searchParams.set('fields', 'files(id,name,mimeType,webViewLink,modifiedTime,owners,iconLink,size)');
    driveApiUrl.searchParams.set('pageSize', '20');

    const driveResponse = await fetch(driveApiUrl.toString(), {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!driveResponse.ok) {
      const errorText = await driveResponse.text();
      console.error('Google Drive API error:', driveResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Google Drive API error: ${driveResponse.status}` }),
        { status: driveResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const driveData = await driveResponse.json();
    console.log(`Found ${driveData.files?.length || 0} files`);

    return new Response(
      JSON.stringify({ 
        files: driveData.files || [],
        query: query 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  } catch (error) {
    console.error('Error in search-google-drive function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

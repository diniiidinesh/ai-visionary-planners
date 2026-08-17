// Shared Google Drive OAuth token retrieval + refresh.

export interface DriveTokenResult {
  accessToken: string;
  refreshed: boolean;
}

export class DriveConnectionError extends Error {
  needsConnection = true;
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function getDriveAccessToken(supabase: any, userId: string): Promise<DriveTokenResult> {
  const { data: connection, error: connectionError } = await supabase
    .from('oauth_connections')
    .select('vault_secret_id, token_expiry')
    .eq('user_id', userId)
    .eq('provider', 'google_drive')
    .eq('is_connected', true)
    .maybeSingle();

  if (connectionError || !connection) {
    throw new DriveConnectionError('No Google Drive connection found. Please connect your account first.');
  }

  const { data: tokens, error: tokenError } = await supabase.rpc('get_oauth_tokens', {
    p_user_id: userId,
    p_provider: 'google_drive',
  });

  if (tokenError || !tokens) {
    throw new DriveConnectionError('Failed to retrieve access tokens. Please reconnect your Google Drive account.');
  }

  const accessToken = tokens.access_token as string;
  const refreshToken = tokens.refresh_token as string;

  const expiry = connection.token_expiry ? new Date(connection.token_expiry) : new Date(0);
  if (expiry > new Date()) {
    return { accessToken, refreshed: false };
  }

  console.log('🔄 Drive access token expired, refreshing...');
  const refreshResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_DRIVE_CLIENT_ID') ?? '',
      client_secret: Deno.env.get('GOOGLE_DRIVE_CLIENT_SECRET') ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!refreshResponse.ok) {
    const errorText = await refreshResponse.text();
    console.error('❌ Token refresh failed:', refreshResponse.status, errorText);
    throw new DriveConnectionError(
      'Failed to refresh access token. Please reconnect your Google Drive account.',
      401,
    );
  }

  const newTokens = await refreshResponse.json();
  const newExpiry = new Date(Date.now() + (newTokens.expires_in || 3600) * 1000);

  const { error: vaultError } = await supabase.rpc('store_encrypted_oauth_tokens', {
    p_user_id: userId,
    p_provider: 'google_drive',
    p_access_token: newTokens.access_token,
    p_refresh_token: refreshToken,
    p_token_expiry: newExpiry.toISOString(),
  });
  if (vaultError) console.error('❌ Failed to update vault with new token:', vaultError);

  return { accessToken: newTokens.access_token, refreshed: true };
}

export const EXPORTABLE_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
];

export function contentUrlFor(fileId: string, mimeType: string): string {
  switch (mimeType) {
    case 'application/vnd.google-apps.document':
    case 'application/vnd.google-apps.presentation':
      return `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`;
    case 'application/vnd.google-apps.spreadsheet':
      return `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`;
    default:
      return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  }
}

import { supabase } from "@/integrations/supabase/client";

export interface ConnectionStatusResult {
  hasConnections: boolean;
  connections: Array<{
    provider: string;
    is_connected: boolean;
  }>;
}

export async function checkUserConnections(userId: string): Promise<ConnectionStatusResult> {
  try {
    const { data, error } = await supabase
      .from('oauth_connections')
      .select('provider, is_connected')
      .eq('user_id', userId)
      .eq('is_connected', true);

    if (error) {
      console.error('Error checking connections:', error);
      return { hasConnections: false, connections: [] };
    }

    return {
      hasConnections: (data?.length || 0) > 0,
      connections: data || [],
    };
  } catch (error) {
    console.error('Error in checkUserConnections:', error);
    return { hasConnections: false, connections: [] };
  }
}

import { AIProviderConfig } from './types.ts';

export class AIConfigManager {
  private supabase: any;
  private userId: string;
  
  constructor(supabase: any, userId: string) {
    this.supabase = supabase;
    this.userId = userId;
  }
  
  async getProviderConfig(purpose: 'search' | 'summarize'): Promise<AIProviderConfig> {
    // Try to get user's AI preferences from database
    const { data: preferences } = await this.supabase
      .from('user_ai_preferences')
      .select('*')
      .eq('user_id', this.userId)
      .maybeSingle();
    
    // If user has custom preferences, use them
    if (preferences && preferences[`${purpose}_provider`]) {
      const provider = preferences[`${purpose}_provider`];
      const model = preferences[`${purpose}_model`];
      
      // Get API key for the provider
      const apiKey = await this.getAPIKey(provider);
      
      return {
        provider,
        apiKey,
        model,
        organizationId: preferences[`${purpose}_org_id`]
      };
    }
    
    // Return default Lovable AI config
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }
    
    return {
      provider: 'lovable',
      apiKey: lovableApiKey,
      model: purpose === 'search' ? 'google/gemini-2.5-flash' : 'google/gemini-2.5-pro'
    };
  }
  
  private async getAPIKey(provider: string): Promise<string> {
    // Try user's custom API key first
    const { data: userKey } = await this.supabase
      .from('user_api_keys')
      .select('vault_secret_id')
      .eq('user_id', this.userId)
      .eq('provider', provider)
      .maybeSingle();
    
    if (userKey?.vault_secret_id) {
      // Decrypt and return user's key from vault
      const { data: decryptedData } = await this.supabase.rpc(
        'get_user_api_key',
        { 
          p_user_id: this.userId, 
          p_provider: provider 
        }
      );
      
      if (decryptedData) {
        return decryptedData.api_key;
      }
    }
    
    // Fall back to environment variable
    const envKey = Deno.env.get(`${provider.toUpperCase()}_API_KEY`);
    if (envKey) return envKey;
    
    throw new Error(`No API key found for provider: ${provider}`);
  }
}

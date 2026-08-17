import { AIProviderConfig } from './types.ts';

/** Chat defaults per provider, used when the user has no explicit model saved. */
const DEFAULT_CHAT_MODELS: Record<string, { search: string; summarize: string }> = {
  lovable: { search: 'google/gemini-2.5-flash', summarize: 'google/gemini-2.5-pro' },
  openai: { search: 'gpt-4.1-mini', summarize: 'gpt-4.1' },
  google: { search: 'gemini-2.5-flash', summarize: 'gemini-2.5-pro' },
};

/** Models that only work on /v1/embeddings — never valid for a chat completion. */
function isEmbeddingModel(model: string): boolean {
  return /embedding|embed-|voyage/i.test(model);
}

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
      const defaults = DEFAULT_CHAT_MODELS[provider] ?? DEFAULT_CHAT_MODELS.lovable;
      let model = preferences[`${purpose}_model`];
      // A missing model would send `model: null` to the gateway, and an embedding
      // model id gets rejected with "model is not a chat model". Fall back to the
      // provider's chat default in both cases.
      if (!model || typeof model !== 'string' || isEmbeddingModel(model)) {
        model = defaults[purpose];
      }
      
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

import { AIProvider } from './base-provider.ts';
import { AIRequest, AIResponse, AIStreamChunk } from './types.ts';

// Model capability configuration for scalability
interface ModelCapabilities {
  supportsTemperature: boolean;
  usesMaxCompletionTokens: boolean;
}

export class OpenAIProvider extends AIProvider {
  // Define model capabilities - easy to extend for new models
  private static MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
    // Newer models (GPT-5 family, GPT-4.1+, O-series)
    'gpt-5': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'gpt-5-mini': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'gpt-5-nano': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'gpt-4.1': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'gpt-4.1-mini': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'o3': { supportsTemperature: false, usesMaxCompletionTokens: true },
    'o4-mini': { supportsTemperature: false, usesMaxCompletionTokens: true },
    
    // Legacy models
    'gpt-4o': { supportsTemperature: true, usesMaxCompletionTokens: false },
    'gpt-4o-mini': { supportsTemperature: true, usesMaxCompletionTokens: false },
    'gpt-4-turbo': { supportsTemperature: true, usesMaxCompletionTokens: false },
  };

  getProviderName(): string {
    return 'openai';
  }

  // Helper to get model capabilities with sensible defaults
  private getModelCapabilities(): ModelCapabilities {
    const modelName = this.config.model;
    
    // Check for exact match first
    if (OpenAIProvider.MODEL_CAPABILITIES[modelName]) {
      return OpenAIProvider.MODEL_CAPABILITIES[modelName];
    }
    
    // Check for partial matches (e.g., "gpt-5-2025-08-07" matches "gpt-5")
    for (const [key, capabilities] of Object.entries(OpenAIProvider.MODEL_CAPABILITIES)) {
      if (modelName.startsWith(key)) {
        return capabilities;
      }
    }
    
    // Default to newer model behavior for unknown models
    console.warn(`Unknown OpenAI model: ${modelName}, using newer model defaults`);
    return { supportsTemperature: false, usesMaxCompletionTokens: true };
  }

  // Helper to build request body with model-specific parameters
  private buildRequestBody(request: AIRequest, streaming: boolean = false): Record<string, any> {
    const capabilities = this.getModelCapabilities();
    const messages = this.buildMessages(request);
    
    const body: Record<string, any> = {
      model: this.config.model,
      messages,
    };

    // Add temperature only if the model supports it
    if (capabilities.supportsTemperature) {
      body.temperature = request.temperature ?? 0.7;
    }

    // Add token limit with correct parameter name
    if (request.maxTokens) {
      if (capabilities.usesMaxCompletionTokens) {
        body.max_completion_tokens = request.maxTokens;
      } else {
        body.max_tokens = request.maxTokens;
      }
    }

    // Add response format if specified
    if (request.responseFormat === 'json') {
      body.response_format = { type: 'json_object' };
    }

    // Add streaming flag if needed
    if (streaming) {
      body.stream = true;
    }

    return body;
  }
  
  async chat(request: AIRequest): Promise<AIResponse> {
    const response = await fetch(
      this.config.baseUrl || 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.organizationId && {
            'OpenAI-Organization': this.config.organizationId
          })
        },
        body: JSON.stringify(this.buildRequestBody(request, false))
      }
    );
    
    if (!response.ok) {
      const error = await response.text();
      
      if (response.status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      }
      if (response.status === 401) {
        throw new Error('Invalid OpenAI API key.');
      }
      
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      },
      model: data.model,
      provider: 'openai',
      finishReason: data.choices[0].finish_reason
    };
  }
  
  async *streamChat(request: AIRequest): AsyncGenerator<AIStreamChunk> {
    const response = await fetch(
      this.config.baseUrl || 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.organizationId && {
            'OpenAI-Organization': this.config.organizationId
          })
        },
        body: JSON.stringify(this.buildRequestBody(request, true))
      }
    );
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(line => line.trim() !== '');
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }
          
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices[0]?.delta?.content || '';
            if (content) {
              yield { content, done: false };
            }
          } catch (e) {
            console.error('Error parsing stream chunk:', e);
          }
        }
      }
    }
  }
  
  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
  
  override estimateCost(usage: AIResponse['usage']): number {
    if (!usage) return 0;
    
    // Cost per 1M tokens (approximate pricing as of 2025)
    const costs: Record<string, { input: number; output: number }> = {
      'gpt-5': { input: 10, output: 30 },
      'gpt-5-mini': { input: 1, output: 4 },
      'gpt-5-nano': { input: 0.3, output: 1 },
      'gpt-4o': { input: 5, output: 15 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 }
    };
    
    const modelCosts = costs[this.config.model] || costs['gpt-5-mini'];
    const inputCost = (usage.promptTokens / 1_000_000) * modelCosts.input;
    const outputCost = (usage.completionTokens / 1_000_000) * modelCosts.output;
    
    return inputCost + outputCost;
  }
}

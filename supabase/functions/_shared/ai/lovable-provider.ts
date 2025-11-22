import { AIProvider } from './base-provider.ts';
import { AIRequest, AIResponse, AIStreamChunk } from './types.ts';

export class LovableProvider extends AIProvider {
  getProviderName(): string {
    return 'lovable';
  }
  
  async chat(request: AIRequest): Promise<AIResponse> {
    const messages = this.buildMessages(request);
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      
      if (response.status === 429) {
        throw new Error('AI service rate limit exceeded. Please try again in a moment.');
      }
      if (response.status === 402) {
        throw new Error('Payment required. Please add credits to your Lovable AI workspace.');
      }
      
      throw new Error(`Lovable AI error: ${response.status} - ${error}`);
    }
    
    const data = await response.json();
    
    return {
      content: data.choices[0].message.content,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined,
      model: data.model || this.config.model,
      provider: 'lovable',
      finishReason: data.choices[0].finish_reason
    };
  }
  
  async *streamChat(request: AIRequest): AsyncGenerator<AIStreamChunk> {
    const messages = this.buildMessages(request);
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: request.temperature ?? 0.7,
        stream: true
      })
    });
    
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
    // LOVABLE_API_KEY is always valid if present
    return !!this.config.apiKey;
  }
  
  override estimateCost(usage: AIResponse['usage']): number {
    // Lovable AI uses credits system, not direct cost
    return 0;
  }
}

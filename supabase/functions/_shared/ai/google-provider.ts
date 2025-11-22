import { AIProvider } from "./base-provider.ts";
import { AIRequest, AIResponse, AIStreamChunk, AIProviderConfig } from "./types.ts";

export class GoogleProvider extends AIProvider {
  private apiKey: string;
  private model: string;

  constructor(config: AIProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.model = config.model || 'gemini-2.0-flash-exp';
  }

  getProviderName(): string {
    return 'google';
  }

  async chat(request: AIRequest): Promise<AIResponse> {
    const startTime = Date.now();

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: this.buildGeminiMessages(request),
          generationConfig: {
            temperature: request.temperature || 0.7,
            maxOutputTokens: request.maxTokens || 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const usage = {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0,
    };

    return {
      content,
      usage,
      model: this.model,
      provider: 'google',
    };
  }

  async *streamChat(request: AIRequest): AsyncGenerator<AIStreamChunk> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: this.buildGeminiMessages(request),
          generationConfig: {
            temperature: request.temperature || 0.7,
            maxOutputTokens: request.maxTokens || 2048,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '' || line.startsWith('data: [DONE]')) continue;
        
        try {
          const jsonMatch = line.match(/\{.*\}/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[0]);
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (content) {
              yield {
                content,
                done: false,
              };
            }
          }
        } catch (e) {
          console.error('Error parsing Gemini stream chunk:', e);
        }
      }
    }

    yield { content: '', done: true };
  }

  async validateConfig(): Promise<boolean> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${this.apiKey}`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  override estimateCost(usage: AIResponse['usage']): number {
    if (!usage) return 0;
    
    // Gemini 2.0 Flash pricing (approximate)
    const inputCostPer1M = 0.075; // $0.075 per 1M input tokens
    const outputCostPer1M = 0.30; // $0.30 per 1M output tokens

    const inputCost = (usage.promptTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (usage.completionTokens / 1_000_000) * outputCostPer1M;

    return inputCost + outputCost;
  }

  private buildGeminiMessages(request: AIRequest) {
    const contents = [];

    // Add system prompt as first user message if present
    if (request.systemPrompt) {
      contents.push({
        role: 'user',
        parts: [{ text: request.systemPrompt }],
      });
      contents.push({
        role: 'model',
        parts: [{ text: 'Understood. I will follow these instructions.' }],
      });
    }

    // Add conversation messages
    for (const msg of request.messages) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }

    return contents;
  }
}

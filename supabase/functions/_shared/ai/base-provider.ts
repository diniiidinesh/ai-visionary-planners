import { AIProviderConfig, AIRequest, AIResponse, AIStreamChunk, AIMessage } from './types.ts';

export abstract class AIProvider {
  protected config: AIProviderConfig;
  
  constructor(config: AIProviderConfig) {
    this.config = config;
  }
  
  // Core methods all providers must implement
  abstract getProviderName(): string;
  abstract chat(request: AIRequest): Promise<AIResponse>;
  abstract streamChat(request: AIRequest): AsyncGenerator<AIStreamChunk>;
  abstract validateConfig(): Promise<boolean>;
  
  // Helper method to format messages
  protected buildMessages(request: AIRequest): AIMessage[] {
    const messages: AIMessage[] = [];
    
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    
    messages.push(...request.messages);
    return messages;
  }
  
  // Helper to parse JSON responses (public method)
  parseJSONResponse(content: string): any {
    try {
      // Handle markdown code blocks
      const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) || 
                       content.match(/```\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      return JSON.parse(jsonStr.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to parse JSON response: ${message}`);
    }
  }
  
  // Cost estimation (can be overridden)
  estimateCost(usage: AIResponse['usage']): number {
    return 0; // Override in specific providers
  }
}

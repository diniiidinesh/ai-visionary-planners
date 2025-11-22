// Standard AI request format
export interface AIRequest {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// Standard AI response format
export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  finishReason?: string;
}

// Provider configuration
export interface AIProviderConfig {
  provider: 'openai' | 'anthropic' | 'google' | 'lovable';
  apiKey: string;
  model: string;
  baseUrl?: string;
  organizationId?: string;
}

// Streaming support
export interface AIStreamChunk {
  content: string;
  done: boolean;
}

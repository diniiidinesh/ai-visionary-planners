import { AIProvider } from './base-provider.ts';
import { OpenAIProvider } from './openai-provider.ts';
import { LovableProvider } from './lovable-provider.ts';
import { GoogleProvider } from './google-provider.ts';
import { AIProviderConfig } from './types.ts';

export class AIProviderFactory {
  static create(config: AIProviderConfig): AIProvider {
    switch (config.provider) {
      case 'openai':
        return new OpenAIProvider(config);
      case 'lovable':
        return new LovableProvider(config);
      case 'google':
        return new GoogleProvider(config);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }
  
  static getSupportedProviders(): string[] {
    return ['openai', 'lovable', 'google'];
  }
  
  static getDefaultModels(provider: string): string[] {
    const models: Record<string, string[]> = {
      openai: ['gpt-5-mini', 'gpt-5', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'],
      lovable: [
        'google/gemini-2.5-flash',
        'google/gemini-2.5-pro',
        'google/gemini-2.5-flash-lite',
        'openai/gpt-5-mini',
        'openai/gpt-5'
      ],
      google: [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.5-flash-lite',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ]
    };
    return models[provider] || [];
  }
}

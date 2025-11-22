import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { OpenAIProvider } from "../supabase/functions/_shared/ai/openai-provider.ts";
import { LovableProvider } from "../supabase/functions/_shared/ai/lovable-provider.ts";
import { AIProviderFactory } from "../supabase/functions/_shared/ai/provider-factory.ts";
import { AIProviderConfig } from "../supabase/functions/_shared/ai/types.ts";

// Test OpenAI Provider
Deno.test("OpenAI Provider - Basic Chat", async () => {
  const config: AIProviderConfig = {
    provider: 'openai',
    apiKey: Deno.env.get('OPENAI_API_KEY') || 'test-key',
    model: 'gpt-4o-mini'
  };

  const provider = new OpenAIProvider(config);
  assertEquals(provider.getProviderName(), 'openai');

  // Test message building
  const request = {
    systemPrompt: "You are a helpful assistant",
    messages: [{ role: 'user' as const, content: "Hello" }],
    temperature: 0.7
  };

  // Note: This will fail without a real API key
  // In production, mock the fetch call or use test keys
  console.log("OpenAI provider created successfully");
});

Deno.test("OpenAI Provider - JSON Response Parsing", () => {
  const config: AIProviderConfig = {
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4o-mini'
  };

  const provider = new OpenAIProvider(config);

  // Test parsing JSON with markdown
  const jsonWithMarkdown = '```json\n{"test": "value"}\n```';
  const parsed = provider.parseJSONResponse(jsonWithMarkdown);
  assertEquals(parsed.test, "value");

  // Test parsing plain JSON
  const plainJson = '{"test": "value2"}';
  const parsed2 = provider.parseJSONResponse(plainJson);
  assertEquals(parsed2.test, "value2");
});

Deno.test("OpenAI Provider - Cost Estimation", () => {
  const config: AIProviderConfig = {
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-5-mini'
  };

  const provider = new OpenAIProvider(config);

  const usage = {
    promptTokens: 100,
    completionTokens: 200,
    totalTokens: 300
  };

  const cost = provider.estimateCost(usage);
  assertExists(cost);
  console.log(`Estimated cost for 300 tokens (gpt-5-mini): $${cost.toFixed(6)}`);
});

// Test Lovable Provider
Deno.test("Lovable Provider - Basic Chat", async () => {
  const config: AIProviderConfig = {
    provider: 'lovable',
    apiKey: Deno.env.get('LOVABLE_API_KEY') || 'test-key',
    model: 'google/gemini-2.5-flash'
  };

  const provider = new LovableProvider(config);
  assertEquals(provider.getProviderName(), 'lovable');
  console.log("Lovable provider created successfully");
});

// Test Provider Factory
Deno.test("Provider Factory - Create OpenAI", () => {
  const config: AIProviderConfig = {
    provider: 'openai',
    apiKey: 'test-key',
    model: 'gpt-4o-mini'
  };

  const provider = AIProviderFactory.create(config);
  assertExists(provider);
  assertEquals(provider.getProviderName(), 'openai');
});

Deno.test("Provider Factory - Create Lovable", () => {
  const config: AIProviderConfig = {
    provider: 'lovable',
    apiKey: 'test-key',
    model: 'google/gemini-2.5-flash'
  };

  const provider = AIProviderFactory.create(config);
  assertExists(provider);
  assertEquals(provider.getProviderName(), 'lovable');
});

Deno.test("Provider Factory - Create Google", () => {
  const config: AIProviderConfig = {
    provider: 'google',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash-exp'
  };

  const provider = AIProviderFactory.create(config);
  assertExists(provider);
  assertEquals(provider.getProviderName(), 'google');
});

Deno.test("Provider Factory - Get Supported Providers", () => {
  const providers = AIProviderFactory.getSupportedProviders();
  assertEquals(providers.includes('openai'), true);
  assertEquals(providers.includes('lovable'), true);
  assertEquals(providers.includes('google'), true);
});

Deno.test("Provider Factory - Get Default Models", () => {
  const openaiModels = AIProviderFactory.getDefaultModels('openai');
  assertEquals(openaiModels.length > 0, true);
  assertEquals(openaiModels.includes('gpt-5-mini'), true);

  const lovableModels = AIProviderFactory.getDefaultModels('lovable');
  assertEquals(lovableModels.length > 0, true);
  assertEquals(lovableModels.includes('google/gemini-2.5-flash'), true);

  const googleModels = AIProviderFactory.getDefaultModels('google');
  assertEquals(googleModels.length > 0, true);
  assertEquals(googleModels.includes('gemini-2.0-flash-exp'), true);
});

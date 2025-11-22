import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { GoogleProvider } from "../supabase/functions/_shared/ai/google-provider.ts";
import { AIProviderConfig } from "../supabase/functions/_shared/ai/types.ts";

Deno.test("Google Provider - Basic Chat", async () => {
  const config: AIProviderConfig = {
    provider: 'google',
    apiKey: Deno.env.get('GOOGLE_API_KEY') || 'test-key',
    model: 'gemini-2.0-flash-exp'
  };

  const provider = new GoogleProvider(config);
  assertEquals(provider.getProviderName(), 'google');

  const request = {
    systemPrompt: "You are a helpful assistant",
    messages: [{ role: 'user' as const, content: "Hello" }],
    temperature: 0.7
  };

  console.log("Google provider created successfully");
});

Deno.test("Google Provider - Cost Estimation", () => {
  const config: AIProviderConfig = {
    provider: 'google',
    apiKey: 'test-key',
    model: 'gemini-2.0-flash-exp'
  };

  const provider = new GoogleProvider(config);

  const usage = {
    promptTokens: 100,
    completionTokens: 200,
    totalTokens: 300
  };

  const cost = provider.estimateCost(usage);
  assertExists(cost);
  console.log(`Estimated cost for 300 tokens (gemini-2.0-flash-exp): $${cost.toFixed(6)}`);
});

Deno.test("Google Provider - Model Names", () => {
  const models = ['gemini-2.0-flash-exp', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  
  models.forEach(model => {
    const config: AIProviderConfig = {
      provider: 'google',
      apiKey: 'test-key',
      model
    };
    
    const provider = new GoogleProvider(config);
    assertEquals(provider.getProviderName(), 'google');
  });
});

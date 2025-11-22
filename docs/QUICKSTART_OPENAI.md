# Quick Start: Adding OpenAI to Your System

## ✅ What's Been Implemented

### 1. **AI Provider Abstraction Layer**
- Abstract base class for all AI providers
- OpenAI provider with full API support
- Lovable AI provider (existing)
- Provider factory for easy instantiation
- Configuration manager for user preferences

### 2. **Database Schema**
- `user_ai_preferences` - Store user's preferred AI provider and models
- `user_api_keys` - Securely store API keys in Supabase Vault
- `ai_usage_logs` - Track usage, costs, and performance

### 3. **Edge Functions**
- `save-api-key` - Securely store user API keys
- `update-ai-preferences` - Configure AI provider preferences
- Updated `ai-search` - Uses configured provider
- Updated `ai-summarize` - Uses configured provider

### 4. **Test Suite**
- Unit tests for providers
- Integration tests for edge functions
- End-to-end test scenarios
- Manual testing guide with cURL examples

---

## 🚀 How to Add OpenAI (3 Steps)

### Step 1: Get Your OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Create a new API key
3. Copy it (starts with `sk-`)

### Step 2: Save Your API Key

From your application's JavaScript/TypeScript code:

```typescript
import { supabase } from "@/integrations/supabase/client";

async function saveOpenAIKey(apiKey: string) {
  const { data, error } = await supabase.functions.invoke('save-api-key', {
    body: {
      provider: 'openai',
      apiKey: apiKey
    }
  });

  if (error) {
    console.error('Error saving API key:', error);
    return;
  }

  console.log('OpenAI API key saved successfully!');
}
```

Or using cURL for testing:

```bash
curl -X POST "https://uusegezraxxagnktnypz.supabase.co/functions/v1/save-api-key" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "apiKey": "sk-your-openai-key"
  }'
```

### Step 3: Configure AI Preferences

```typescript
async function configureOpenAI() {
  const { data, error } = await supabase.functions.invoke('update-ai-preferences', {
    body: {
      searchProvider: 'openai',
      searchModel: 'gpt-5-mini',        // For query processing
      summarizeProvider: 'openai',
      summarizeModel: 'gpt-5',          // For summarization
      enableCostTracking: true,
      monthlyBudgetUsd: 100.00
    }
  });

  if (error) {
    console.error('Error updating preferences:', error);
    return;
  }

  console.log('AI preferences updated!');
}
```

**That's it!** Your next search will use OpenAI automatically.

---

## 🧪 Running Tests

### Prerequisites

```bash
# Install Deno (if not already installed)
curl -fsSL https://deno.land/x/install/install.sh | sh

# Set environment variables for testing
export OPENAI_API_KEY=sk-your-test-key
export LOVABLE_API_KEY=your-lovable-key
export SUPABASE_URL=https://uusegezraxxagnktnypz.supabase.co
export SUPABASE_ANON_KEY=your-anon-key
```

### Run All Tests

```bash
cd tests
deno test --allow-net --allow-env
```

### Run Specific Tests

```bash
# Test AI providers only
deno test --allow-net --allow-env ai-providers.test.ts

# Test edge functions only
deno test --allow-net --allow-env edge-functions.test.ts

# Test specific functionality
deno test --allow-net --allow-env --filter "OpenAI Provider"
```

### Test Results

You should see output like:

```
running 12 tests from ./tests/ai-providers.test.ts
test OpenAI Provider - Basic Chat ... ok (5ms)
test OpenAI Provider - JSON Response Parsing ... ok (2ms)
test OpenAI Provider - Cost Estimation ... ok (1ms)
test Lovable Provider - Basic Chat ... ok (3ms)
...
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

---

## 📊 Verify It's Working

### Check Current Configuration

```sql
-- Check your AI preferences
SELECT * FROM user_ai_preferences 
WHERE user_id = auth.uid();

-- Check saved API keys (encrypted)
SELECT provider, created_at 
FROM user_api_keys 
WHERE user_id = auth.uid();
```

### Monitor Usage

```sql
-- View recent AI usage
SELECT 
  created_at,
  provider,
  model,
  purpose,
  total_tokens,
  estimated_cost_usd,
  response_time_ms
FROM ai_usage_logs
WHERE user_id = auth.uid()
ORDER BY created_at DESC
LIMIT 10;
```

### Check Logs

In Supabase Dashboard → Edge Functions → Logs, you should see:

```
Using openai/gpt-5-mini for query processing
Response time: 1250ms, Provider: openai/gpt-5-mini
```

---

## 🎯 Testing Scenarios

### Test 1: Basic Search with OpenAI

```bash
curl -X POST "https://uusegezraxxagnktnypz.supabase.co/functions/v1/ai-search" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "What are the Q4 revenue results?"}'
```

**Expected Response:**
```json
{
  "queryId": "uuid",
  "originalQuery": "What are the Q4 revenue results?",
  "entities": ["Q4", "revenue", "results"],
  "searchVariations": [
    "Q4 financial results",
    "fourth quarter revenue",
    "quarterly earnings Q4"
  ],
  "documentTypes": ["spreadsheet", "presentation", "document"],
  "intent": "find_document"
}
```

### Test 2: Summarization with OpenAI

```bash
curl -X POST "https://uusegezraxxagnktnypz.supabase.co/functions/v1/ai-summarize" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is our Q4 revenue?",
    "documents": [{
      "id": "doc1",
      "name": "Q4 Report",
      "webViewLink": "https://example.com",
      "mimeType": "application/pdf",
      "modifiedTime": "2024-01-15T10:00:00Z",
      "content": "Q4 revenue reached $10M",
      "relevanceScore": 0.95
    }]
  }'
```

**Expected Response:**
```json
{
  "summary": "According to the [Q4 Report](https://example.com), the company's **Q4 revenue reached $10M**...\n\n✅ **High Confidence**",
  "documentsUsed": 1,
  "model": "openai/gpt-5"
}
```

### Test 3: Cost Tracking

After running searches, check costs:

```sql
SELECT 
  DATE_TRUNC('day', created_at) as date,
  COUNT(*) as requests,
  SUM(total_tokens) as tokens,
  SUM(estimated_cost_usd) as cost
FROM ai_usage_logs
WHERE user_id = auth.uid()
  AND provider = 'openai'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY date
ORDER BY date DESC;
```

---

## 🔧 Configuration Options

### Model Recommendations

**For Search (Fast queries, structured output)**:
- `gpt-5-mini` ⭐ Recommended - Best balance
- `gpt-5-nano` - Fastest, cheapest
- `gpt-5` - Highest quality

**For Summarization (Quality matters)**:
- `gpt-5` ⭐ Recommended - Best quality
- `gpt-5-mini` - Good for shorter summaries
- `gpt-4o` - Alternative option

### Mixed Configuration (Optimize Cost)

```typescript
{
  searchProvider: 'openai',
  searchModel: 'gpt-5-mini',      // Cheap & fast for queries
  summarizeProvider: 'openai',
  summarizeModel: 'gpt-5'         // High quality for summaries
}
```

### Fallback Configuration

```typescript
{
  searchProvider: 'openai',
  searchModel: 'gpt-5-mini',
  summarizeProvider: 'lovable',   // Fallback to free tier
  summarizeModel: 'google/gemini-2.5-pro'
}
```

---

## 💰 Cost Estimates

### Per Search Operation

| Component | Model | Tokens | Cost |
|-----------|-------|--------|------|
| Query Processing | gpt-5-mini | ~200 | ~$0.0002 |
| Summarization | gpt-5 | ~3000 | ~$0.06 |
| **Total** | | ~3200 | **~$0.06** |

### Monthly Estimates

| Usage | Searches/Month | Estimated Cost |
|-------|---------------|----------------|
| Light | 100 | ~$6 |
| Medium | 500 | ~$30 |
| Heavy | 2000 | ~$120 |

💡 **Tip**: Use Lovable AI (free) for testing, OpenAI for production

---

## 🚨 Troubleshooting

### "Invalid OpenAI API key"
- Verify key starts with `sk-`
- Check OpenAI dashboard for valid key
- Ensure billing is set up on OpenAI

### Still Using Lovable AI
- Run `update-ai-preferences` again
- Check database: `SELECT * FROM user_ai_preferences`
- Look at edge function logs
- Clear browser cache

### High Costs
- Use `gpt-5-mini` instead of `gpt-5`
- Enable cost tracking
- Set monthly budget limits
- Use mixed configuration

### Rate Limiting
- OpenAI has rate limits per tier
- System auto-falls back to Lovable AI
- Upgrade OpenAI tier if needed
- Add delays between requests

---

## 📚 Additional Resources

- [Full Setup Guide](./SETUP_OPENAI.md)
- [Test Documentation](../tests/README.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Cost Optimization](./COST_TRACKING.md)

## ✅ Checklist

- [ ] OpenAI API key obtained
- [ ] API key saved via `save-api-key` function
- [ ] Preferences configured via `update-ai-preferences`
- [ ] Test search performed successfully
- [ ] Cost tracking verified in database
- [ ] Edge function logs show OpenAI usage

**You're all set!** 🎉

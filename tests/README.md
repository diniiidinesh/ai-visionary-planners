# AI Provider Abstraction - Test Suite

## Overview
This test suite validates the AI provider abstraction layer, edge functions, and database integrations.

## Test Files

### 1. `ai-providers.test.ts`
Tests for the AI provider abstraction layer:
- OpenAI Provider initialization and methods
- Lovable Provider initialization and methods
- Google Provider initialization and methods
- Provider Factory functionality
- JSON response parsing
- Cost estimation algorithms
- Message building logic

### 2. `google-provider.test.ts`
Focused tests for Google Gemini provider:
- Basic chat functionality
- Cost estimation
- Model configuration validation

### 2. `edge-functions.test.ts`
Tests for Supabase Edge Functions:
- `ai-search`: Query processing with different providers
- `ai-summarize`: Document summarization
- `save-api-key`: API key storage in vault
- `update-ai-preferences`: User preference management
- End-to-end integration flow
- Database schema validation

### 3. Frontend Tests
Tests for AI Settings UI:
- Loading user preferences
- Saving API keys (OpenAI, Google)
- Updating provider selections
- Cost tracking configuration

## Running Tests

### Prerequisites
```bash
# Install Deno
curl -fsSL https://deno.land/x/install/install.sh | sh

# Set environment variables
export OPENAI_API_KEY=your-openai-key
export GOOGLE_API_KEY=your-google-key
export LOVABLE_API_KEY=your-lovable-key
export SUPABASE_URL=your-supabase-url
export SUPABASE_ANON_KEY=your-anon-key
```

### Run All Tests
```bash
deno test --allow-net --allow-env tests/
```

### Run Specific Test File
```bash
deno test --allow-net --allow-env tests/ai-providers.test.ts
```

### Run Specific Test
```bash
deno test --allow-net --allow-env --filter "OpenAI Provider" tests/ai-providers.test.ts
```

## Manual Testing with cURL

### 1. Save OpenAI API Key
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/save-api-key" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "apiKey": "sk-your-openai-key"
  }'
```

### 2. Update AI Preferences
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/update-ai-preferences" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "searchProvider": "openai",
    "searchModel": "gpt-5-mini",
    "summarizeProvider": "openai",
    "summarizeModel": "gpt-5",
    "enableCostTracking": true,
    "monthlyBudgetUsd": 100.00
  }'
```

### 3. Test AI Search with OpenAI
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/ai-search" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the latest product features?"
  }'
```

### 4. Test AI Summarize
```bash
curl -X POST "https://your-project.supabase.co/functions/v1/ai-summarize" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is our Q4 revenue?",
    "documents": [
      {
        "id": "doc1",
        "name": "Q4 Report",
        "webViewLink": "https://example.com/doc1",
        "mimeType": "application/pdf",
        "modifiedTime": "2024-01-15T10:00:00Z",
        "content": "Q4 revenue: $10M",
        "relevanceScore": 0.95
      }
    ]
  }'
```

## Testing Checklist

### Unit Tests
- [ ] OpenAI Provider creates successfully
- [ ] Lovable Provider creates successfully
- [ ] Google Provider creates successfully
- [ ] JSON parsing handles markdown code blocks
- [ ] JSON parsing handles plain JSON
- [ ] Cost estimation calculates correctly
- [ ] Provider factory creates correct providers
- [ ] Provider factory returns supported providers list
- [ ] Provider factory includes Google in supported list

### Edge Function Tests
- [ ] ai-search processes queries correctly
- [ ] ai-search validates empty queries
- [ ] ai-search requires authentication
- [ ] ai-summarize generates summaries
- [ ] ai-summarize validates inputs
- [ ] save-api-key stores keys securely
- [ ] save-api-key validates providers
- [ ] update-ai-preferences saves preferences

### Integration Tests
- [ ] End-to-end search flow works
- [ ] Provider switching works correctly
- [ ] API keys are retrieved from vault
- [ ] User preferences are applied
- [ ] Cost tracking logs usage
- [ ] Default to Lovable AI when no preference

### Database Tests
- [ ] user_ai_preferences table schema
- [ ] user_api_keys table schema
- [ ] ai_usage_logs table schema
- [ ] RLS policies protect user data
- [ ] Vault functions work correctly

## Expected Behavior

### Default Behavior (No User Preferences)
1. User performs search
2. System uses Lovable AI with default models
3. Search: `google/gemini-2.5-flash`
4. Summarize: `google/gemini-2.5-pro`

### With OpenAI Configuration
1. User saves OpenAI API key
2. User sets preferences to use OpenAI
3. System uses OpenAI for configured purposes
4. Falls back to Lovable AI if OpenAI fails

### Cost Tracking
1. When enabled, logs all AI usage
2. Tracks tokens, costs, and response times
3. Can query usage by date range
4. Can monitor budget limits

## Troubleshooting

### Tests Failing
- Ensure environment variables are set
- Check API keys are valid
- Verify Supabase project is accessible
- Check network connectivity

### Edge Functions Not Working
- Verify deployment succeeded
- Check function logs in Supabase
- Ensure JWT tokens are valid
- Verify database migrations ran

### API Keys Not Saving
- Check vault is enabled in Supabase
- Verify RLS policies allow access
- Check user authentication
- Review function logs

## Next Steps
1. Add more comprehensive integration tests
2. Add performance benchmarks
3. Add stress tests for concurrent requests
4. Add tests for fallback mechanisms
5. Add tests for rate limiting handling

# How to Add OpenAI to Your Knowledge Base Search

This guide walks you through adding OpenAI as your AI provider for search query processing and document summarization.

## Prerequisites

1. An OpenAI account with API access
2. An active OpenAI API key
3. Authenticated user account in your application

## Step 1: Get Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign in or create an account
3. Navigate to **API Keys** in your account settings
4. Click **"Create new secret key"**
5. Copy the key (it starts with `sk-`)
6. ⚠️ **Important**: Save this key securely - you won't be able to see it again!

## Step 2: Configure OpenAI in Your Application

### Option A: Using the UI (Coming Soon)
A settings page will allow you to configure AI providers directly in the app.

### Option B: Using the API

Save your OpenAI API key:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/save-api-key" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "apiKey": "sk-your-actual-openai-key"
  }'
```

## Step 3: Set AI Preferences

Configure which provider to use for different purposes:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/update-ai-preferences" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "searchProvider": "openai",
    "searchModel": "gpt-5-mini",
    "summarizeProvider": "openai",
    "summarizeModel": "gpt-5"
  }'
```

### Available OpenAI Models

**For Search (Query Processing)**:
- `gpt-5-nano` - Fastest, most cost-effective
- `gpt-5-mini` - Balanced speed and accuracy ⭐ Recommended
- `gpt-5` - Most accurate, higher cost

**For Summarization**:
- `gpt-5-mini` - Good for shorter summaries
- `gpt-5` - Best for detailed summaries ⭐ Recommended
- `gpt-4o` - Alternative high-quality option

## Step 4: Test Your Configuration

Perform a search query to verify OpenAI is working:

```bash
curl -X POST "https://your-project.supabase.co/functions/v1/ai-search" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What are the Q4 revenue results?"
  }'
```

Check the response logs - they should indicate `openai/gpt-5-mini` (or your chosen model).

## Cost Considerations

### Approximate Costs (as of 2025)

**GPT-5 Models**:
- `gpt-5-nano`: ~$0.30 per 1M input tokens, ~$1.00 per 1M output tokens
- `gpt-5-mini`: ~$1.00 per 1M input tokens, ~$4.00 per 1M output tokens
- `gpt-5`: ~$10.00 per 1M input tokens, ~$30.00 per 1M output tokens

**Typical Usage**:
- Search query processing: ~100-300 tokens per query
- Document summarization: ~2,000-5,000 tokens per summary
- **Estimated cost**: $0.001-0.02 per search operation

### Cost Optimization Tips

1. **Use gpt-5-mini for search** (fast queries don't need GPT-5)
2. **Use gpt-5 for summarization** (better quality for important summaries)
3. **Enable cost tracking** to monitor your usage:
```json
{
  "enableCostTracking": true,
  "monthlyBudgetUsd": 100.00
}
```
4. **Fallback to Lovable AI** if you hit budget limits

## Fallback Configuration

The system automatically falls back to Lovable AI if:
- OpenAI API key is invalid
- OpenAI returns an error
- Rate limits are exceeded

To explicitly configure fallback behavior, keep Lovable AI as a backup:

```json
{
  "searchProvider": "openai",
  "summarizeProvider": "lovable"
}
```

This uses OpenAI for search but Lovable AI for summarization.

## Monitoring Usage

Query your AI usage:

```sql
SELECT 
  date_trunc('day', created_at) as date,
  provider,
  model,
  COUNT(*) as requests,
  SUM(total_tokens) as total_tokens,
  SUM(estimated_cost_usd) as total_cost
FROM ai_usage_logs
WHERE user_id = 'your-user-id'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY date, provider, model
ORDER BY date DESC;
```

## Troubleshooting

### Error: "Invalid OpenAI API key"
- Verify your API key is correct and starts with `sk-`
- Check that your OpenAI account has API access enabled
- Ensure you have billing set up on OpenAI

### Error: "OpenAI rate limit exceeded"
- You've hit OpenAI's rate limits
- Wait a few minutes and retry
- Consider upgrading your OpenAI tier
- Configure fallback to Lovable AI

### Search Still Using Lovable AI
- Verify you've called `update-ai-preferences`
- Check the database: `SELECT * FROM user_ai_preferences WHERE user_id = 'your-id'`
- Look at edge function logs for errors
- Ensure your JWT token is valid

### High Costs
- Switch to smaller models (gpt-5-mini instead of gpt-5)
- Reduce temperature values to get more focused responses
- Enable cost tracking and set budget limits
- Use Lovable AI for less critical operations

## Security Best Practices

1. ✅ **Never commit API keys** to version control
2. ✅ **API keys are encrypted** in the database vault
3. ✅ **RLS policies protect** your keys from other users
4. ✅ **Keys are never exposed** in API responses
5. ✅ **Delete old keys** when rotating credentials

## Support

If you encounter issues:
1. Check the edge function logs in Supabase
2. Review the test cases in `tests/`
3. Verify your configuration in the database
4. Check OpenAI status page for outages

## Next Steps

- [Add Anthropic Claude](./SETUP_ANTHROPIC.md)
- [Configure Cost Tracking](./COST_TRACKING.md)
- [Set Up Usage Alerts](./USAGE_ALERTS.md)
- [Optimize for Performance](./PERFORMANCE_OPTIMIZATION.md)

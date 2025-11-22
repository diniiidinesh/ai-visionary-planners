# AI Settings User Guide

This guide explains how to configure AI providers and preferences for your AI-powered search application.

## Overview

The AI Settings page allows you to:
- Choose AI providers for search and summarization
- Configure API keys for external providers
- Select specific AI models
- Enable cost tracking and set budgets

## Accessing AI Settings

Navigate to `/ai-settings` in your application or click the AI Settings link from your dashboard.

## Supported AI Providers

### 1. Lovable AI (Default)
- **No API key required** - automatically configured
- **Models available**:
  - `google/gemini-2.5-flash` (recommended for most tasks)
  - `google/gemini-2.5-pro` (best quality)
  - `google/gemini-2.5-flash-lite` (fastest)
  - `openai/gpt-5-mini`
  - `openai/gpt-5`
- **Best for**: Quick setup without external accounts

### 2. OpenAI
- **Requires**: OpenAI API key
- **Models available**:
  - `gpt-5-mini` (recommended - fast and cost-effective)
  - `gpt-5` (most capable)
  - `gpt-4.1` (reliable alternative)
  - `gpt-4o-mini` (legacy)
  - `gpt-4o` (legacy)
- **Best for**: Users with existing OpenAI accounts
- **Setup guide**: [SETUP_OPENAI.md](./SETUP_OPENAI.md)

### 3. Google Gemini
- **Requires**: Google API key
- **Models available**:
  - `gemini-2.0-flash-exp` (latest experimental)
  - `gemini-1.5-flash` (fast and efficient)
  - `gemini-1.5-pro` (most capable)
- **Best for**: Users preferring Google's models
- **Setup guide**: [SETUP_GOOGLE.md](./SETUP_GOOGLE.md)

## Configuration Sections

### Search Provider Settings

Configure which AI provider processes your search queries:

1. **Provider**: Select OpenAI, Lovable AI, or Google Gemini
2. **Model**: Choose the specific model to use
3. **Organization ID** (OpenAI only): Optional organization identifier

**Recommendation**: Start with Lovable AI (`google/gemini-2.5-flash`) for the best balance of speed and quality.

### Summarization Provider Settings

Configure which AI provider generates content summaries:

1. **Provider**: Select OpenAI, Lovable AI, or Google Gemini
2. **Model**: Choose the specific model to use
3. **Organization ID** (OpenAI only): Optional organization identifier

**Recommendation**: Use `google/gemini-2.5-pro` for higher quality summaries or `gpt-5-mini` for faster responses.

### API Key Management

Configure API keys for external providers:

#### OpenAI API Key
1. Get your API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Paste the key (starts with `sk-`)
3. Click **Save**

#### Google Gemini API Key
1. Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Paste the key (starts with `AIza`)
3. Click **Save**

**Security**: API keys are encrypted and stored securely in Supabase Vault.

### Cost Tracking

Monitor and control AI usage costs:

1. **Enable Cost Tracking**: Toggle on to track usage
2. **Monthly Budget**: Set a budget limit in USD (optional)

When enabled, the system will:
- Log all AI requests and token usage
- Calculate estimated costs per request
- Track spending against your budget
- Store usage data in `ai_usage_logs` table

## Best Practices

### Choosing the Right Provider

**For Development/Testing**:
- Use **Lovable AI** - no API key needed, instant setup

**For Production**:
- Use **OpenAI** if you need GPT-5 models specifically
- Use **Google Gemini** for cost-effective, high-performance models
- Use **Lovable AI** for convenience and built-in quota management

### Model Selection

**For Fast Responses**:
- Lovable AI: `google/gemini-2.5-flash`
- OpenAI: `gpt-5-mini`
- Google: `gemini-2.0-flash-exp`

**For Best Quality**:
- Lovable AI: `google/gemini-2.5-pro`
- OpenAI: `gpt-5`
- Google: `gemini-1.5-pro`

**For High Volume/Cost Savings**:
- Lovable AI: `google/gemini-2.5-flash-lite`
- OpenAI: `gpt-5-mini`
- Google: `gemini-1.5-flash`

### Cost Management

1. **Start with Lovable AI** to avoid setup complexity
2. **Enable cost tracking** to monitor usage
3. **Set realistic budgets** based on expected usage
4. **Monitor regularly** through the usage logs table
5. **Switch providers** if costs are too high

### Security

1. **Never share API keys** publicly or in code
2. **Rotate keys regularly** for security
3. **Use separate keys** for development and production
4. **Monitor usage** for unexpected activity
5. **Revoke compromised keys** immediately

## Usage Examples

### Example 1: Quick Setup with Lovable AI
1. Navigate to AI Settings
2. Verify **Lovable AI** is selected (default)
3. Choose `google/gemini-2.5-flash` for both search and summarize
4. Click **Save All Settings**
5. Start searching immediately!

### Example 2: OpenAI Configuration
1. Get your OpenAI API key
2. Navigate to AI Settings
3. In "API Keys" section, paste your OpenAI key
4. Click **Save** next to the OpenAI field
5. Change Search Provider to **OpenAI**
6. Select `gpt-5-mini` model
7. Change Summarize Provider to **OpenAI**
8. Select `gpt-5` model
9. Click **Save All Settings**

### Example 3: Mixed Provider Setup
1. Set up both OpenAI and Google API keys
2. Use **Google Gemini** (`gemini-2.0-flash-exp`) for search (fast)
3. Use **OpenAI** (`gpt-5`) for summarization (quality)
4. Enable cost tracking
5. Set monthly budget to $50
6. Click **Save All Settings**

## Troubleshooting

### "Failed to save API key"
- Verify the API key format is correct
- Check that you're authenticated
- Try refreshing the page and re-entering

### "Provider not responding"
- Verify your API key is valid
- Check your API provider dashboard for quota/limits
- Try switching to a different model
- Fall back to Lovable AI temporarily

### "Budget exceeded"
- Review usage in `ai_usage_logs` table
- Increase budget or optimize usage
- Switch to more cost-effective models
- Reduce search frequency

### Models not appearing
- Some models may be region-restricted
- Verify your API key has access to the model
- Try a different provider temporarily

## Advanced Configuration

### Using Organization IDs (OpenAI)
If you're part of an OpenAI organization:
1. Get your org ID from OpenAI dashboard
2. Enter it in the "Organization ID" field
3. This ensures usage is billed to your organization

### Database Query Examples

View your AI usage:
```sql
SELECT * FROM ai_usage_logs 
WHERE user_id = 'your-user-id'
ORDER BY created_at DESC
LIMIT 10;
```

Calculate monthly costs:
```sql
SELECT 
  DATE_TRUNC('month', created_at) as month,
  SUM(estimated_cost_usd) as total_cost,
  COUNT(*) as request_count
FROM ai_usage_logs
WHERE user_id = 'your-user-id'
GROUP BY month
ORDER BY month DESC;
```

## Support

For additional help:
- Check provider-specific setup guides
- Review test files for examples
- Check application logs for errors
- Contact support if issues persist

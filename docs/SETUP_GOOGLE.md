# Google Gemini API Setup Guide

This guide walks you through setting up Google Gemini API for use with the AI-powered search application.

## Prerequisites

- A Google Cloud account
- Access to Google AI Studio or Google Cloud Console

## Steps

### 1. Get Your Google Gemini API Key

#### Option A: Using Google AI Studio (Recommended for Quick Setup)

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click **Get API Key**
4. Create a new project or select an existing one
5. Copy the generated API key

#### Option B: Using Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Generative Language API**:
   - Navigate to **APIs & Services** > **Library**
   - Search for "Generative Language API"
   - Click **Enable**
4. Create credentials:
   - Navigate to **APIs & Services** > **Credentials**
   - Click **Create Credentials** > **API Key**
   - Copy the generated API key
5. (Optional) Restrict your API key:
   - Click on the created API key
   - Under **API restrictions**, select **Restrict key**
   - Choose **Generative Language API**
   - Save changes

### 2. Configure API Key in Your Application

1. Navigate to **AI Settings** in your application
2. Find the **Google Gemini API Key** section
3. Paste your API key
4. Click **Save**

### 3. Select Google as Your Provider

In the AI Settings page:

1. For **Search Provider** or **Summarization Provider**, select **Google Gemini**
2. Choose your preferred model:
   - `gemini-2.0-flash-exp` - Latest experimental model with fast performance
   - `gemini-1.5-flash` - Fast and efficient for most tasks
   - `gemini-1.5-pro` - Most capable model for complex tasks
3. Click **Save All Settings**

## Available Models

### Gemini 2.0 Flash (Experimental)
- **Model ID**: `gemini-2.0-flash-exp`
- **Best for**: Latest features, fast responses
- **Context window**: Up to 1M tokens
- **Note**: Experimental - may change

### Gemini 1.5 Flash
- **Model ID**: `gemini-1.5-flash`
- **Best for**: Fast, cost-effective tasks
- **Context window**: Up to 1M tokens
- **Pricing**: Lower cost per token

### Gemini 1.5 Pro
- **Model ID**: `gemini-1.5-pro`
- **Best for**: Complex reasoning and analysis
- **Context window**: Up to 2M tokens
- **Pricing**: Higher cost, best quality

## Pricing

Google Gemini pricing varies by model. Current approximate rates:

- **Gemini 1.5 Flash**: ~$0.075 per 1M input tokens, ~$0.30 per 1M output tokens
- **Gemini 1.5 Pro**: ~$1.25 per 1M input tokens, ~$5.00 per 1M output tokens

Check [Google AI Pricing](https://ai.google.dev/pricing) for the most up-to-date information.

## API Limits

- **Free tier**: 15 requests per minute
- **Paid tier**: 1,000+ requests per minute (depending on your quota)

You can request quota increases through the Google Cloud Console.

## Troubleshooting

### "Invalid API Key" Error
- Verify the API key is copied correctly
- Ensure the Generative Language API is enabled in your project
- Check if your API key has the correct restrictions

### Rate Limit Errors
- You're making too many requests
- Wait a few moments and try again
- Consider upgrading to a paid plan for higher limits

### Model Not Available
- Some models may be region-restricted
- Try a different model (e.g., switch to `gemini-1.5-flash`)

## Security Best Practices

1. **Never commit API keys** to version control
2. **Rotate keys regularly** for security
3. **Set up API restrictions** in Google Cloud Console
4. **Monitor usage** to prevent unexpected charges
5. **Use separate keys** for development and production

## Additional Resources

- [Google AI Studio](https://makersuite.google.com/)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Pricing Information](https://ai.google.dev/pricing)

# AI Providers Implementation

## Overview

This implementation adds support for Russian AI providers with automatic fallback chain. The system supports:

- **AIJora** (https://api.aijora.com) - Russian aggregator
- **Polza.ai** (https://polza.ai) - Russian aggregator
- **Bothub** (https://bothub.chat) - Russian aggregator
- **OpenRouter** (https://openrouter.ai) - International aggregator
- **ZAI** (https://zukijourney.com) - Alternative provider
- **OpenAI** (https://openai.com) - Direct OpenAI access

## Files Modified

### 1. `lib/ai/types.ts`
- Added `"provider"` to `AIAdapterMode` type

### 2. `lib/ai/provider-adapter.ts` (NEW)
- Alternative implementation using OpenAI SDK
- Implements AIAdapter interface
- Supports fallback chain with error classification
- Falls back to mock if all providers fail

### 3. `lib/ai/adapter.ts`
- Updated `createAIAdapter()` to support `"provider"` mode

### 4. `lib/ai/providers.ts`
- Updated AIJora endpoint to `https://api.aijora.com/api/v1`
- Updated Polza endpoint to `https://polza.ai/api/v1`
- Updated Bothub endpoint to `https://bothub.chat/api/v1`
- Updated model lists for each provider

### 5. `lib/ai/server-runs.ts`
- Updated `hasAvailableProvider()` to check for Russian providers (AIJora, Polza, Bothub)

### 6. `.env.local`
- Added environment variables for all providers
- Set `SEOCLAW_AI_MODE="provider"` to use provider mode

## How It Works

### Priority Chain

The system tries providers in this order (configurable via `AI_PROVIDER_PRIORITY`):

1. AIJora
2. Polza.ai
3. OpenRouter
4. Bothub
5. ZAI
6. OpenAI

### Error Handling

- **401/403 (Auth errors)**: Skip to next provider immediately
- **402 (Insufficient funds)**: Skip to next provider
- **429 (Rate limit)**: Wait 1 second, then try next provider
- **Other errors**: Skip to next provider

### Fallback

If all providers fail, the system falls back to mock responses (buildMockFinalRun).

## Configuration

### Environment Variables

```bash
# Required: At least one provider API key
AIJORA_API_KEY="your-aijora-key"
POLZA_API_KEY="your-polza-key"
OPENROUTER_API_KEY="your-openrouter-key"
BOTHUB_API_KEY="your-bothub-key"
ZAI_API_KEY="your-zai-key"
OPENAI_API_KEY="your-openai-key"

# Optional: Override priority order (comma-separated)
AI_PROVIDER_PRIORITY="aijora,polza,openrouter,bothub,openai"

# Set execution mode
SEOCLAW_AI_MODE="provider"  # "mock" | "gateway" | "provider"

# Desktop MLX bridge (recommended on macOS)
CEOCLAW_MLX_MODEL_PATH="/Users/you/.openclaw/models/qwen-3b-mlx"
CEOCLAW_MLX_ADAPTER_PATH="/Users/you/.openclaw/workspace/models/qwen-ceoclaw-lora-v7"
CEOCLAW_MLX_AUTO_START="true"

# Browser/runtime local gateway (optional)
OPENCLAW_GATEWAY_URL="http://127.0.0.1:18789/v1/chat/completions"
OPENCLAW_GATEWAY_MODEL="openclaw:main"
# Token is optional for localhost inference, but can be set if your gateway requires it.
OPENCLAW_GATEWAY_TOKEN="optional-token"
```

### Getting API Keys

- **AIJora**: https://api.aijora.ru/dashboard/api-keys
- **Polza.ai**: https://polza.ai/dashboard/api-keys
- **OpenRouter**: https://openrouter.ai/keys
- **Bothub**: https://bothub.chat/dashboard/api-keys

## Usage

The provider system is automatically used when:

1. `SEOCLAW_AI_MODE="provider"` is set in `.env.local`
2. OR no mode is set AND at least one provider API key is configured
3. OR `SEOCLAW_AI_MODE="gateway"` is set with a reachable `OPENCLAW_GATEWAY_URL`

No code changes needed - the system auto-detects available providers.
On desktop, the Tauri bridge can auto-start the local MLX server and the AI settings page will show `Local Model`.
If `NEXT_PUBLIC_OPENCLAW_GATEWAY_URL` points to localhost and matches `OPENCLAW_GATEWAY_URL`, the browser workspace can also auto-open in local gateway mode.
The AI settings page surfaces the resolved execution mode so you can immediately see whether CEOClaw is using `mock`, `provider`, `gateway`, or is currently `unavailable`.
The local gateway route is available at `GET /api/ai/local` for status and `POST /api/ai/local` for a direct prompt test.

## Testing

### 1. Install OpenAI SDK (if using provider-adapter.ts)

```bash
cd /Users/aleksandrgrebeshok/ceoclaw-dev
npm install openai
```

### 2. Build the project

```bash
npm run build
```

### 3. Test in UI

1. Add API keys to `.env.local`
2. Start dev server: `npm run dev`
3. Navigate to AI workspace
4. Send a message
5. Check console logs for provider selection

### 4. Verify Provider Selection

Look for logs like:

```
[ProviderAdapter] Trying provider: aijora
[ProviderAdapter] Provider aijora succeeded
```

Or on failure:

```
[ProviderAdapter] Provider aijora failed: [error]
[ProviderAdapter] Trying provider: polza
```

## Architecture

### Two Implementations

1. **AIRouter** (`lib/ai/providers.ts`):
   - Used by `server-runs.ts`
   - Direct fetch API calls
   - Simpler implementation
   - Currently active

2. **ProviderAdapter** (`lib/ai/provider-adapter.ts`):
   - Alternative implementation
   - Uses OpenAI SDK
   - More sophisticated error handling
   - Can be used via `createAIAdapter("provider")`

### Which One Is Used?

- **Server API routes** → Uses `AIRouter` via `server-runs.ts`
- **Client-side** → Uses `createAIAdapter()` which can use `ProviderAdapter`

## Next Steps

1. **Get API keys** for AIJora and/or Polza
2. **Test provider selection** by adding keys to `.env.local`
3. **Monitor usage** via console logs
4. **Adjust priority** if needed via `AI_PROVIDER_PRIORITY`

## Troubleshooting

### No providers available

```
Error: Provider not available. Check API keys in .env
```

**Solution**: Add at least one API key to `.env.local`

### All providers failed

```
Error: All AI providers failed: [error messages]
```

**Solution**: Check API keys, network connectivity, and provider status

### Rate limits

```
Error: [provider] Rate limit exceeded
```

**Solution**: System automatically tries next provider. If all rate-limited, wait 1 minute.

## Notes

- Russian providers (AIJora, Polza, Bothub) have lower latency for Russian users
- OpenRouter has the widest model selection
- ZAI provides access to Chinese models (GLM series)
- OpenAI direct access has highest cost but best reliability

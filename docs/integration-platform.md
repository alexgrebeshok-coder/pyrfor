# Integration Platform

CEOClaw now supports a manifest-driven integration layer for AI providers and external connectors.

The goal is simple: add a new provider or connector without changing the core app every time.

The operator-facing entry point for this layer now lives on `/integrations`, where the app shows
connector health, live probes, and a manifest onboarding card for the JSON env variables.

## What is already built

- AI provider registry now includes built-ins and optional custom manifests.
- Connector registry now includes built-ins and optional custom manifests.
- `/settings/ai` reads the live AI provider registry from `/api/ai/chat`.
- `/integrations` shows the live connector registry and connector health probes.

## AI provider manifests

Use `CEOCLAW_AI_PROVIDER_MANIFESTS` to register additional OpenAI-compatible providers.

Example:

```bash
CEOCLAW_AI_PROVIDER_MANIFESTS='[
  {
    "name": "custom-ai",
    "displayName": "Custom AI",
    "description": "Manifest-driven OpenAI-compatible provider",
    "baseURL": "https://custom-ai.example.com/v1",
    "apiKeyEnvVar": "CUSTOM_AI_API_KEY",
    "defaultModel": "custom-model",
    "models": ["custom-model", "custom-model-mini"]
  }
]'

CUSTOM_AI_API_KEY=sk-...
```

Notes:

- Built-in providers stay available as before.
- Duplicate provider names are skipped.
- The custom provider becomes visible in the AI router, `/api/ai/chat`, and the AI settings page.
- The manifest path is best for OpenAI-compatible providers and provider aggregators.

## Connector manifests

Use `CEOCLAW_CONNECTOR_MANIFESTS` to register additional HTTP/JSON connectors.

Example:

```bash
CEOCLAW_CONNECTOR_MANIFESTS='[
  {
    "id": "slack",
    "name": "Slack",
    "description": "Slack workspace bridge",
    "direction": "bidirectional",
    "sourceSystem": "Slack Web API",
    "operations": [
      "Receive workspace events",
      "Send operational notifications"
    ],
    "credentials": [
      {
        "envVar": "SLACK_BASE_URL",
        "description": "Slack API base URL"
      },
      {
        "envVar": "SLACK_BOT_TOKEN",
        "description": "Bot token used for probing and outbound calls"
      }
    ],
    "apiSurface": [
      {
        "method": "GET",
        "path": "/api/connectors/slack",
        "description": "Connector status for Slack"
      }
    ],
    "probe": {
      "baseUrlEnvVar": "SLACK_BASE_URL",
      "path": "/api/auth.test",
      "authEnvVar": "SLACK_BOT_TOKEN",
      "expectation": "json-field",
      "responseField": "ok"
    }
  }
]'

SLACK_BASE_URL=https://slack.example.com
SLACK_BOT_TOKEN=xoxb-...
```

Notes:

- Built-in connectors stay available as before.
- Duplicate connector IDs are skipped.
- The custom connector appears in `/integrations`, `/api/connectors`, and the readiness surfaces that read connector health.
- This is a good fit for messenger APIs, GPS APIs, ERP read APIs, and other HTTP-based systems.

## Practical guidance

- Use manifests for systems that are OpenAI-compatible or HTTP/JSON readable.
- Keep live credentials in environment variables or the deployment secret store.
- If a provider or connector needs a truly custom protocol, add a dedicated adapter class and register it from the same manifest layer.
- Prefer health probes that are read-only and cheap.
- Prefer explicit `apiSurface` entries so operators can see exactly what the app can call.

## Where the manifests surface in the app

- AI providers: `app/api/ai/chat/route.ts`, `app/settings/ai/page.tsx`, `components/ai/chat-widget.tsx`
- Connectors: `lib/connectors/registry.ts`, `app/api/connectors/route.ts`, `app/integrations/page.tsx`
- Operator onboarding: `components/integrations/integration-manifests-card.tsx`

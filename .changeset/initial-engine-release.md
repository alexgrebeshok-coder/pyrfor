---
"@pyrfor/engine": minor
---

Initial release of @pyrfor/engine v0.1.0

Core platform modules extracted from ceoclaw-dev monolith:
- ai/: OpenRouter, ZAI, OpenAI, GigaChat, YandexGPT providers
- memory/: Bounded Memory + GBrain implementations
- orchestration/: Intent routing + agent orchestration
- skills/: MCP-server skill registry
- auth/: Telegram OAuth + email authentication
- voice/: ASR/TTS base abstractions
- transport/: Telegram + SSE + notifications
- observability/: Logger + Sentry integration
- cache/: Rate limiting + cache layer
- db/: Prisma client + migration helpers
- utils/: Date, string, and general utilities

# ADR-002: AI Adapter Pattern

## Status
Accepted

## Context
CEOClaw needs to support multiple AI providers with fallback logic.

## Decision
Use Adapter Pattern for AI provider abstraction.

## Rationale
- **Provider Abstraction**: Easy to add/remove providers
- **Fallback Chain**: Automatic failover on errors
- **Testability**: Mock adapters for unit tests
- **Flexibility**: Switch providers without code changes

## Implementation
```typescript
interface AIAdapter {
  run(input: AIRunInput): Promise<AIRunRecord>;
  isAvailable(): boolean;
}

class ProviderAdapter implements AIAdapter {
  // Tries providers in priority order
  // Falls back on next provider if current fails
}
```

## Consequences
- All AI calls go through ProviderAdapter
- Providers configured via environment variables
- Fallback order: local-model → openrouter → openai
- Circuit breaker prevents cascade failures

## Notes
- Added circuit breaker in Phase 6 (March 2026)
- See `lib/ai/provider-adapter.ts`

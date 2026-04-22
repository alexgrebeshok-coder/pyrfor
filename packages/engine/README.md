# @ceoclaw/engine

**CEOClaw Engine** — open core foundation for all CEOClaw products.

**License:** Apache 2.0
**Status:** 🔧 R1 — active migration from `ceoclaw-dev` monolith

---

## What lives here

| Module | Description |
|--------|-------------|
| `src/ai/` | Provider Router (OpenRouter, ZAI, OpenAI, GigaChat, YandexGPT) |
| `src/memory/` | Bounded Memory 5KB + GBrain (FTS5 + Ollama embeddings) |
| `src/orchestration/` | Agent orchestration: Plan→Decompose→Delegate→Verify |
| `src/skills/` | MCP-server + skill registry |
| `src/auth/` | Telegram OAuth + email auth (base only; tenant logic in business) |
| `src/db/` | Prisma client adapter for engine models |
| `src/voice/` | Base ASR/TTS (voice-profile per-user → ochag) |
| `src/transport/` | SSE, Telegram bot client, notifications |
| `src/utils/` | Shared utilities (date, logger, rate-limit, etc.) |
| `src/observability/` | Sentry, monitoring, structured logging |
| `src/billing/` | Stars / ЮKassa / TON integrations; entitlements API |
| `src/policy/` | Privacy tiers: Public / Personal / Vault |
| `src/trust/` | Audit log, undo, «почему?», privacy badge |
| `src/mcp/` | MCP server (agentskills.io compatible) |

## Architecture Rule

**Engine has no dependencies on product packages.**

```
engine ← business
engine ← ochag
engine ← freeclaude
engine ← ui
```

This is enforced by `eslint-plugin-boundaries` in CI.

## Development

```bash
# From workspace root
pnpm --filter @ceoclaw/engine dev

# Type check
pnpm --filter @ceoclaw/engine typecheck

# Tests
pnpm --filter @ceoclaw/engine test
```

## Migration Status (R1)

During R1 migration, modules are moved from `ceoclaw-dev/lib/` one PR at a time.
See [ADR-001](../../doc/adr/001-repo-split.md) for strategy.

Current: `src/utils/date.ts` — proof-of-concept ✅

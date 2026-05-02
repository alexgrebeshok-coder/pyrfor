# @pyrfor/engine

**Pyrfor Engine** — canonical local-first runtime for Pyrfor.app and optional integration surfaces.

**License:** Apache 2.0
**Status:** Runtime consolidation — `packages/engine/src/runtime` is the desktop runtime boundary.

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
| `src/runtime/` | Canonical Pyrfor.app sidecar runtime: gateway, sessions, memory, tools, MCP bridges, health, CLI |

## Architecture Rule

**Engine has no dependencies on product packages.**

```
engine ← business
engine ← ochag
engine ← freeclaude
engine ← ui
```

This is enforced by `eslint-plugin-boundaries` in CI.

`apps/pyrfor-ide` consumes the engine through the bundled sidecar and HTTP/SSE/WebSocket runtime contracts. The root `daemon/` directory is a compatibility/service wrapper and must not become a second desktop backend.

## Development

```bash
# From workspace root
pnpm --filter @pyrfor/engine dev

# Type check
pnpm --filter @pyrfor/engine typecheck

# Tests
pnpm --filter @pyrfor/engine test
```

## Runtime contract

- Default config: `~/.pyrfor/runtime.json`
- CLI entrypoint: `packages/engine/bin/pyrfor.cjs`
- Desktop sidecar: built by `apps/pyrfor-ide/scripts/build-sidecar.sh`
- Compatibility inputs such as `.openclaw` and `.ceoclaw` paths are migration-only and must not define the desktop first-run path.

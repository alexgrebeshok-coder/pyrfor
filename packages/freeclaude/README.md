# @freeclaude/coder

**FreeClaude** — multi-provider AI coder: CLI for developers + Studio TMA for non-devs.

**License:** Apache 2.0
**Status:** 🔧 R1 — inherits from `freeclaude-dev` (v3.2.16 CLI)

---

## What lives here

| Module | Description |
|--------|-------------|
| `src/` | Core coder logic, MCP client, provider adapter |
| `cli/` | CLI entry point (`freeclaude` binary) |
| `src/studio/` | Coder Studio TMA for vibe-coding (non-dev UX) |
| `src/compat/openclaw/` | Hermes/OpenClaw migration layer (`freeclaude migrate`) |
| `src/vscode-ext/` | VS Code extension (Phase 2) |

## ICP

**a) FreeClaude Pro:** RU/CIS dev 25–45, хочет open-source CLI с multi-provider backend.
**b) Coder Studio:** маркетолог/дизайнер, нужен лендинг или бот, не умеет код.

## Pricing

Free (CLI) → Pro 1 490₽/mo (priority models + Studio + MCP-server exposed)

## Dependencies

```
@freeclaude/coder → @ceoclaw/engine
```

(No @ceoclaw/ui dependency — CLI is UI-less; Studio uses its own minimal TMA UI)

## Development

```bash
# CLI
pnpm --filter @freeclaude/coder dev

# Run CLI locally
pnpm --filter @freeclaude/coder exec ts-node cli/index.ts
```

## Migration from OpenClaw/Hermes

```bash
freeclaude migrate --from openclaw
freeclaude migrate --from hermes
```

## Domain

`freeclaude.dev`, GitHub: `github.com/ceoclaw/freeclaude`

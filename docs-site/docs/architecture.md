# Architecture

| Layer | Location | Role |
| --- | --- | --- |
| Desktop shell | `apps/pyrfor-ide` | Tauri UI, gateway client, trust panels |
| Engine runtime | `packages/engine/src/runtime` | Tool loop, ledger, sandbox, MCP |
| CLI | `packages/cli` | `concept`, `migrate`, approvals |
| Blocks | `packages/engine` block loader | Domain packages (e.g. reconciliation MVP) |

The **gateway** exposes HTTP/WebSocket APIs for the IDE; the **sidecar** bundles Node + engine for Tauri `externalBin`.

See monorepo `README.md` for workflow commands (`pnpm runtime`, `pnpm ide:dev`).

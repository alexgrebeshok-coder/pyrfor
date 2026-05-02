# Pyrfor integration scope

Pyrfor.app starts from the local desktop IDE plus `packages/engine/src/runtime`. External systems are optional adapters over that runtime, not first-run requirements.

| Integration | Status contract | First-run behavior |
| --- | --- | --- |
| Telegram | Optional connector using `TELEGRAM_BOT_TOKEN` and runtime gateway/permission flow | Missing token returns `pending`; no network call is made |
| FreeClaude | Optional runtime mode/adapter around Pyrfor run lifecycle, ledger, permissions and artifacts | Not started unless a caller explicitly imports `@pyrfor/engine/runtime/integrations` or direct adapter modules |
| CEOClaw | Optional in-process MCP bridge with caller-injected client | No CEOClaw schema/service is required for Pyrfor desktop startup; bridge exports live under `@pyrfor/engine/runtime/integrations` |
| 1C OData | Optional connector using `ONE_C_ODATA_*` env/secret values | Missing URL/auth returns `pending`; no network call is made |

Guardrail: integration code must expose status/configuration probes that fail closed as `pending` or `degraded`. It must not change the desktop first-run path, sidecar startup, workspace root, provider credentials, PTY auth, or release packaging.

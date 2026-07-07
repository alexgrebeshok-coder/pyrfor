# Operations roadmap (orchestration E2–E6)

Living checklist for master orchestration. Do not edit `docs/PYRFOR-IMPROVEMENT-PLAN*.md` from automation.

## W0 — v1.0 ship prep (ops)

| Item | Status | Notes |
| --- | --- | --- |
| PR #34 release signing / notarization CI | **Blocked** | Open on `ci/release-signing`; **no CI checks reported** on branch — merge after workflows run green |
| `docs.pyrfor.dev` custom domain | **Human** | Point DNS CNAME to GitHub Pages (`docs-site/static/CNAME`) or Vercel per [`docs-site/DEPLOY.md`](../docs-site/DEPLOY.md) |
| Docs site deploy (`docs-deploy.yml`) | Done on `main` | Live: `https://pyrfor-org.github.io/pyrfor`; canonical target `https://docs.pyrfor.dev` after DNS |
| Apple signing secrets (notarized DMG) | **Human** | Configure repo/org secrets after PR #34 merges; see [`docs/RELEASE.md`](RELEASE.md) |

## E2 — Trust & isolation (P0-3, P0-8, P0-9, P0-10)

| AC | Status | Notes |
| --- | --- | --- |
| Sandbox L1 on all write tools | Partial | `SandboxProvider` + `setSandboxProvider` in `tools.ts`; wire at runtime bootstrap |
| `rm -rf /` blocked in trajectory | Done | `BLOCKED_COMMANDS` in `tools.ts` |
| Subagent → WorktreeManager → merge | Partial | `RuntimeWorktreeManager` + git API; gateway merge endpoints on integration branch |
| Permission ladder on every tool path | Partial | `permission-engine.ts`; enforce in universal tool loop |
| BudgetPolicy e2e abort + ledger | Partial | `pyrfor-fc-budget-guard.ts`; scope hooks in self-improvement runs |

## E3 — Observability & protocols (P0-4, P0-5, P1-1, P1-13)

| AC | Status | Notes |
| --- | --- | --- |
| OTel GenAI semantic conventions | Scaffold | `packages/engine/src/observability/otel/` on `main` integration branch |
| MCP streamable-http + sidecar lifecycle | Scaffold | `mcp-client.ts`, IDE `McpServersPanel` |
| AG-UI emitter + demo | Scaffold | `ag-ui.ts`, CopilotKit example TBD |
| Protocol adapter layer | Scaffold | `packages/engine/src/runtime/protocols/` |

## E4 — Proof & DX (P0-6, P1-3–5)

| AC | Status | Notes |
| --- | --- | --- |
| SWE-bench Lite score published | Smoke only | `pnpm swe-bench:smoke`; baseline % TBD |
| ACP `npx @pyrfor/engine acp` | Planned | |
| Tree-sitter repo-map | Partial | semantic repo planning on integration branch |
| VS Code extension marketplace | Planned | |

## E5 — Block SDK walking skeleton

| AC | Status | Notes |
| --- | --- | --- |
| КС-2/КС-3/1С fixture + reconcile | Scaffold | `fixtures/reconciliation-mvp/` on integration branch |
| Gateway activation + human review | Partial | block-loader + review step |

## E6 — SI & UX (P1-2, P1-8, P1-11, P1-12, P2-3)

| AC | Status | Notes |
| --- | --- | --- |
| Postmortem → Experience Library | Partial | experience projection on integration branch |
| Checkpoint / suspend-resume | Planned | |
| Agent Timeline / Approval Inbox | IDE panels on integration branch |
| Continuous eval CI | Planned | |

## Pipeline gates

After each merged stage: `pnpm test`, `pnpm swe-bench:smoke`, split PRs ≤1 concern, human merge.

# Pyrfor / CEOClaw Finish Plan — Honest Reset

**Date:** 2026-04-25
**Author:** orchestrator (post-audit)
**Status:** Active — supersedes any "Wave N+1" intent.

---

## 1. The honest audit

I was asked to audit. Here are the facts.

### 1.1 What the project actually is

This repo is **CEOClaw** — a live Next.js + Prisma PMO platform (web + macOS shell + iPhone shell + daemon). "Pyrfor" is the name I gave to a side experiment under `packages/engine/src/runtime/`. The product on disk is CEOClaw. The launch checklist is `docs/full-launch-roadmap.md` and `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`.

### 1.2 What I built across waves 7–22

40 isolated runtime modules:

```
agent-registry, audit-log, backup-scheduler, chunk-streamer, circuit-tracker,
cost-tracker, cron-builder, crypto-keystore, diff-syncer, embedding-cache,
feature-flags, file-watcher, graph-utils, http-client, image-cache,
json-rpc-server, json-schema-validator, localization-bundle, markdown-table,
otp-totp, plugin-loader, priority-queue, prompt-template, queue-scheduler,
rate-limiter, redaction-pipeline, semantic-search, session-summarizer,
shell-runner, snapshot-store, structured-logger, subprocess-pool, tar-bundler,
text-diff, tokenizer-bpe, tool-router, translator-router, voice-output,
web-fetch-cleaner, webhook-receiver, websocket-bridge
```

~4400 unit tests. Every test green.

### 1.3 What's actually wired

Grep across `app/`, `components/`, `lib/`, `daemon/`, `apps/` for imports of any of the 40 modules:

**0 (zero) imports.** Every module is dead code outside its own test file.

`packages/engine/src/runtime/index.ts` only consumes 16 internal modules (`session`, `provider-router`, `tools`, `compact`, `subagents`, `privacy`, `workspace-loader`, `tool-loop`, `gateway`, `health`, `prisma-adapter`, `cron`, `cron/handlers`, `telegram-types`, `config`, `session-store`). None of my waves are in that list.

The production daemon at `daemon/` has its own working `cron/`, `telegram/`, `health.ts`, `gateway.ts`. It does not import anything from `packages/engine/src/runtime/`.

### 1.4 Verdict

I built a library, not a product. The user is right.

---

## 2. Over-engineering check — which modules to keep, archive, or delete

| Module | Verdict | Reason |
|---|---|---|
| diff-syncer (CRDT) | **archive** | No multi-replica sync requirement in CEOClaw (single Prisma DB). |
| tar-bundler | **archive** | No tar pipeline anywhere. `node-tar` exists if ever needed. |
| otp-totp | **archive** | 2FA not on roadmap. |
| websocket-bridge | **archive** | App uses Next.js / SSE / Telegram polling; no raw ws need. |
| translator-router | **archive** | Not on roadmap. |
| webhook-receiver | **archive** | Webhook routes are Next.js API routes, not a custom receiver. |
| tokenizer-bpe | **archive** | Provider routers handle tokens via their SDKs. |
| graph-utils | **archive** | DAG scheduler not used. |
| priority-queue | **archive** | No queueing requirement beyond cron. |
| markdown-table | **archive** | Not used in any UI render path. |
| localization-bundle | **archive** | App is single-locale (ru) right now. |
| backup-scheduler | **archive** | Backups are ops/Prisma-side. |
| snapshot-store | **archive** | Sessions persist via Prisma. |
| prompt-template | **archive** | Prompts are inline TS strings. |
| image-cache | **archive** | Not used. |
| chunk-streamer | **maybe-keep** | Could plug into provider streaming, but routers already stream. |
| circuit-tracker | **maybe-keep** | Provider router already has its own fallback chain. |
| http-client | **archive** | App uses native `fetch` + Next routes. |
| subprocess-pool | **archive** | No persistent worker need. |
| plugin-loader | **archive** | No third-party plugin surface. |
| crypto-keystore | **archive** | API keys live in env / Prisma `Setting` table. |
| feature-flags | **maybe-keep** | Could be wired to a real flag UI later. |
| cost-tracker | **maybe-keep** | If we want per-user spend dashboard. |
| embedding-cache | **maybe-keep** | If RAG path is enabled. |
| audit-log | **maybe-keep** | Compliance feature later. |
| rate-limiter | **maybe-keep** | API ingress could use it. |
| structured-logger | **archive** | `daemon/logger.ts` already in use. |
| voice-output | **archive** | TTS not on roadmap. |
| json-rpc-server | **archive** | Next API routes are REST; no JSON-RPC need. |
| file-watcher | **archive** | No live-reload requirement. |
| web-fetch-cleaner | **maybe-keep** | If agents fetch URLs into context. |
| session-summarizer | **maybe-keep** | Already partially overlaps `compact.ts`. |
| semantic-search | **maybe-keep** | If RAG is a product feature. |
| shell-runner / text-diff / json-schema-validator | **maybe-keep** | If tool-engine dispatches them. |
| cron-builder | **archive** | Daemon uses `croner` directly. |
| agent-registry | **archive** | Subagent flow is hardcoded today. |
| tool-router | **archive** | `tool-loop.ts` already routes. |
| queue-scheduler | **archive** | Daemon `cron` covers this. |
| redaction-pipeline | **maybe-keep** | If we ship a privacy filter. |

**Recommendation:** keep the entire `packages/engine/src/runtime/` tree on disk for now (commits already shipped, tests are cheap), but **stop building new modules**. They are an experiment library, not the product. Future waves are forbidden until at least one real product gap closes.

---

## 3. What's actually missing — the real finish line

From `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md` and `docs/full-launch-roadmap.md`, the gating items between today and "user can sign up and ship" are:

### Real blockers
1. **iPhone packaging** — needs a machine with full Xcode (currently fails on CLT-only). TestFlight URL is the gate to GO.
2. **Final launch recommendation** sits at NO-GO until iPhone path publishes.

### Real product polish (not modules)
3. **Heartbeat daemon** is implemented in `daemon/` and works locally — needs to be a `systemd`/`launchd` deploy artifact with health endpoint reachable in production.
4. **Telegram bot** implemented in `daemon/telegram/` — needs production token, webhook URL, smoke test.
5. **Sign-up + project flow smoke** — `app/onboarding/`, `app/login/`, project CRUD in `app/projects/` (verify a fresh user can sign up → create project → see live data without manual setup).
6. **Test suite green from repo root** (vitest config in `packages/engine/vitest.config.ts` references missing `__tests__/setup.ts` when run from inside the package — already passes from repo root, but should be made work in both directories).

### Already done
- Multi-agent runtime exists & is wired into UI traces.
- Web app is live on `https://ceoclaw-dev.vercel.app`.
- macOS DMG signed & published.
- Release hub (`/release`) live with smoke checks.
- Provider router with Zhipu → ZAI → OpenRouter → Ollama fallback.
- Local Whisper, BYOK, JSON session persistence.

---

## 4. Focused finish-line plan (no new modules)

### Phase F1 — Stabilize what's shipped (this session)
- [F1.1] Fix `packages/engine/vitest.config.ts` to make tests runnable from both repo root and package dir without `Cannot find module __tests__/setup.ts`.
- [F1.2] Run full test suite from repo root, confirm green.
- [F1.3] Run `tsc --noEmit` across the workspace, fix any drift.
- [F1.4] Run the lint gate exactly once and triage; do not chase pre-existing style.

### Phase F2 — Verify the real product end-to-end (next session)
- [F2.1] Boot `daemon/` locally, confirm `/health` reachable, cron jobs tick, telegram bot responds to `/start`.
- [F2.2] Run the existing release gate: `npm run release:check`. Triage any regression.
- [F2.3] Walk a sign-up flow in dev: register → create project → create task → see live data → refresh. File any blocker as a bug, not a "build a new module" task.

### Phase F3 — Unblock iPhone (the real gate)
- [F3.1] Document the exact Xcode version, signing identity, App Store Connect team needed.
- [F3.2] Either: (a) build the IPA on a machine with full Xcode, upload to TestFlight; or (b) write a runbook for whoever has the Xcode machine.
- [F3.3] Once TestFlight URL is live, update `app/release/` page and flip the launch recommendation to GO.

### Phase F4 — Wire (only if needed) one runtime module per real bug
The 40 modules stay on disk as a salvage library. **Do not pre-emptively wire any of them.** Only wire one if a concrete bug or roadmap item demands it. Examples that *might* qualify:
- If provider failures storm in prod → wire `circuit-tracker` into `provider-router`.
- If user wants spend dashboard → wire `cost-tracker` behind `/api/admin/spend`.
- If RAG ships as a product feature → wire `semantic-search` + `embedding-cache`.

Each wiring is a separate, justified PR with a user-visible feature attached. No more "module wave" PRs.

### Phase F5 — Archive the dead waves
- [F5.1] Move all "archive" modules (per §2 table) under `packages/engine/src/runtime/_archive/` in a single sweep, with a README explaining "experimental, not in build". Keeps tests but removes from dependency graph.
- [F5.2] Add a CONTRIBUTING note: new runtime modules require a linked product feature.

---

## 5. Rules going forward

1. **Stop building unwired modules.** Every PR must close a roadmap item or ship a user-visible feature.
2. **No more "Wave N+1".** Waves are a smell — they reward volume over impact.
3. **Read the launch plan first.** `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md` is the source of truth for what's blocking GO.
4. **CTO test:** before writing code, ask "does this move iPhone TestFlight, sign-up flow, daemon deploy, or release gate forward?" If no, don't write it.
5. **Library debt is real debt.** 40 modules × ~100 LOC each = 4000+ LOC of code reviewers must mentally page in. Archive ruthlessly.

---

## 6. Immediate next action

Do not launch another sub-agent. Instead:
1. Confirm this plan with the user.
2. If approved, execute Phase F1 (vitest config + green-from-repo-root) as the first orchestrator-only task.

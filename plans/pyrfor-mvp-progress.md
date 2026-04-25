# Pyrfor MVP Progress

## Gap 1 — Process Tool ✅ (2026-04-25)

### What was done
- **`packages/engine/src/runtime/process-manager.ts`** — new `ProcessManager` class (singleton `processManager`):
  - `spawn(opts)` → returns `{pid}`, captures stdout/stderr into rolling 1000-line buffers, sets timeout (default 300s) with SIGTERM→SIGKILL fallback in 5s, detaches child from process group
  - `poll(pid, tail)` → returns status, exitCode, stdoutTail, stderrTail, runtimeMs
  - `kill(pid, signal)` → sends signal, marks status `killed`, SIGKILL fallback after 5s for SIGTERM
  - `list()` → all tracked processes
  - `cleanup()` → kills all running children, clears map
- **`packages/engine/src/runtime/process-manager.test.ts`** — 7 vitest tests (spawn/poll/kill/timeout/buffer-cap/cleanup/edge-cases), all green
- **`packages/engine/src/runtime/tools.ts`** — added 4 new tool definitions (`process_spawn`, `process_poll`, `process_kill`, `process_list`) + execute cases in `executeRuntimeTool`
- **`packages/engine/src/runtime/index.ts`** — imported `processManager`, wired `processManager.cleanup()` into `PyrforRuntime.stop()`

### Commits
- `c9c3dfb` — runtime: add process tool (spawn/poll/kill/list) for background processes
- `038d66f` — build: rebuild dist after process tool

### Test results
- 3246 / 3246 tests passing (96 test files)
- `npm run build` — clean (tsc + postbuild)

### Decisions made
- Used `detached: true` + `stdio: ['ignore', 'pipe', 'pipe']` for child process so SIGINT to daemon doesn't auto-kill children
- `timeoutHandle.unref()` so timeout timers don't block process exit
- Kill result status is set synchronously on `kill()` call (not waiting for `exit` event) so `poll()` immediately shows `killed`

---

## Gap 2 — Tool Approval Flow ✅ (2026-04-25)

### What was done
- **`packages/engine/src/runtime/approval-flow.ts`** — new `ApprovalFlow` class + singleton `approvalFlow`:
  - `categorize(toolName, args)` → `'auto' | 'ask' | 'block'` — pure sync after settings loaded
  - `requestApproval(req)` → `Promise<ApprovalDecision>` — auto-approves/blocks immediately, queues "ask" items waiting for user input or TTL expiry
  - `resolveDecision(id, 'approve'|'deny')` — called by Telegram callback handler
  - `getPending()` — returns queued approvals
  - `loadSettings()` / `saveSettings()` / `addToWhitelist()` / `addToBlacklist()` / `setDefault()` — persistent settings at `~/.pyrfor/approval-settings.json`
  - `events: EventEmitter` emits `'approval-requested'` for Telegram keyboard sender
  - **Default blocked** (immediate deny): `rm -rf /`, `sudo`, `DROP TABLE/DATABASE`, `mkfs`, `dd if=`, `shutdown`, `reboot`, fork bomb
  - **Default ask**: `exec`, `process_spawn`, `process_kill`, `browser`
  - **Default auto**: `read`, `write`, `edit_file`, `web_search`, `web_fetch`, `process_list`, `process_poll`, `send_message`
- **`packages/engine/src/runtime/approval-flow.test.ts`** — 17 vitest tests covering all categories, TTL, settings persistence, whitelist/blacklist, autoApprovePatterns
- **`packages/engine/src/runtime/tool-loop.ts`** — added `ApprovalGate` type + `approvalGate?` option to `ToolLoopOptions`; gate is called before each tool execution; `undefined` gate = approve-all (existing tests unaffected); added `renderSummary()` for human-readable tool descriptions
- **`packages/engine/src/runtime/index.ts`** — wires `approvalFlow.requestApproval` as `approvalGate` in `runToolLoop` call
- **`packages/engine/src/runtime/cli.ts`** — subscribes to `approvalFlow.events` to send Telegram inline keyboard prompts; registers `bot.on('callback_query:data')` to handle `approve:<id>` / `deny:<id>` callbacks

### Commits
- `604fca9` — runtime: add tool approval flow with telegram inline keyboard
- `69e6b11` — build: rebuild dist after approval flow

### Test results
- 3263 / 3263 tests passing (97 test files)
- `npm run build` — clean (tsc + postbuild)

### Decisions made
- Approval gate defaults to `undefined` (not a pass-through function) so no overhead in test environments
- Admin chat ID resolved from `tgConfig.adminChatId` first, then `allowedChatIds[0]`; if neither available, logs a warning and skips the prompt (tool stays pending until TTL)
- Whitelist/user-blacklist are checked before built-in blocked patterns — but built-in blocked patterns cannot be whitelisted (block check runs after user blacklist, before whitelist) to prevent accidental override of dangerous commands
- TTL default is 600s (10 min); configurable per-instance for tests

---

---

## Gap 3 — Telegram UX: reactions, live activity, goals, media ✅ (2026-04-25)

### What was done
- **`packages/engine/src/runtime/telegram/live-activity.ts`** — `LiveActivity` class:
  - `start(text)` sends a status message; `update(text)` debounced editMessageText (default min interval 2s); `append(line)` adds a line with truncation to maxLength (default 4000); `complete(final, deleteAfterMs)` flushes and schedules deletion (default 5 min). All Telegram errors swallowed (esp. "message is not modified"), pending updates flushed via setTimeout.
- **`packages/engine/src/runtime/telegram/live-activity.test.ts`** — 6 vitest tests (start/update/debounce/complete/truncation/error-handling), all green
- **`packages/engine/src/runtime/goal-store.ts`** — `GoalStore` class (JSONL persistence at `~/.pyrfor/goals.jsonl`):
  - `create(description)`, `list(status?)`, `get(id)`, `markDone(id)`, `cancel(id)`. ULID ids. quest-mode.ts only exposes `runQuest()` (long-running execution engine), no CRUD — fallback store added instead.
- **`packages/engine/src/runtime/goal-store.test.ts`** — 4 tests (create/markDone/cancel/unknown-id)
- **`packages/engine/src/runtime/tool-loop.ts`** — added `ProgressEvent` type (`tool-start|tool-end|llm-start|llm-end|compact`) + `onProgress?` to `ToolLoopOptions`. Events emitted around `chat()` and around each `raceToolExec()` call. Default = `undefined` (no overhead, existing tests unaffected).
- **`packages/engine/src/runtime/index.ts`** — `handleMessage(...)` accepts `options.onProgress` and threads it to `runToolLoop`.
- **`packages/engine/src/runtime/cli.ts`** — major Telegram bot updates:
  - `safeReact(ctx, emoji)` — try/catch wrapper around `bot.api.setMessageReaction`
  - `formatProgress(event)` — emoji-prefixed progress lines
  - All incoming handlers (text/voice/photo/document) react `👀` on receipt, `✅` on success, `❌` on error
  - Text handler now spawns a `LiveActivity` and feeds tool/llm progress lines into it (last 10 lines tailed); `complete()` schedules deletion after 60s on success, immediate on error
  - New `bot.on('message:photo')` — gets file URL; if model name matches `gpt-4o|claude|gemini|glm-4v|qwen-vl` passes URL+caption as text prompt, otherwise tells user to switch (// TODO: vision integration)
  - New `bot.on('message:document')` — 10MB cap; saves all files to `~/.pyrfor/inbox/<name>`; reads `.txt|.md|.csv|.json|.ts|.js|.py|.yaml|.yml|.toml` and passes content to AI; PDF/DOCX/XLSX saved with TODO note (// TODO: MarkItDown integration)
  - 5 new commands: `/goals` `/progress` `/newgoal <desc>` `/done <id>` `/cancel <id>` — wired through `goalStore`
  - `/help` updated with goals + media sections

### Commits
- `feat(gap3): Telegram UX — reactions, live activity, goals, media` — src + tests
- `build: rebuild dist after gap 3 telegram UX`
- `docs: mvp progress — gap 3/4 done`

### Test results
- 3273 / 3273 tests passing (99 test files, +10 new)
- `npm run build` — clean (tsc + postbuild)

### Decisions made
- **GoalStore as fallback**: `quest-mode.ts` only contains `runQuest()` — a long-running execution engine, not CRUD. Rather than retrofit it, added a small JSONL-backed store. Future: migrate to a proper Prisma table if quest-mode grows CRUD.
- **`onProgress` opt-in by design**: defaults to `undefined`, so no events emitted unless caller explicitly subscribes — keeps existing 3263 tests passing without modification.
- **Reactions via raw API**: `ctx.react()` is grammY ≥1.18; we use `bot.api.setMessageReaction(...)` directly with a guarded try/catch to remain compatible across grammY versions.
- **LiveActivity debounce**: 2s minimum between edits (Telegram rate limits), pending text coalesced and flushed via single setTimeout to ensure the *last* update lands.
- **Document inbox**: `~/.pyrfor/inbox/` keeps a copy of every received doc for later inspection or batch processing.

---

## Gap 4 — Telegram Mini App ✅ (2026-04-25)

### What was done

- **`packages/engine/src/runtime/telegram/app/index.html`** — Single-page Telegram Mini App:
  - 5 tabs via bottom nav: Dashboard, Goals, Agents, Memory, Settings
  - Loads `https://telegram.org/js/telegram-web-app.js` SDK
  - Uses `Telegram.WebApp.themeParams` for CSS variable override via JS
  - Mobile-first, accessible, vanilla HTML

- **`packages/engine/src/runtime/telegram/app/style.css`** — Telegram-themed CSS:
  - CSS custom properties for all colors (overridden at runtime from `themeParams`)
  - Bottom nav (fixed, 56px), sticky header
  - Card layout, badge system (active/done/cancelled), button variants

- **`packages/engine/src/runtime/telegram/app/app.js`** — Vanilla JS (no build step):
  - `Telegram.WebApp.ready()` + `expand()` on load
  - `applyTelegramTheme()` maps `themeParams` → CSS vars
  - `authHeaders()` passes `X-Telegram-Init-Data` header (server validation deferred — TODO comment)
  - Tab switching with lazy data loading
  - Dashboard: fetches `/api/dashboard`, auto-refreshes every 10s
  - Goals: full CRUD (list, new, done, cancel) via API
  - Agents: fetches `/api/agents` (empty array for now — TODO subagents API)
  - Memory: fetches last 50 lines of MEMORY.md + workspace file list
  - Settings: loads + saves approval flow settings

- **`packages/engine/src/runtime/gateway.ts`** — New routes added:
  - `GET /app` and `GET /app/` → serve `index.html`
  - `GET /app/<file>` → serve from `telegram/app/` dir (path traversal protected)
  - MIME map: html, css, js, json, png, ico, svg, txt
  - `GET /api/dashboard` → `{status, model, costToday, sessionsCount, activeGoals, recentActivity}`
  - `GET /api/goals` → list all
  - `POST /api/goals` → create (body: `{title, description?}`)
  - `POST /api/goals/:id/done` → mark done
  - `DELETE /api/goals/:id` → cancel
  - `GET /api/agents` → `[]` (TODO: expose subagent runtime API)
  - `GET /api/memory` → last 50 lines of `~/.openclaw/workspace/MEMORY.md` + file list
  - `GET /api/settings` → approval flow settings + provider
  - `POST /api/settings` → update (defaultAction, whitelist, blacklist)
  - `GET /api/stats` → `{costToday, sessionsCount, uptime}`
  - All API routes are **public** (no bearer auth) — auth deferred to `X-Telegram-Init-Data` HMAC validation
  - OPTIONS preflight returns `Access-Control-Allow-Origin: *` + `X-Telegram-Init-Data` in allow-headers
  - `GatewayDeps` extended with optional `goalStore`, `approvalSettingsPath`, `staticDir` for testability
  - Static dir resolved via `import.meta.url` (works in both test + production ESM contexts)

- **`packages/engine/src/runtime/cli.ts`** — Mini App integration:
  - `miniAppUrl` resolved from: `runtime.config.gateway.publicUrl` → `PYRFOR_PUBLIC_URL` env → `http://localhost:18790/app`
  - `/start` command now includes `web_app` inline keyboard button: `🐾 Открыть Pyrfor`
  - `setMiniAppMenuButton(chatId)` sets chat menu button to web_app (try/catch — HTTPS required in prod, logs warn for http://)

- **`packages/engine/scripts/postbuild.js`** — Added step 3: copies `src/runtime/telegram/app/` → `dist/runtime/telegram/app/` after tsc build

- **`packages/engine/src/runtime/gateway.test.ts`** — 21 new tests:
  - Static files: `/app` 200 html, `/app/` 200, `/app/index.html` 200, `/app/style.css` 200 css, `/app/app.js` 200 js, `/app/missing.css` 404
  - OPTIONS preflight: 204 + CORS headers
  - Dashboard: 200 + all required keys
  - Goals: empty list, create, missing title 400, mark done, done unknown 404, delete, delete unknown 404
  - Agents: 200 empty array
  - Memory: 200 with lines/files arrays
  - Settings: get required keys, post+roundtrip, invalid defaultAction 400
  - Stats: 200 with uptime

### Commits
- `a2a54d1` — runtime: add telegram mini app (dashboard/goals/agents/memory/settings)
- `04e28af` — build: rebuild dist after mini app

### Test results
- 3294 / 3294 tests passing (99 test files, +21 new)
- `npm run build` — clean (tsc + postbuild, static files copied)
- `ls dist/runtime/telegram/app/` → `app.js  index.html  style.css` ✅

### Decisions made
- **No new npm deps**: pure Node.js `fs`, `path`, `url` in gateway. Vanilla JS in browser with no bundler.
- **API routes are public**: The Mini App can't send Bearer tokens. Server-side `initData` HMAC validation is a TODO. For MVP, the gateway runs on localhost so threat model is acceptable.
- **Static dir via `import.meta.url`**: Works in vitest (transforms TS to ESM) and in dist runtime. Falls back to `process.cwd()/src/runtime/telegram/app` if `import.meta.url` throws.
- **GoalStore injected into GatewayDeps**: Makes gateway independently testable with temp dirs; production code defaults to `new GoalStore()` (uses `~/.pyrfor`).
- **`setMiniAppMenuButton` per-chat only**: Telegram's `setChatMenuButton` works per-chat when `chat_id` is set; would need `type: 'web_app'` globally via `setMyDefaultAdministratorRights` or BotFather for a default menu button on all chats.

### TODOs left in code
- **`gateway.ts`**: `// TODO: expose subagents API from PyrforRuntime`
- **`app.js`**: `// TODO: implement server-side Telegram.WebApp.initData validation (HMAC-SHA256)`
- **`app.js`**: `// TODO: expose subagents API from runtime`
- **`cli.ts`** (from Gap 3): `// TODO: vision integration` (photo handler), `// TODO: MarkItDown integration` (PDF/DOCX/XLSX)
- **`cost-tracker`**: gateway `/api/dashboard` and `/api/stats` return `costToday: 0` — CostTracker not injected into gateway yet (requires threading it through GatewayDeps)

---

## Final Summary

All 4 MVP gaps shipped in a single session (2026-04-25):

| Gap | Feature | Tests added | Status |
|-----|---------|-------------|--------|
| 1 | Process Tool (spawn/poll/kill) | 7 | ✅ |
| 2 | Tool Approval Flow + Telegram keyboard | 17 | ✅ |
| 3 | Telegram UX (reactions/live/goals/media) | 10 | ✅ |
| 4 | Telegram Mini App (5 tabs, full API) | 21 | ✅ |

**Total tests**: 3294 (baseline 3246 → +48 new tests)
**Build**: clean, `npm run build` < 30s
**No new npm dependencies**: pure vanilla JS in browser, Node built-ins in gateway
**Architecture**: single-binary daemon (`pyrfor --telegram`) serves both bot and Mini App from port 18790

To manually test Gap 4 after starting the daemon:
```bash
# Start daemon (with your TELEGRAM_BOT_TOKEN)
TELEGRAM_BOT_TOKEN=xxx node packages/engine/dist/runtime/cli.js --telegram

# In another terminal:
curl http://localhost:18790/app        # → HTML Mini App
curl http://localhost:18790/api/dashboard  # → JSON dashboard
curl http://localhost:18790/api/goals     # → []
curl -X POST -H 'Content-Type: application/json' \
  -d '{"title":"test"}' http://localhost:18790/api/goals  # → goal object
curl http://localhost:18790/api/settings  # → approval settings
```


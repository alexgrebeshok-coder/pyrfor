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

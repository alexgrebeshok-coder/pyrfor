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

## What's next (Gaps 3–4)

- **Gap 3** — Persistent task queue / job scheduler (survives restarts)
- **Gap 4** — Self-update / hot-reload of config + skills without daemon restart

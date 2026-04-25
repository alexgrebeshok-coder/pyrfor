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

## What's next (Gaps 2–4)

- **Gap 2** — File watching / fs events tool (`fs_watch`, `fs_unwatch`)
- **Gap 3** — Persistent task queue / job scheduler (survives restarts)
- **Gap 4** — Self-update / hot-reload of config + skills without daemon restart

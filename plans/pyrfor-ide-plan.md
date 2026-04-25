# Pyrfor IDE — Plan

**Status:** v0 shipping this session | **Updated:** 2026-04-25

---

## Vision

Pyrfor IDE is a browser-based development environment served directly by the Pyrfor daemon at `/ide` on the existing HTTP gateway (port 18790). It turns Pyrfor from "Telegram-first" into "Telegram + browser IDE" — reusing the daemon, runtime, tool chain, provider router, auth tokens, and observability that are already running. It is not a Zed fork, not a VS Code fork, not an Electron app, and not a new service: the daemon that already runs becomes the IDE backend with zero new infrastructure. Web-first means it ships in hours, not months, and runs on any device with a browser — including a phone. The long-term ideal (Zed fork, see below) remains on the roadmap once v0 validates demand.

---

## v0 Scope

| Feature | Status (this session) | Notes |
|---|---|---|
| Monaco editor (CDN) | **shipping** | No npm package; loaded from `cdn.jsdelivr.net` |
| File tree | **shipping** | Backed by `/api/fs/list`; single workspace root |
| Chat panel wired to PyrforRuntime | **shipping** | POST `/api/chat`; reuses existing `handleMessage` |
| Command runner via `/api/exec` | **shipping** | Thin shell over existing exec tool; timeout guarded |
| Save with Ctrl+S | **shipping** | PUT `/api/fs/write`; auto-save on shortcut |
| Path-traversal safe FS API | **shipping** | `fs-api.ts` resolves + clamps all paths to workspace root |
| Bearer auth re-use | **shipping** | Same token as Telegram mini-app; 401 prompt on first load |
| Mobile drawer fallback | **shipping** | File tree + chat collapse into bottom/side drawers on narrow viewport |
| PTY terminal | **DEFERRED** | Needs `node-pty` + WebSocket upgrade; v1 item |
| LSP integration | **DEFERRED** | No autocomplete / go-to-def in v0; CDN Monaco only |
| Voice input / output | **DEFERRED** | Post-v1; needs Whisper.cpp or browser STT |
| CEOClaw dashboard panel | **DEFERRED** | iframe or new gateway endpoint; v1 item |
| Quest Mode UI | **DEFERRED** | Spec → plan → execute flow; reuses `handleMessage` but needs dedicated UX |
| Memory Wiki panel | **DEFERRED** | `/api/memory` exists; panel is a v1 addition |
| Background agents UI | **DEFERRED** | Sub-agent spawn/monitor; post-v1 |

---

## Architecture

### Backend

New pure-TS module `packages/engine/src/runtime/ide/fs-api.ts`:
- Exports `listDir`, `readFile`, `writeFile`, `searchFiles`
- All paths resolved via `path.resolve(workspaceRoot, userPath)` then `startsWith(workspaceRoot)` check — hard block on traversal
- No new npm deps; uses Node `fs/promises` only

Gateway routes (registered in existing router):

```
GET  /api/fs/list?path=    → fs-api.listDir
GET  /api/fs/read?path=    → fs-api.readFile
PUT  /api/fs/write         → fs-api.writeFile   (body: { path, content })
GET  /api/fs/search?q=     → fs-api.searchFiles
POST /api/chat             → PyrforRuntime.handleMessage
POST /api/exec             → existing exec tool (guarded: 30 s timeout)
GET  /ide/*                → static: packages/engine/src/runtime/telegram/ide/
```

All routes protected by existing bearer-token middleware.

### Frontend

Static assets at `packages/engine/src/runtime/telegram/ide/`:

```
index.html   — shell, loads Monaco from CDN, wires panels
style.css    — three-pane grid; mobile drawer overrides
app.js       — file tree fetch, editor events, chat fetch, exec runner
```

**Layout (desktop):**

```
┌──────────────┬────────────────────────┬────────────────┐
│  File Tree   │     Monaco Editor      │   Chat Panel   │
│  (200px)     │     (flex 1)           │   (300px)      │
│              │                        │                │
│              ├────────────────────────┤                │
│              │   Command Runner       │                │
│              │   (120px, bottom)      │                │
└──────────────┴────────────────────────┴────────────────┘
```

**Mobile:** file tree and chat collapse into drawers toggled by header buttons.

### Reuses (no changes needed)

| Existing piece | How IDE uses it |
|---|---|
| Bearer auth middleware | `/api/*` routes inherit it unchanged |
| Rate limiter | Same per-IP limiter applied to new routes |
| `GoalStore` | Chat panel can read active goals (v0: read-only) |
| `PyrforRuntime.handleMessage` | Chat POST body forwarded directly |
| Observability / logging | Gateway logs all `/api/ide/*` calls already |
| `postbuild` copy step | Copies `ide/` assets into `dist/` alongside `app/` |

### Request flow

```
Browser
  │  GET /ide/index.html  (static)
  ▼
Gateway static handler
  │  serves packages/engine/src/runtime/telegram/ide/
  ▼
Browser JS (app.js)
  │  GET /api/fs/list?path=/
  │  PUT /api/fs/write  { path, content }
  │  POST /api/chat     { message }
  │  POST /api/exec     { command }
  ▼
Gateway routes (auth middleware → handler)
  │
  ├─ fs-api.ts  (list / read / write / search)
  └─ PyrforRuntime.handleMessage  (chat)
       └─ provider-router → ZAI / Zhipu / OpenRouter / Ollama / …
```

---

## Why Not a Zed Fork (Right Now)

The research (`pyrfor-ide-research-2026-04-25.md`) correctly identifies a Zed fork as the architecturally ideal long-term path: Rust + GPUI gives native GPU speed, built-in terminal, real-time collaboration, and a live extension ecosystem. The research estimates "1-2 months to MVP" — and that means calendar months of focused Rust engineering, not session hours. Pyrfor is TypeScript; the Zed codebase is Rust + a custom GPU UI framework (GPUI). Bridging the two requires either a thin sidecar protocol (ACP) or rewriting Pyrfor pieces in Rust, neither of which is a quick lift. Attempting it today would stall shipping entirely.

A working browser v0 ships in this session. It validates the core user story — "open a browser, see files, edit, chat, run a command" — with zero new infrastructure and zero Rust. Every hour of real usage produces concrete UX evidence: which features matter, which panel layouts work, what the chat integration actually needs from the runtime. That evidence is exactly what a hypothetical Zed fork would require to design well.

After v1 (see roadmap), if the web IDE hits a hard ceiling — offline use, terminal speed, extension ecosystem, latency — a Zed fork re-evaluation is the planned next step. The two paths are sequential, not competing.

---

## Roadmap to v1 (Post-Session)

1. **WebSocket + node-pty** — true PTY terminal in the bottom panel; replaces the `/api/exec` one-shot runner
2. **Goal Tracker sidebar** — read/write `GoalStore`; surface active goals and mark done from IDE
3. **CEOClaw dashboard panel** — iframe of existing CEOClaw Next.js app OR a new `/api/dashboard` endpoint; gives EVM/Gantt/Kanban inside IDE
4. **Quest Mode UI** — Spec → Plan → Execute flow driven by `handleMessage`; dedicated panel with step-by-step progress
5. **Memory Wiki panel** — renders and edits `MEMORY.md` / daily notes via `/api/memory`
6. **Approval-flow inline UI** — surfaces pending approvals from the approval-flow singleton directly in the IDE (no Telegram trip required)
7. **Background agents UI** — spawn sub-agents, monitor live status, cancel or reassign
8. **Multi-cursor + Codemaps** — Monaco multi-cursor polish; Windsurf-style Codemaps for large-file navigation
9. **Re-evaluate Zed fork** — only after v1 ships and usage shows a clear ceiling that the web stack cannot clear

---

## Test Invariants

| Invariant | Expectation |
|---|---|
| Vitest baseline | 3298 passing → expected ~3320+ after Waves 1-2 add new test files; must not regress |
| `tsc --noEmit` on `src/` | Must be clean; 38 pre-existing test-file drifts are allowlisted |
| New npm deps in v0 | None — no `monaco-editor` package, no `node-pty`, no new heavy peer deps |
| Static asset delivery | Via existing `postbuild` copy step; no new build tooling |
| Path traversal | Any `..` escape from workspace root → 403; covered by unit tests in Wave 1 |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Monaco from CDN = offline-broken | Medium | Acceptable for v0; v1 bundles Monaco locally via esbuild/vite |
| FS access only via HTTP (not native `fs`) | Low | Negligible for IDE use case; adds ~1-5 ms per op on localhost |
| Single workspace root in v0 | Low | Multi-root is a v1 item; single root covers the primary use case |
| No LSP = no autocomplete, no go-to-definition | Medium | Users aware; TypeScript hover types still available via Monaco's built-in JS inference |
| No git UI in v0 | Low | Terminal (exec) is the escape hatch; git panel is v1 |
| Token exposed in browser localStorage | Medium | Daemon is localhost-only; same exposure as existing Mini App |

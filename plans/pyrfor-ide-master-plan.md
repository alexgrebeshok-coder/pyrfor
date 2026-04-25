# Pyrfor IDE — Master Plan v2 (lean, Node-heavy, минимум Rust)

**Источник анализа:** `~/Downloads/pyrfor-ide-full-analysis-2026-04-25.md`
**Цель:** `Pyrfor.app` уровня Cursor/Zed/Claude-Code на этом MacBook.
**Принцип:** максимум логики — в Node runtime (`packages/engine`), Rust shell минимален.

---

## 1. Что есть на старте (HEAD `ee1ebc5`)

- `src-tauri/` — рабочий Tauri 2.5.6 проект CEOClaw Desktop. Bin `ceoclaw-desktop`. Plugin-shell, plugin-window-state, tray-icon. **Собирается, работает.**
- `packages/engine/` — Pyrfor runtime (Node 22), 3365 vitest зелёных. dist/ свежий.
- v0 web-IDE на `localhost:18790/ide` — Monaco через CDN, file tree, chat, command runner. Endpoints `/api/fs/list|read|write|search`, `/api/chat`, `/api/exec`.
- Toolchain: Rust 1.94, Node 22.22, Xcode CLT 26, macOS 26.3 Apple Silicon.

---

## 2. Финальный продукт (v1.0)

`Pyrfor.app` (.dmg, signed Apple Developer ID, notarized, ≤25 MB):

1. Двойной клик → окно ≤1 c, ≤80 MB RAM idle.
2. Vite+React+Monaco frontend (offline, без CDN).
3. **File tree** + multi-tab editor + Cmd+S, find-replace, Ctrl+P file search.
4. **Streaming AI chat** (SSE) с multi-file context (открытые табы), `.pyrforrules`, "Apply to file" с inline diff.
5. **Real PTY terminal** через `node-pty` в sidecar (vim/htop/fzf/nvim работают), multi-tab, persistent history, resize.
6. **Git UI** через shell-exec в sidecar — status bar branch+dirty, stage/unstage/commit, Monaco DiffEditor, blame.
7. **Sidecar Pyrfor daemon** — упакованный `packages/engine/dist/` + Node runtime. Telegram бот, provider router, tools, ACP client (TS).
8. **Settings UI** — темы, шрифты, keybindings, daemon URL, провайдер ключи (macOS Keychain через `keyring` Rust crate).
9. **Workspace persistence** — окно, табы, expanded folders, recent workspaces.
10. **Auto-update** — `tauri-plugin-updater` + GitHub Releases.
11. **Code-signed + notarized** — Gatekeeper passes (`spctl --assess`).

**Monaco built-in features используем как есть:** TypeScript/JavaScript autocomplete, синтаксис-хайлайт, форматирование. Полноценный LSP (pyright/rust-analyzer) — **post-v1.0**.

**Inline AI completion (ghost-text) — post-v1.0.** v1.0 = чат + терминал + git, и этого хватит чтобы догнать Claude Code/Cursor по основным сценариям (рефакторинг через chat + Apply, не через ghost-text).

---

## 3. Архитектура

```
┌─ Pyrfor.app (Tauri shell) ────────────────────────────────────┐
│                                                                │
│  WKWebView (macOS native)                                      │
│   └── apps/pyrfor-ide/web/dist/  (Vite production)             │
│       ├── React 18 + TypeScript                                │
│       ├── Monaco Editor (npm offline)                          │
│       ├── xterm.js + addon-fit + addon-web-links               │
│       └── components: <FileTree/> <Tabs/> <Editor/>            │
│                       <Chat/> <Terminal/> <GitPanel/>          │
│                       <StatusBar/> <SettingsModal/>            │
│                                                                │
│  Rust core (минимальный, 95% reuse from existing src-tauri/)   │
│   ├── window + tray + native menu                              │
│   ├── sidecar manager — spawn pyrfor-daemon, port discovery    │
│   ├── tauri-plugin-window-state (уже подключён)                │
│   ├── tauri-plugin-shell (уже подключён, для Open в Finder)    │
│   ├── tauri-plugin-updater (новый, Phase E)                    │
│   ├── keyring crate (для secrets, Phase E)                     │
│   └── 1 команда: `get_daemon_port() -> u16` (всё остальное —   │
│       fetch к localhost:port из фронта)                        │
│                                                                │
│  Sidecar: pyrfor-daemon                                        │
│   ├── Node 22 binary + packages/engine/dist/                   │
│   ├── Поднимает gateway на :0 (random port), пишет в stdout    │
│   ├── Существующие endpoints: /api/fs/*, /api/chat, /api/exec  │
│   ├── Новые endpoints (по фазам):                              │
│   │   /api/chat/stream  (SSE)         — Phase B                │
│   │   /api/pty/* + WS /ws/pty/:id     — Phase C                │
│   │   /api/git/*                       — Phase D                │
│   │   /api/settings (read-only)        — Phase E                │
│   ├── ACP client (TS) для FreeClaude/Codex supervision (post-1)│
│   └── Telegram bot, provider router (без изменений)            │
└────────────────────────────────────────────────────────────────┘
```

**Ключевые решения после фидбэка:**

| Было в v1 плана | Стало в v2 (после правок) |
|---|---|
| Новый scaffold Tauri | **Форк существующего `src-tauri/` → `apps/pyrfor-ide/`** |
| Next.js desktop-shell | **Vite + React** (лёгкий бандл) |
| Rust FS commands | Sidecar Node + существующие `/api/fs/*` endpoints |
| Rust portable-pty | **node-pty в Node sidecar** + WS bridge |
| Rust git2 crate | **shell-exec git + `/api/git/*`** в Node sidecar |
| ACP client в Rust | **ACP client в TypeScript** в `packages/engine` |
| LSP в Phase E (v1.0) | **LSP — post-v1.0** (Monaco built-in TS уже хватает) |
| Inline AI completion в Phase C | **Inline completion — post-v1.0** |

Rust остаётся **тонкой оболочкой**: окно, tray, sidecar lifecycle, обновление, Keychain. Всё остальное — на Node, что даёт переиспользование тестов и быстрый цикл разработки.

---

## 4. Структура репозитория

```
ceoclaw-dev/
├── src-tauri/                ← существующий CEOClaw Desktop, не трогаем
├── apps/
│   └── pyrfor-ide/
│       ├── src-tauri/        ← форк существующего src-tauri
│       │   ├── Cargo.toml    (rename → "pyrfor-ide")
│       │   ├── tauri.conf.json (productName: "Pyrfor")
│       │   ├── src/
│       │   │   ├── main.rs / lib.rs
│       │   │   └── sidecar.rs   (новый: spawn pyrfor-daemon)
│       │   └── binaries/
│       │       └── pyrfor-daemon-{aarch64-apple-darwin}  ← node + dist
│       └── web/              ← новая Vite+React фронт-приложение
│           ├── package.json
│           ├── vite.config.ts
│           ├── index.html
│           └── src/
│               ├── main.tsx
│               ├── App.tsx
│               ├── components/
│               ├── lib/api.ts (fetch wrapper, port from Tauri invoke)
│               └── styles/
└── packages/engine/          ← runtime, минимальные правки по фазам
```

`apps/pyrfor-ide/web/` использует **`vite + @vitejs/plugin-react + monaco-editor + @monaco-editor/react`**. Никаких Next.js — финальный bundle ≤ 5 MB JS вместо 200 MB Next.js dist.

UI стиль и компоненты переносятся 1:1 из существующего `packages/engine/src/runtime/telegram/ide/{index.html,style.css,app.js}` — но реструктурированы в React-компоненты для maintainability.

---

## 5. Фазы (каждая = выпуск работающего .app)

### Phase A — Fork + Vite/React/Monaco + sidecar daemon (v0.1.0)
**DoD:** Двойной клик `Pyrfor.app` → окно. Open Folder → дерево из существующего `/api/fs/list`. Открыть файл → Monaco. Edit + Cmd+S → сохранён через `/api/fs/write`. Чат работает через `/api/chat`.

**Технические шаги:**
1. `cp -r src-tauri apps/pyrfor-ide/src-tauri` → переименовать `package.name`/`bin.name` → `pyrfor-ide`, `productName: "Pyrfor"`, `identifier: "dev.pyrfor.ide"`.
2. Удалить из форкнутого src-tauri references на CEOClaw `desktop-shell-dist`. Заменить `frontendDist` на `../web/dist`, `devUrl` на `http://localhost:5173` (Vite default).
3. Создать `apps/pyrfor-ide/web/` с Vite + React + TS + Monaco + `@tauri-apps/api`.
4. Перенести существующий UI из `packages/engine/src/runtime/telegram/ide/app.js` в React-компоненты (`<FileTree/>`, `<Tabs/>`, `<Editor/>`, `<Chat/>`, `<CommandRunner/>`). Стиль из `style.css` копируется как есть.
5. **Sidecar packaging:**
   - Собрать `packages/engine/dist/` в self-contained Node-бандл (через `pkg` или `nexe` или просто `node + dist/main.js` в archive). Решение: использовать **`@yao-pkg/pkg`** для одного бинарника `pyrfor-daemon-aarch64-apple-darwin`.
   - Положить в `apps/pyrfor-ide/src-tauri/binaries/`.
   - В `tauri.conf.json` объявить `bundle.externalBin`.
6. **Sidecar manager (Rust):**
   - Файл `src-tauri/src/sidecar.rs`: spawn `pyrfor-daemon` с `PYRFOR_PORT=0`, читать stdout, парсить строку `LISTENING_ON=18791`, сохранять порт в `tauri::State<u16>`.
   - Команда `#[tauri::command] fn get_daemon_port(state: State<u16>) -> u16`.
   - Auto-restart при crash, max 3 за 60 c.
   - Kill при `app.exit`.
7. **Frontend:** `lib/api.ts` — на старте вызывает `invoke('get_daemon_port')`, кладёт в global. Все fetch идут на `http://localhost:${port}/api/...`.
8. **Daemon side:** добавить флаг `--port=0` (random) и логирование `LISTENING_ON=N` после `server.listen` (новая правка в `packages/engine/src/runtime/gateway.ts`).
9. App menu: File → Open Folder, Save, Quit. Cmd-shortcuts.
10. `npm run tauri build` → `Pyrfor-0.1.0-aarch64.dmg`.

**Тесты:** vitest для `lib/api.ts` (mock fetch), Rust integration test для sidecar parse. Существующие 3365+ — без падений.

**Параллелизм sub-agents:**
- A1: fork src-tauri + sidecar manager Rust (1 агент Sonnet 4.6)
- A2: Vite+React scaffold + Monaco offline + перенос UI на React (1 агент)
- A3: pkg sidecar binary + gateway --port=0 + LISTENING_ON output (1 агент)

---

### Phase B — Streaming AI chat + multi-file context + .pyrforrules (v0.2.0)
**DoD:** Чат-ответ печатается token-by-token. AI видит все открытые табы как контекст. `.pyrforrules` инжектится в system prompt. "Apply to file" создаёт inline diff.

**Технические шаги:**
1. **Backend (`packages/engine`):**
   - `runtime/streaming.ts` — `handleMessageStream(input, openFiles?, rulesText?)` async generator, эмитит `{type:'token'|'tool'|'final', ...}`.
   - Endpoint `POST /api/chat/stream` в gateway: `text/event-stream`, читает generator, шлёт SSE events.
   - `runtime/project-rules.ts` — читает `<workspace>/.pyrforrules`, инжектит как system prompt suffix.
   - Body запроса расширен: `{text, openFiles?: [{path, content, language}], workspace?: string}`.
   - 100% backward-compat: существующий `/api/chat` остаётся.
2. **Frontend:**
   - `<Chat/>` использует `EventSource('/api/chat/stream', ...)`, рендерит токены в реальном времени.
   - При POST собирает `openFiles` из `state.tabs.filter(t => t.dirty || t.active)`, total ≤ 64 KB (обрезает).
   - "Apply to file" в ответе AI — кнопка вызывает Monaco `editor.deltaDecorations` с diff highlight + Accept/Reject buttons.
3. Status bar: "rules loaded ✓" если `.pyrforrules` найден.

**Тесты:** vitest для SSE парсинга + handleMessageStream + project-rules. Mock провайдер, проверка ordering events.

**Параллелизм:**
- B1: backend SSE + handleMessageStream + project-rules (1 агент)
- B2: frontend EventSource + Apply-to-file inline diff UI (1 агент)

---

### Phase C — PTY terminal через node-pty (v0.3.0)
**DoD:** В нижней панели — терминал-таб. `vim`, `htop`, `fzf`, `nvim`, `nano` работают. Multi-tab, resize, copy/paste.

**Технические шаги:**
1. **Sidecar Node:**
   - `npm install node-pty` в `packages/engine`. Native deps — соберутся при `npm install` (gyp).
   - `runtime/pty/manager.ts` — Map<id, IPty>, методы `spawn(cwd, shell?)`, `write(id, data)`, `resize(id, rows, cols)`, `close(id)`.
   - HTTP endpoints: `POST /api/pty/spawn` → `{id}`, `POST /api/pty/:id/resize`, `DELETE /api/pty/:id`.
   - WebSocket endpoint `/ws/pty/:id` — bidirectional binary stream (server→client = pty output, client→server = pty input).
2. **Frontend:**
   - `<Terminal/>` компонент поверх `@xterm/xterm` + `@xterm/addon-fit`.
   - При mount: POST spawn → получить id → открыть WS → подписать на data event.
   - Multi-tab UI в bottom panel (табы Terminal/Problems/Output).
   - ResizeObserver на контейнер → debounce 100мс → POST resize.
3. **Pkg + native deps:** `@yao-pkg/pkg` поддерживает `node-pty` через `--public` flag. Альтернатива — `prebuild` + копирование `.node` в Resources/. **Решение:** в Phase A пакуем daemon как **Node binary + node_modules tarball**, не single-binary, чтобы native modules работали. Tauri externalBin ссылается на launcher script, который запускает `node main.js`.

**Тесты:** spawn-and-echo (vitest с node-pty), e2e — открыть PTY, написать `echo hello`, проверить.

**Параллелизм:** 1 агент (тесно связано — backend + WS + frontend xterm).

---

### Phase D — Git UI + Monaco DiffEditor (v0.4.0)
**DoD:** В status bar — branch + dirty count. Sidebar `<GitPanel/>` со списком changed файлов. Stage/unstage чекбоксами. Commit dialog. Diff view через Monaco DiffEditor.

**Технические шаги:**
1. **Sidecar Node:**
   - `runtime/git/api.ts` — обёртка над `git` CLI (через `child_process.execFile`):
     - `gitStatus(workspace) → {branch, ahead, behind, files: [{path, x, y}]}` (parse `git status --porcelain=v2 --branch`)
     - `gitDiff(workspace, path, staged?) → string` (`git diff [--cached] -- path`)
     - `gitStage(workspace, paths) → void` (`git add ...`)
     - `gitUnstage(workspace, paths) → void` (`git reset HEAD ...`)
     - `gitCommit(workspace, message) → {sha}` (`git commit -m`)
     - `gitLog(workspace, limit) → [...]` (`git log --pretty=format:%H%x09%an%x09%at%x09%s`)
     - `gitBlame(workspace, path) → [...]` (`git blame --porcelain`)
   - HTTP endpoints `/api/git/status|diff|stage|unstage|commit|log|blame`.
2. **Frontend:**
   - `<GitPanel/>` — collapsible sidebar (toggle через Cmd+Shift+G).
   - `<GitStatusBar/>` — внизу справа.
   - `<DiffView/>` — Monaco DiffEditor (`monaco.editor.createDiffEditor`) с original=HEAD content, modified=working tree.
   - Commit dialog — textarea + Cmd+Enter submit.
3. File watcher (Phase A `chokidar` в sidecar) триггерит refresh git status через WS event `git:dirty`.

**Тесты:** integration-тесты на временном git-репо (init, add file, status, stage, commit, log).

**Параллелизм:** 1 агент.

---

### Phase E — Polish + signing + auto-update (v1.0.0)
**DoD:** `Pyrfor-1.0.0.dmg` на GitHub Releases, signed Apple Developer ID, notarized, auto-updater работает. Settings UI. Workspace persistence. Multi-root.

**Технические шаги:**
1. **Settings UI** — `<SettingsModal/>` (Cmd+,):
   - Theme (dark/light/auto), font, line height.
   - Keybindings (Monaco-style JSON edit).
   - Provider keys: Tauri command `set_secret(key, value)` пишет через `keyring` crate в macOS Keychain. `get_secret(key)` для чтения. Daemon читает через IPC при старте.
   - Telegram token, daemon log level.
   - Persisted в `~/.pyrfor/ide-settings.json` + Keychain.
2. **Workspace persistence:**
   - `~/.pyrfor/ide-state.json`: window x/y/w/h (через tauri-plugin-window-state, уже подключён), open tabs (paths), active tab, expanded folders, last workspace, recent workspaces (Cmd+Shift+R picker).
   - Save debounce 1s.
3. **Multi-root:** `<WorkspaceSwitcher/>` в title bar — recent + Open Folder. При смене — закрываем все табы/PTY, refresh git.
4. **Auto-update:**
   - `tauri-plugin-updater` + `tauri.conf.json` updater config (URL → GitHub Releases manifest).
   - Подпись manifest приватным ключом (`tauri signer generate`).
   - UI: при старте проверка → notification "Update available" → restart.
5. **Code signing:**
   - Apple Developer ID Application certificate (Alex регистрирует).
   - `tauri build --bundles dmg` с `APPLE_SIGNING_IDENTITY` env.
   - `xcrun notarytool submit Pyrfor-1.0.0.dmg --apple-id ... --wait` + `xcrun stapler staple`.
   - Verification: `spctl --assess --type execute /Applications/Pyrfor.app` → "accepted".
6. README в `apps/pyrfor-ide/README.md` — install, build, troubleshooting.

**Параллелизм:**
- E1: Settings UI + Keychain integration (1 агент)
- E2: Workspace persistence + multi-root switcher (1 агент)
- E3: Auto-updater + signing pipeline + CI (1 агент)

---

### Post-v1.0 (отложено явно)

- **LSP** — typescript-language-server, pyright, rust-analyzer, gopls как sidecars + monaco-languageclient. Phase F1.
- **Inline AI completion** (ghost-text) — `monaco.languages.registerInlineCompletionsProvider` + `/api/complete` endpoint с low-latency mode. Phase F2.
- **ACP client UI** — supervision панель для FreeClaude/Codex (TS клиент уже есть в Phase H плана Pyrfor). Phase F3.
- **Voice input** — Whisper API integration. Phase F4.
- **Plugin system** — extension API. Phase F5.
- **Windows / Linux** сборки — после стабилизации macOS.
- **iOS companion** — Tauri Mobile.
- **Real-time collab** — CRDT (Yjs/Automerge).
- **VS Code extension** — отдельный distribution канал (опц.).

---

## 6. Минимальные правки в `packages/engine`

Каждая фаза добавляет ровно столько, сколько нужно UI:

| Phase | Endpoints / модули | LOC оценка |
|---|---|---|
| A | `gateway.ts` `--port=0` + `LISTENING_ON` log | ~30 |
| B | `runtime/streaming.ts`, `/api/chat/stream`, `runtime/project-rules.ts` | ~250 |
| C | `runtime/pty/manager.ts`, `/api/pty/*`, WS `/ws/pty/:id`, `node-pty` dep | ~400 |
| D | `runtime/git/api.ts`, `/api/git/*` | ~300 |
| E | `runtime/settings/secrets-bridge.ts` (read from Keychain via Tauri IPC) | ~80 |

**Гарантия:** 3365+ vitest зелёных не падают ни в одной фазе. Каждый PR проходит `npx tsc --noEmit` + `npx vitest run`.

---

## 7. Toolchain (всё установлено или ставится тривиально)

- ✅ Rust 1.94, Node 22.22, Xcode CLT, macOS 26.3 ARM64
- ✅ Tauri 2.5.6 (уже в src-tauri/Cargo.toml)
- ➕ Vite 7 + React 19 + TypeScript — `apps/pyrfor-ide/web/package.json`
- ➕ `monaco-editor`, `@monaco-editor/react`, `@xterm/xterm`, `@xterm/addon-fit`
- ➕ `node-pty` (Phase C, нужен `xcode-select --install` — уже есть)
- ➕ `@yao-pkg/pkg` или сжатый Node + dist архив для sidecar packaging
- ➕ `keyring = "3"` Rust crate (Phase E)
- ➕ `tauri-plugin-updater = "2"` (Phase E)
- ➕ Apple Developer ID Application certificate (Phase E, Alex регистрирует)

---

## 8. Параллелизация по фазам

| Фаза | Кол-во волн | Время на фазу (грубо) |
|---|---|---|
| A | 3 | 1 проход |
| B | 2 | 1 проход |
| C | 1 | 1 проход |
| D | 1 | 1 проход |
| E | 3 | 1 проход |

Между фазами — **обязательная ручная smoke-проверка** `Pyrfor.app` запуском с этого MacBook (CTO discipline: "ship, don't hoard").

---

## 9. Acceptance smoke-чеклисты

**Phase A (v0.1):**
- `npm run tauri build` собирает .app без ошибок.
- Двойной клик → окно ≤1 c, заголовок "Pyrfor".
- Open Folder → дерево показано.
- Edit + Cmd+S → файл изменён на диске (verify через `cat`).
- Chat: "hi" → ответ от runtime.
- Quit (Cmd+Q) → daemon остановлен (`ps aux | grep pyrfor` пусто).

**Phase B (v0.2):**
- Чат печатает поток (видно по символам появляющимся за раз).
- Открыть 3 файла, спросить "что общего?" — AI цитирует все 3.
- Создать `.pyrforrules` "отвечай на украинском" → AI слушается.
- "Apply to file" из ответа создаёт diff с Accept/Reject.

**Phase C (v0.3):**
- Открыть терминал → `$ ` появляется ≤500мс.
- `vim test.txt` → редактор открывается, набрать, `:wq`, файл создан.
- `htop` → TUI рендерится, q закрывает.
- Resize окна → terminal ресайзится без артефактов.
- Открыть второй tab → независимая сессия.

**Phase D (v0.4):**
- В чистом репо изменить файл → status bar dirty=1.
- Stage в panel → checkbox активен.
- Commit "test" + Cmd+Enter → log показывает sha.
- "View diff" → Monaco DiffEditor.
- Branch shown в status bar.

**Phase E (v1.0):**
- `spctl --assess --type execute Pyrfor.app` → "accepted".
- Notarization stamped (`stapler validate`).
- Settings → theme dark→light, перезапуск, тема сохранилась.
- Поднять manifest version, restart → "Update available" notification.
- Recent workspaces работает (Cmd+Shift+R).

---

## 10. Риски и митигации

| Риск | Вероятность | Митигация |
|---|---|---|
| node-pty native deps в sidecar packaging | **высокая** | Pack как Node binary + node_modules tarball, не single-file (Phase A решение) |
| Apple notarization fails | средняя | Сначала ad-hoc подпись для self-use; Developer ID — Phase E |
| Monaco worker URL в WKWebView | высокая (известная) | `MonacoEnvironment.getWorkerUrl` blob URLs (стандарт Vite) |
| Sidecar daemon crash loop | низкая | Exponential backoff, max 3/60s, surface error в UI |
| Конфликт портов | низкая | port 0 + read from stdout (Phase A решение) |
| WS terminal lag на Apple Silicon | низкая | Binary frames, no JSON encoding в hot path |
| Vite HMR vs Tauri devUrl | средняя | Стандартный `npm run tauri dev`, проверено в community |

---

## 11. Stop conditions

Если за одну волну sub-agent:
- Phase A не достиг "окно открывается + чат работает" → escalate (ручная разработка)
- Phase C не достиг "vim работает" — вероятно проблема node-pty packaging → переход на Rust portable-pty (откат к исходному плану)

---

## 12. Текущая точка входа

**HEAD:** `ee1ebc5` (gateway auto-start in --telegram), 3365 тестов зелёные.

**Следующий шаг:** Phase A. Три параллельных волны Sonnet 4.6:
- **A1:** Форк `src-tauri/` → `apps/pyrfor-ide/src-tauri/` + переименование + sidecar manager Rust + tauri.conf.json правки.
- **A2:** Создать `apps/pyrfor-ide/web/` с Vite+React+TS+Monaco. Перенести UI из существующего `app.js` в React-компоненты. Подключить `lib/api.ts` (port from `invoke('get_daemon_port')`).
- **A3:** Sidecar packaging — `pkg` или Node-binary+tarball подход + правки `gateway.ts` (`--port=0`, log `LISTENING_ON=N`). Положить prebuilt sidecar в `apps/pyrfor-ide/src-tauri/binaries/`.

После всех трёх — собрать `Pyrfor.app`, smoke-checklist, коммит `v0.1.0`.

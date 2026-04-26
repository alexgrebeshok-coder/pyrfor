# Unified Product Plan 2026 Q2 — ИСПРАВЛЕННЫЙ

**Дата:** 26.04.2026 (обновлено после аудита кода)  
**Период:** Май — Июнь 2026 (8 недель, 4 спринта)  
**Автор:** Клод Гребешок  

---

## Executive Summary

**После аудита кода оказалось:** Многие компоненты уже реализованы и работают! План сокращён с 12 до 8 недель.

| Было в плане | Реальность | Экономия |
|--------------|------------|----------|
| Subagents — с нуля (64ч) | ✅ Уже работают | -64ч |
| MCP client — с нуля (44ч) | ✅ Уже работает | -44ч |
| MCP server — с нуля (28ч) | ✅ Уже работает | -28ч |
| SQLite Memory — миграция (28ч) | ✅ Prisma/SQLite работает | -28ч |
| **ИТОГО ЭКОНОМИЯ** | | **-164ч (~4 недели)** |

**Новая цель:** Фокус на VSCode Extension + FreeClaude Mode + Интеграция.

---

## Реальное состояние (после аудита кода)

### Pyrfor — ЧТО УЖЕ РАБОТАЕТ

| Компонент | Файл | Статус |
|-----------|------|--------|
| **Subagent Spawner** | `packages/engine/src/runtime/subagents.ts` | ✅ Полный lifecycle, до 5 concurrent, fork сессий |
| **MCP Server** | `packages/engine/src/runtime/mcp-server.ts` | ✅ stdio transport, работает |
| **MCP Client** | `packages/engine/src/runtime/mcp-client.ts` | ✅ Подключение к внешним серверам |
| **MCP FreeClaude** | `packages/engine/src/runtime/pyrfor-mcp-server-fc.ts` | ✅ Интеграция с FreeClaude |
| **Voice (daemon)** | `daemon/telegram/voice.ts` | ✅ Whisper API + fallback |
| **Memory Server** | `prisma-memory-manager.ts` | ✅ Prisma/SQLite |
| **Local LLM** | `ai/providers/ollama.ts, mlx.ts` | ✅ Ollama + MLX |
| **Gateway** | `daemon/gateway.ts` | ✅ HTTP + WebSocket |
| **Tauri IDE** | `apps/pyrfor-ide/` | ✅ Структура готова, sidecar работает |

### Pyrfor — ЧТО НУЖНО СДЕЛАТЬ

| Компонент | Что нужно | Оценка |
|-----------|-----------|--------|
| **VSCode Extension** | Создать с нуля | 40ч |
| **FreeClaude Mode** | Интегрировать engine в IDE | 32ч |
| **SQLite + FTS5** | Доработать search | 16ч |
| **MCP Tool Engine** | Подключить MCP к Tool Engine | 12ч |
| **Config hot-reload** | File watcher | 8ч |
| **A2A Protocol** | Agent-to-Agent | 20ч |

### FreeClaude — ЧТО ПОРТИРОВАТЬ

| Компонент | Сложность | Куда |
|-----------|-----------|------|
| Provider Router | Низкая | Pyrfor engine |
| Fallback Chain | Низкая | Pyrfor engine |
| Memory System | Средняя | Адаптация под SQLite |
| Task Manager | Средняя | Адаптация под Pyrfor |
| Slash Commands | Низкая | Pyrfor IDE UI |

### CEOClaw — ГОТОВНОСТЬ 85%

| Компонент | Статус | Примечание |
|-----------|--------|------------|
| AI Kernel Waves A-H | ✅ Работает | 22 агента, multi-agent runtime |
| Orchestration | ✅ Работает | Heartbeat, workflows, goals |
| PM Layer | ✅ Работает | Projects, tasks, kanban |
| Heartbeat Daemon | ⚠️ Нужна интеграция | Scheduler есть, daemon loop нет |
| LightRAG | ❌ Не интегрирован | POC done |

---

## Новая архитектура (упрощённая)

```
┌─────────────────────────────────────────────────────────────────┐
│                      PYRFOR IDE v1.0                            │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐ │
│  │  VSCode Extension   │    │  Tauri Desktop App              │ │
│  │  • Chat panel       │    │  ┌─────────┐  ┌───────────────┐ │ │
│  │  • File sync        │    │  │ Mode:   │  │ Mode:         │ │ │
│  │  • Inline hints     │    │  │ Pyrfor  │  │ FreeClaude    │ │ │
│  │  • Diff preview     │    │  │(supvr)  │  │ (autonomous)  │ │ │
│  └──────────┬──────────┘    │  └────┬────┘  └───────┬───────┘ │ │
│             │               │       │                │         │ │
│             └───────────────┼───────┴────────────────┘         │ │
│                             │                                  │ │
│                             ▼                                  │ │
│  ┌──────────────────────────────────────────────────────────┐ │ │
│  │              Daemon Gateway (port 18790)                 │ │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐     │ │ │
│  │  │  HTTP   │  │   WS    │  │  Cron   │  │Telegram │     │ │ │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘     │ │ │
│  └───────┼────────────┼────────────┼────────────┼──────────┘ │ │
│          └────────────┴────────────┴────────────┘            │ │
├─────────────────────────────────────────────────────────────────┤
│                     Engine Package                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Subagents│ │  MCP     │ │  Tools   │ │  Memory  │          │
│  │ (ready)  │ │(ready)   │ │(ready)   │ │ (SQLite) │          │
│  └──────────┘ └────┬─────┘ └──────────┘ └──────────┘          │
│                    │                                            │
│  ┌─────────────────┴────────┐                                   │
│  │ Provider Router (ported) │  ◄── из FreeClaude                │
│  │ ZAI → OpenRouter → Ollama│                                   │
│  └──────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│  CEOClaw Integration (через HTTP API)                           │
│  • Heartbeat sync  • Task sync  • Goals/Projects               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Спринты (обновлённые, 4 спринта по 2 недели)

### СПРИНТ 1: Май 4-17 — Foundation + VSCode Scaffold

**Фокус:** VSCode Extension foundation + MCP-Tool Engine

| Задача | Часы | Что делаем |
|--------|------|------------|
| **P1** MCP → Tool Engine интеграция | 12h | Подключить MCP tools к Tool Engine |
| **P1** FTS5 search в Memory | 12h | Full-text search поверх SQLite |
| **P2** VSCode: manifest, activation | 8h | Extension scaffold |
| **P2** VSCode: WebSocket client | 12h | Подключение к daemon |
| **P2** VSCode: Chat panel | 12h | Базовый UI сообщений |
| **FC** Provider Router порт | 8h | Выделить в standalone модуль |
| **Tests** +300 тестов на новое | 8h | Покрытие |

**Milestone S1:**
- ✅ MCP tools работают через Tool Engine
- ✅ FTS5 search работает
- ✅ VSCode Extension подключается к daemon
- ✅ Chat UI базовый

**Человеко-дни:** 8 дней ≈ 72 часа

---

### СПРИНТ 2: Май 18-31 — VSCode Feature + FreeClaude Mode

**Фокус:** Полноценный VSCode Extension + FreeClaude интеграция

| Задача | Часы | Что делаем |
|--------|------|------------|
| **P1** VSCode: File sync | 12h | Two-way sync с daemon |
| **P1** VSCode: Mode switcher | 8h | Pyrfor ↔ FreeClaude |
| **P2** VSCode: Inline suggestions | 16h | Ghost text, completions |
| **P2** VSCode: Diff preview | 12h | Side-by-side, apply/reject |
| **P2** VSCode: Task panel | 8h | Running tasks UI |
| **FC** Mode: Core integration | 16h | FreeClaude engine в IDE |
| **FC** Slash commands (/commit, /diff) | 8h | Портировать команды |
| **FC** Memory bridge | 8h | Shared memory между режимами |

**Milestone S2:**
- ✅ VSCode Extension feature-complete
- ✅ FreeClaude mode работает в IDE
- ✅ File sync стабильный
- ✅ Slash commands работают

**Человеко-дни:** 11 дней ≈ 88 часа

---

### СПРИНТ 3: Июнь 1-14 — Integration + Polish + A2A

**Фокус:** Интеграция режимов + A2A + Config hot-reload

| Задача | Часы | Что делаем |
|--------|------|------------|
| **P1** Mode state sharing | 12h | Shared context, memory |
| **P1** Config hot-reload | 8h | JSON watcher + reload |
| **P2** A2A: Agent Card | 8h | Discovery, metadata |
| **P2** A2A: Task protocol | 12h | Send/receive tasks |
| **P2** A2A: Artifacts | 8h | Exchange artifacts |
| **P3** Session persistence | 8h | Save/restore state |
| **P3** Performance optimize | 8h | Startup, memory |

**Milestone S3:**
- ✅ Режимы полностью интегрированы
- ✅ A2A protocol работает
- ✅ Config hot-reload
- ✅ Session persistence

**Человеко-дни:** 9 дней ≈ 74 часа

---

### СПРИНТ 4: Июнь 15-28 — CEOClaw Integration + Release

**Фокус:** CEOClaw MVP + Publishing + Docs

| Задача | Часы | Что делаем |
|--------|------|------------|
| **P1** E2E testing | 12h | End-to-end scenarios |
| **P1** Bug fixes | 8h | Стабилизация |
| **P2** Documentation | 12h | README, API docs, tutorials |
| **P2** Build & packaging | 8h | Signed builds, auto-update |
| **CC** Heartbeat daemon | 12h | Daemon scheduler integration |
| **CC** Task sync API | 8h | Bidirectional sync |
| **CC** Goals bridge | 8h | Goals→Pyrfor agents |
| **Release** Pyrfor IDE v1.0 | 4h | Release notes, deploy |

**Milestone S4:**
- ✅ Pyrfor IDE v1.0 production ready
- ✅ VSCode Extension в marketplace
- ✅ CEOClaw basic integration
- ✅ Полная документация

**Человеко-дни:** 9 дней ≈ 72 часа

---

## Итоговая оценка (обновлённая)

| Спринт | Период | Фокус | Часы | Результат |
|--------|--------|-------|------|-----------|
| S1 | Май 4-17 | Foundation | 72h | MCP+Tool Engine, FTS5, VSCode scaffold |
| S2 | Май 18-31 | VSCode + FC Mode | 88h | Feature-complete VSCode, FC mode полный |
| S3 | Июнь 1-14 | Integration + A2A | 74h | Mode integration, A2A, hot-reload |
| S4 | Июнь 15-28 | CEOClaw + Release | 72h | v1.0 production, CEOClaw MVP |
| **ИТОГО** | **8 недель** | | **~306ч** | |

**Сравнение с исходным планом:**
- Было: 12 недель, 484 часа
- Стало: 8 недель, 306 часа
- **Экономия: 4 недели, 178 часов**

---

## Что уже готово (не требует работы)

| Компонент | Где находится | Примечание |
|-----------|---------------|------------|
| Subagent spawn/lifecycle | `engine/src/runtime/subagents.ts` | Полный функционал |
| MCP Server | `engine/src/runtime/mcp-server.ts` | stdio transport |
| MCP Client | `engine/src/runtime/mcp-client.ts` | Подключение к серверам |
| Voice transcription | `daemon/telegram/voice.ts` | Whisper API |
| Memory (SQLite) | `prisma-memory-manager.ts` | Prisma-based |
| Local LLM | `ai/providers/` | Ollama, MLX |
| Provider Router (partial) | `ai/providers/router.ts` | Нужно расширить |
| Tauri sidecar | `apps/pyrfor-ide/src-tauri/` | Daemon management |
| CEOClaw AI Kernel | `ceoclaw/lib/ai/` | Waves A-H работают |
| CEOClaw Orchestration | `ceoclaw/lib/orchestration/` | Heartbeat, goals |
| CEOClaw PM | `ceoclaw/app/` | Projects, tasks |

---

## Риски (обновлённые)

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| VSCode Extension API сложнее ожидаемого | Средняя | Feature flags, MVP без некоторых фич |
| FreeClaude integration complexity | Средняя | Пошаговый порт, сначала core |
| CEOClaw heartbeat daemon | Низкая | Уже есть scheduler, нужен только loop |

---

## Что НЕ делаем (deferred)

| Функция | Причина | Когда |
|---------|---------|-------|
| Browser control (Playwright) | MCP web-search достаточно | Q3 |
| Mobile app | Out of scope | Q4 |
| Real-time collaboration | Сложно, мало users | Q4 |
| Full CEOClaw dashboard rewrite | Готов текущий | Не нужно |

---

## Метрики успеха (v1.0)

### Технические
- [ ] Pyrfor IDE: <2s cold start
- [ ] 4000+ тестов (уже ~4000 сейчас)
- [ ] VSCode Extension: published
- [ ] FreeClaude mode: stable
- [ ] Subagent: <500ms spawn (уже работает)
- [ ] MCP: 4+ servers connected

### Продуктовые
- [ ] Pyrfor IDE v1.0 published
- [ ] VSCode Extension in marketplace
- [ ] 50+ active users
- [ ] CEOClaw integration live

---

## Ключевые файлы для работы

### Pyrfor (уже работают)
```
packages/engine/src/runtime/subagents.ts        ✅ SpawnIPC
packages/engine/src/runtime/mcp-server.ts       ✅ Server
packages/engine/src/runtime/mcp-client.ts       ✅ Client
daemon/gateway.ts                                ✅ HTTP/WebSocket
apps/pyrfor-ide/src-tauri/src/lib.rs            ✅ Sidecar
```

### Нужно создать/доработать
```
packages/engine/src/tools/mcp-tool-adapter.ts    📝 Новый
packages/engine/src/memory/fts5-search.ts        📝 Новый
vscode-extension/                                📝 Создать
apps/pyrfor-ide/web/src/modes/freeclaude/      📝 Создать
apps/pyrfor-ide/web/src/components/vscode-bridge.tsx 📝 Новый
```

### FreeClaude (что портировать)
```
freeclaude-dev/src/services/api/fallbackChain.ts  →  engine/src/ai/
freeclaude-dev/src/services/memory/*.ts          →  engine/src/memory/
freeclaude-dev/src/services/api/openaiShim.ts    →  engine/src/ai/
```

---

*План обновлён: 2026-04-26 после аудита кодовых баз*  
*Предыдущая версия: 12 недель, 484ч → Новая: 8 недель, 306ч*

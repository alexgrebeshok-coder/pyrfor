---
sidebar_position: 9
sidebar_label: 09 — API · CLI · VS Code
---

# 09 — API · CLI · VS Code

> ← [08 — Multi-Model Policy](multi-model-policy) · далее → [10 — Roadmap](roadmap-milestones)

---

## 9.1 HTTP Gateway (`runtime/gateway.ts`)

С M17 `features.universalEngine` включён по умолчанию: Universal Engine gateway routes активны, если в runtime есть `universalEngine` orchestration dependency. Оператор может явно отключить поверхность через `features.universalEngine=false`, `PYRFOR_FEATURE_UNIVERSAL_ENGINE=false` или `PYRFOR_UNIVERSAL_ENGINE=false`; при отключении routes возвращают `503`.

### Concepts

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/concepts` | `{ goal, workspaceId?, strategy?, dryRun?, budgetUsd?, autonomy? }` | `{ conceptId, status, planRef? }` |
| `GET` | `/api/concepts` | `?status&limit&offset` | `{ concepts: ConceptRecord[] }` |
| `GET` | `/api/concepts/:id` | — | `ConceptRecord & { artifactRefs, currentPhase }` |
| `DELETE` | `/api/concepts/:id` | — | `{ aborted: boolean }` |
| `GET` | `/api/concepts/:id/plan` | — | `PlanDocument | { error: 'not_ready' }` |
| `GET` | `/api/concepts/:id/phases` | — | `{ phases: [{ phase, status, artifactRef? }] }` |
| `GET` | `/api/concepts/:id/events/stream` | SSE | filtered LedgerEvent stream |
| `POST` | `/api/concepts/:id/clarify` | `{ answers }` | `{ status }` |
| `POST` | `/api/concepts/:id/resume` | `{ fromPhase? }` | `{ status }` |
| `POST` | `/api/concepts/:id/rollback` | `{ toSnapshot }` | `{ newRunId }` |

### Tools

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/tools/forge` | `{ name, description, kind, acceptanceCriteria[] }` | `{ toolId, status }` |
| `GET` | `/api/tools` | `?kind&status&q` | `{ tools: RegistryEntry[] }` |
| `GET` | `/api/tools/:toolId` | — | `RegistryEntry` |
| `POST` | `/api/tools/:toolId/promote` | `{ to, reason }` | `{ newStatus }` (через approval) |
| `POST` | `/api/tools/:toolId/test` | — | `{ result: ToolTestResult }` |
| `DELETE` | `/api/tools/:toolId` | — | `{ retired: boolean }` |

### Strategy & Memory

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/strategy` | `?domain` | `{ strategies: StrategyEntry[] }` |
| `POST` | `/api/strategy` | `{ key, value, domain?, rationale? }` | `StrategyEntry` |
| `DELETE` | `/api/strategy/:key` | — | `{ deleted: boolean }` (human-tier approval) |
| `GET` | `/api/memory/universal` | `?scope&q&limit` | `{ entries: MemoryEntry[] }` |

### Approvals

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/approvals/pending` | — | `{ approvals: ApprovalRequest[] }` |
| `POST` | `/api/approvals/:id/decision` | `{ decision: 'approve'|'deny' }` | `{ ok: true, decision }` |

---

## 9.2 CLI (`packages/cli`)

```bash
# Концепции
pyrfor concept "<goal>" \
  [--workspace <path>] \
  [--dry-run] \
  [--budget-usd <n>] \
  [--autonomy auto|notify|approve] \
  [--strategy "k=v"] \
  [--model <override>]

pyrfor plan "<goal>" [--workspace <path>] [--json]
pyrfor run <conceptId> [--phase <phase>] [--force]
pyrfor status [<conceptId>]
pyrfor concept abort <conceptId>
pyrfor concept resume <conceptId> [--from-phase <p>]
pyrfor concept rollback <conceptId> --to-snapshot <s>

# Инструменты
pyrfor tool forge "<name>" \
  --description "<desc>" \
  --kind <script|api_client|mcp_tool|wasm_module>

pyrfor tool list [--kind <kind>] [--status <s>] [--q <search>]
pyrfor tool test <toolId>
pyrfor tool promote <toolId> --to <status> --reason "<text>"
pyrfor tool retire <toolId>

# Стратегия
pyrfor strategy set <key> <value> [--domain <d>] [--rationale "<text>"]
pyrfor strategy list [--domain <d>]
pyrfor strategy delete <key>

# Approvals
pyrfor approvals list [--gateway-url URL] [--json]
pyrfor approvals approve <id> [--gateway-url URL] [--json]
pyrfor approvals deny <id> [--gateway-url URL] [--json]
```

Существующие режимы (`--chat`, `--telegram`, `--once`) **не затрагиваются**.

---

## 9.3 VS Code Extension

### Команды

| Команда | Действие |
|---|---|
| `pyrfor.concept.start` | Открыть webview для подачи концепции |
| `pyrfor.concept.status` | Показать текущий статус активных концепций |
| `pyrfor.concept.abort` | Прервать concept |
| `pyrfor.approvals.refresh` | Обновить governed approvals inbox |
| `pyrfor.approval.approve` | Одобрить pending approval request |
| `pyrfor.approval.deny` | Отклонить pending approval request |
| `pyrfor.tool.list` | Открыть Tool Registry view |
| `pyrfor.tool.forge` | Запустить ToolForge интерактивно |
| `pyrfor.strategy.set` | Quick-pick для стратегий |
| `pyrfor.plan.preview` | Просмотр PlanGraph для concept'а |
| `pyrfor.context.useFile` | Подать активный файл как context для concept'а |

### Tree views

- **ConceptsTreeView** — список активных/завершённых концепций с live phase badges (через SSE).
- **ToolRegistryTreeView** — группировка по `kind`/`status`.
- **StrategyView** — текущие стратегии по доменам.
- **ApprovalsView** — pending approval requests с approve/deny actions прямо из activity bar.

### Status bar

- Активная фаза текущей концепции (`◷ Research`, `◔ Verify`, `✔ Done`, …).
- Click → открыть concept detail.

### Webview

**ConceptTraceView** — рендерит `concept_trace` артефакт как Mermaid-диаграмму поверх SSE stream'а событий. Real-time подсветка текущего узла PlanGraph, включая terminal `postmortem` и `memory_persist` фазы.

### Контекстное меню Editor

- "Use this file as context for new concept"
- "Run concept on selection"

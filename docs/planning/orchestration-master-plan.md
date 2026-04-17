# CEOClaw Orchestration Master Plan

**Дата:** 2026-04-16  
**Статус:** Master blueprint / единый опорный документ  
**Назначение:** единый детальный документ, по которому можно последовательно довести orchestration-слой CEOClaw до world-class уровня без потери текущих сильных сторон.

---

## 1. Зачем нужен этот документ

Этот документ объединяет:

1. Уже реализованную orchestration-базу.
2. Ранее согласованный план внедрения.
3. Hardening, который уже был сделан.
4. Competitive analysis и gap analysis.
5. Новый подробный сценарный план по этапам, сущностям, сервисам, API, UI, наблюдаемости, тестам и финальному целевому результату.

Это главный ориентир для следующих итераций. Он должен отвечать на вопросы:

- что уже есть;
- чего не хватает;
- как именно это должно работать;
- что именно надо создать;
- в каком порядке двигаться;
- какой результат должен получиться в итоге.

---

## 2. Текущее состояние

## 2.1 Что уже сделано

В CEOClaw уже существует рабочая orchestration-база:

- dual-source registry: `lib/ai/agents.ts` + DB runtime state;
- Prisma-модели orchestration-слоя;
- agent CRUD и API keys;
- goal hierarchy;
- heartbeat queue + scheduler + executor;
- activity/runs pages и heartbeat monitor UI;
- agent presets;
- RBAC / permission grants;
- encrypted secrets;
- config revisions;
- OpenClaw / webhook adapters;
- Telegram notifications;
- ask-project orchestration entrypoint;
- scheduler hardening, goal service extraction, отдельный heartbeat monitor.

## 2.2 Что является сильной стороной прямо сейчас

CEOClaw уже сильнее большинства agent frameworks по следующим направлениям:

- **PM-first context**: агенты живут внутри Project/Task/Goal/EVM/WBS контекста;
- **budget governance**: лимиты и auto-pause;
- **security**: API keys, secrets, RBAC, revisions;
- **org model**: агенты организованы как оргструктура;
- **memory richness**: episodic + semantic + procedural memory;
- **UI presence**: orchestration уже виден в продукте, а не спрятан в SDK.

## 2.3 Главные незакрытые гэпы

Чтобы стать world-class, не хватает:

1. checkpointing / replay;
2. workflow engine;
3. structured delegation;
4. circuit breaker + retry/DLQ;
5. production-grade observability;
6. резкого увеличения тестового покрытия;
7. более зрелой operational модели.

---

## 3. Целевое видение

## 3.1 Что должно получиться в итоге

В финальном состоянии CEOClaw должен стать не просто системой запуска агентов, а **enterprise orchestration platform for project execution**.

Итоговый продукт должен уметь:

1. Описывать агентов как операционные сущности компании.
2. Запускать их вручную, по расписанию, по событиям и по workflow.
3. Делегировать работу между агентами с контролем бюджета, прав и трассировки.
4. Привязывать каждое действие агента к goal/task/project context.
5. Давать replay и аудит любого выполнения.
6. Поддерживать approval gates и безопасные действия.
7. Показывать живую картину в UI: кто что делает, почему, сколько стоит, где застрял.
8. Масштабироваться без хрупкости благодаря retries, DLQ, circuit breaker, metrics, tracing.

## 3.2 Итоговая формула продукта

**CEOClaw World-Class Orchestration =**

- PM-first operating system
- + multi-agent orchestration
- + workflow engine
- + replay/checkpointing
- + enterprise governance
- + observability
- + safe scaling

---

## 4. Принципы проектирования

Все дальнейшие изменения должны держаться на этих принципах:

1. **Code wins, DB runs**  
   `agents.ts` хранит definition truth, БД хранит runtime state.

2. **PM context is sacred**  
   orchestration не живет отдельно от задач, целей, проектов, бюджета и approval flow.

3. **Auditability first**  
   любое действие должно быть воспроизводимо и объяснимо.

4. **Failures are first-class**  
   retry, timeout, DLQ, circuit breaker и diagnostics должны проектироваться сразу.

5. **Thin routes, thick services**  
   orchestration-логика должна жить в сервисном слое.

6. **Extensible integration boundaries**  
   adapters, notifications, queue implementation, workflow execution должны быть заменяемыми.

7. **Human override remains available**  
   у пользователя всегда должен быть способ остановить, одобрить, перезапустить или ограничить агента.

---

## 5. Целевая архитектура

## 5.1 Большая схема

```text
Agent Definitions (code)
    -> Registry Sync
        -> Agent Runtime Records (DB)
            -> Wakeup Queue
                -> Scheduler / Event Triggers / Manual Triggers
                    -> Executor / Workflow Engine
                        -> Tools / Adapters / Multi-agent Delegation
                            -> Run Events / Costs / State / Checkpoints
                                -> UI / Notifications / Metrics / Audit
```

## 5.2 Основные слои

### A. Definition Layer

Что хранит:

- типы агентов;
- capabilities;
- default prompt/system role;
- category;
- default tools;
- default adapter compatibility;
- preset metadata.

Где:

- `lib/ai/agents.ts`
- `lib/orchestration/agent-presets.ts`

### B. Runtime Layer

Что хранит:

- инстансы агентов по workspace;
- статус;
- runtime config;
- budget;
- hierarchy;
- permissions;
- secrets;
- revisions.

Где:

- Prisma orchestration models;
- service layer в `lib/orchestration/*`.

### C. Execution Layer

Что делает:

- принимает wakeup;
- создаёт run;
- валидирует budget/permissions/status;
- выбирает adapter / internal execution path;
- пишет events;
- обновляет cost/runtime state;
- создаёт checkpoints;
- уведомляет UI и channels.

### D. Coordination Layer

Что делает:

- delegation;
- workflow branching;
- parent-child runs;
- approvals;
- retry/DLQ;
- circuit breaker;
- replay.

### E. Experience Layer

Что делает:

- orchestration dashboard;
- agents page;
- goals page;
- heartbeat monitor;
- run details;
- workflow builder;
- approval queue;
- observability panel.

---

## 6. Что именно должно существовать в финальной системе

## 6.1 Доменные сущности

### Уже есть или частично есть

- `Agent`
- `AgentApiKey`
- `AgentRuntimeState`
- `AgentWakeupRequest`
- `HeartbeatRun`
- `HeartbeatRunEvent`
- `Goal`
- `AgentTaskLink`
- `TaskComment`
- `Label`
- `TaskLabel`
- `PermissionGrant`
- `AgentSecret`
- `AgentConfigRevision`

### Нужно добавить обязательно

#### 1. `HeartbeatRunCheckpoint`

Нужен для:

- replay;
- step resume;
- debug;
- partial recovery.

Пример полей:

- `id`
- `runId`
- `stepKey`
- `seq`
- `checkpointType`
- `stateJson`
- `createdAt`

#### 2. `WorkflowTemplate`

Нужен для:

- описания reusable workflows;
- графа nodes/edges/conditions;
- запуска повторяемых процессов.

Пример полей:

- `id`
- `workspaceId`
- `name`
- `slug`
- `description`
- `version`
- `definitionJson`
- `status`
- `createdBy`
- `createdAt`
- `updatedAt`

#### 3. `WorkflowRun`

Нужен для:

- отдельного жизненного цикла workflow;
- связи workflow с несколькими agent runs;
- прогресса по шагам.

#### 4. `WorkflowRunStep`

Нужен для:

- хранения статуса каждого узла workflow;
- retries;
- timing;
- checkpoint link.

#### 5. `AgentDelegation`

Нужен для:

- явной связи parent agent -> child agent;
- причин делегирования;
- контроля прав;
- lineage и аналитики.

Пример полей:

- `id`
- `parentRunId`
- `parentAgentId`
- `childAgentId`
- `childRunId`
- `goalId`
- `taskId`
- `instruction`
- `status`
- `createdAt`

#### 6. `DeadLetterJob`

Нужен для:

- failed wakeups;
- executor failures after retries;
- investigation and replay.

#### 7. `AgentExperiment`

Нужен для:

- A/B testing configs;
- rollout strategies;
- traffic split.

#### 8. `NotificationChannel`

Нужен для:

- обобщения Telegram-only уведомлений;
- Slack / Discord / email / webhook.

---

## 6.2 Основные сервисы

Финально должны существовать следующие сервисы:

### Уже есть / есть база

- `agent-service.ts`
- `goal-service.ts`
- `heartbeat-executor.ts`
- `heartbeat-scheduler.ts`
- `job-queue.ts`
- `permission-grants.ts`
- `agent-secrets.ts`
- `adapters.ts`

### Нужно добавить

#### `workflow-service.ts`

Ответственность:

- CRUD workflow templates;
- validate graph definition;
- compile workflow;
- start workflow runs;
- route node execution.

#### `workflow-executor.ts`

Ответственность:

- step-by-step execution;
- branching;
- condition evaluation;
- retries;
- checkpoint creation;
- node completion.

#### `checkpoint-service.ts`

Ответственность:

- create checkpoint;
- load checkpoint;
- restore run state;
- prepare replay.

#### `delegation-service.ts`

Ответственность:

- validate delegation policy;
- create child wakeup/run;
- link parent and child runs;
- propagate context;
- enforce budgets and permissions.

#### `circuit-breaker-service.ts`

Ответственность:

- open/close/half-open states;
- per-agent/per-adapter error tracking;
- cooldown windows;
- protection against cascading failures.

#### `retry-policy-service.ts`

Ответственность:

- exponential backoff;
- retry eligibility;
- terminal failure classification;
- dead-letter routing.

#### `observability-service.ts`

Ответственность:

- trace IDs;
- metrics aggregation;
- structured logs;
- run correlation.

#### `notification-service.ts`

Ответственность:

- fan-out notifications;
- routing by severity/type;
- channel templates;
- delivery status tracking.

---

## 6.3 Основные UI поверхности

Финально в продукте должны быть:

1. **Agents Control Center**  
   список агентов, статусы, budgets, roles, hierarchy, run rate.

2. **Agent Detail**  
   конфиг, permissions, secrets references, revision history, cost chart, active runs.

3. **Heartbeat Monitor**  
   live queue, active runs, failures, warnings, retry state.

4. **Goals Console**  
   goal tree, linked agents, linked tasks, progress, run history.

5. **Run Inspector**  
   events, checkpoints, costs, trace, delegation chain, replay button.

6. **Workflow Builder**  
   визуальный canvas + JSON view + validation + dry-run.

7. **Workflow Operations Console**  
   workflow runs, step statuses, bottlenecks, retries, replay.

8. **Approval Center**  
   pending approvals, impact preview, approver actions, audit trail.

9. **Observability Console**  
   traces, metrics, failure rates, adapter health, circuit breaker states.

10. **Experiment Console**  
    active A/B tests, traffic split, success metrics, recommendation.

---

## 7. Как это должно работать: ключевые сценарии

## 7.1 Сценарий A — создание агента

### Цель

Пользователь создаёт или включает агента для workspace.

### Поток

1. Пользователь открывает `/settings/agents`.
2. Выбирает preset или custom agent.
3. Заполняет:
   - name;
   - role;
   - reportsTo;
   - adapter type;
   - schedule;
   - monthly budget;
   - permission scope;
   - linked goals/projects.
4. UI отправляет create request.
5. `agent-service`:
   - валидирует slug/name;
   - валидирует `definitionId`;
   - создаёт runtime record;
   - создаёт initial revision;
   - опционально применяет preset defaults.
6. Если агент чувствительный:
   - создаётся approval;
   - статус агента = `pending_approval`.
7. После approval:
   - агент становится `idle`;
   - доступен для wakeup/schedule.

### Что должно создаваться

- `Agent`
- `AgentConfigRevision`
- при необходимости `Approval`
- при необходимости `PermissionGrant`

### Ожидаемый результат

В workspace появляется управляемый agent instance с понятным жизненным циклом.

---

## 7.2 Сценарий B — запуск по расписанию

### Цель

Агент самостоятельно выполняет проверку или действие по cron schedule.

### Поток

1. Scheduler запускается daemon-ом по системному cron.
2. `heartbeat-scheduler`:
   - загружает eligible agents;
   - проверяет cron expression;
   - проверяет active status;
   - проверяет circuit breaker;
   - создаёт `AgentWakeupRequest`.
3. Queue processor забирает wakeup.
4. Создаётся `HeartbeatRun`.
5. `heartbeat-executor`:
   - валидирует budget;
   - собирает context;
   - определяет execution path;
   - пишет event `run.started`;
   - выполняет run;
   - пишет progress events;
   - пишет cost and outcome;
   - закрывает run.
6. UI получает live updates.
7. Если run failed:
   - применяется retry policy;
   - либо job уходит в DLQ.

### Что должно создаваться

- `AgentWakeupRequest`
- `HeartbeatRun`
- `HeartbeatRunEvent[]`
- `AIRunCost`
- `AgentRuntimeState` update
- `HeartbeatRunCheckpoint[]` для шагов

### Ожидаемый результат

Надёжный расписанный запуск с журналом, стоимостью, retry и replay.

---

## 7.3 Сценарий C — ручной запуск агента

### Цель

Пользователь вручную инициирует run.

### Поток

1. Пользователь нажимает "Wake up agent".
2. Создаётся wakeup с source `manual`.
3. Далее процесс тот же, что и для scheduled run.
4. В UI user видит:
   - queued;
   - running;
   - progress;
   - success/failure;
   - result summary;
   - costs.

### Дополнительно

Если run потенциально создаёт изменения:

- создаётся approval gate;
- run может перейти в `waiting_for_approval`.

---

## 7.4 Сценарий D — делегирование между агентами

### Цель

Один агент передает подзадачу другому через orchestration, а не скрыто внутри prompt loop.

### Поток

1. Parent agent во время run решает делегировать.
2. Executor вызывает `delegation-service`.
3. Сервис проверяет:
   - имеет ли parent agent право делегировать;
   - можно ли target agent использовать в данном scope;
   - хватает ли budget/reserved budget;
   - нет ли circuit breaker/open state.
4. Создаётся `AgentDelegation`.
5. Создаётся child wakeup/run.
6. Parent run получает event `delegation.created`.
7. Child run получает inherited context:
   - projectId;
   - taskId;
   - goalId;
   - traceId;
   - parentRunId;
   - delegation instruction.
8. После завершения child run:
   - результат прикрепляется к delegation;
   - parent run получает `delegation.completed`;
   - parent может продолжить workflow.

### Что должно создаваться

- `AgentDelegation`
- child `AgentWakeupRequest`
- child `HeartbeatRun`
- child events
- lineage links

### Ожидаемый результат

Прозрачная multi-agent collaboration с lineage, cost attribution и governance.

---

## 7.5 Сценарий E — budget exceed

### Цель

Система безопасно останавливает агентов при риске перерасхода.

### Поток

1. Перед run выполняется preflight budget check.
2. Система оценивает:
   - spentMonthlyCents;
   - reserved cost;
   - projected run cost;
   - threshold warnings.
3. Если бюджет почти исчерпан:
   - пишется warning event;
   - отправляется notification.
4. Если бюджет превышен:
   - run не стартует;
   - агент auto-paused;
   - создаётся approval или action item.

### Ожидаемый результат

Ни один агент не может бесконтрольно сжигать бюджет.

---

## 7.6 Сценарий F — retry и dead-letter

### Цель

Ошибки не теряются и не ломают систему.

### Поток

1. Run падает на timeout / adapter error / provider issue.
2. `retry-policy-service` определяет, retryable ли это.
3. Если retryable:
   - создаётся retry attempt;
   - delay вычисляется по backoff policy;
   - run получает retry metadata.
4. Если лимит попыток исчерпан:
   - wakeup/job отправляется в `DeadLetterJob`;
   - UI показывает DLQ item;
   - оператор может replay / inspect / dismiss.

### Ожидаемый результат

Ошибки не пропадают, а переходят в контролируемый режим.

---

## 7.7 Сценарий G — checkpoint и replay

### Цель

Любой сложный run можно восстановить и переиграть.

### Поток

1. Executor после каждого существенного шага сохраняет checkpoint.
2. Если run падает на шаге N:
   - пользователь открывает Run Inspector;
   - видит checkpoints;
   - выбирает replay from step N или full replay.
3. `checkpoint-service` восстанавливает состояние.
4. Создаётся новый run с ссылкой на original run.
5. История сохраняет:
   - original run;
   - replay run;
   - причина replay;
   - пользователь/система, инициировавшие replay.

### Ожидаемый результат

CEOClaw получает ключевое преимущество LangGraph, но внутри PM-системы.

---

## 7.8 Сценарий H — workflow execution

### Цель

Сложные процессы описываются графом, а не hardcoded logic.

### Поток

1. Пользователь в Workflow Builder собирает узлы:
   - trigger;
   - agent step;
   - approval step;
   - condition step;
   - wait/delay step;
   - notification step;
   - task update step.
2. `workflow-service` валидирует graph.
3. Workflow публикуется как `active`.
4. Trigger создаёт `WorkflowRun`.
5. `workflow-executor` выполняет шаги:
   - отмечает `WorkflowRunStep`;
   - создаёт agent runs;
   - сохраняет checkpoints;
   - пишет events;
   - оценивает conditions.
6. При сбое:
   - retry step;
   - approval for intervention;
   - DLQ / replay.

### Ожидаемый результат

CEOClaw переходит от orchestration отдельных агентов к orchestration процессов.

---

## 8. Что нужно создать: полный список артефактов

## 8.1 Backend / models

Обязательно добавить:

- `HeartbeatRunCheckpoint`
- `WorkflowTemplate`
- `WorkflowRun`
- `WorkflowRunStep`
- `AgentDelegation`
- `DeadLetterJob`
- `AgentExperiment`
- `NotificationChannel`

Желательно расширить:

- `HeartbeatRun` — retry metadata, replay metadata, traceId, parentRunId;
- `AgentWakeupRequest` — idempotency key, retry count, nextAttemptAt, dead-letter reason;
- `AgentRuntimeState` — success/failure counters, lastHealthyAt;
- `PermissionGrant` — `grantedBy`, `expiresAt`;
- `AgentSecret` — rotation metadata;
- `AgentConfigRevision` — approval metadata and diff summary.

## 8.2 Backend / services

Создать:

- `lib/orchestration/checkpoint-service.ts`
- `lib/orchestration/workflow-service.ts`
- `lib/orchestration/workflow-executor.ts`
- `lib/orchestration/delegation-service.ts`
- `lib/orchestration/circuit-breaker-service.ts`
- `lib/orchestration/retry-policy-service.ts`
- `lib/orchestration/observability-service.ts`
- `lib/orchestration/notification-service.ts`

Расширить:

- `heartbeat-executor.ts`
- `heartbeat-scheduler.ts`
- `job-queue.ts`
- `adapters.ts`
- `telegram-notify.ts`
- `agent-service.ts`

## 8.3 API

Нужно иметь такие endpoint группы:

### Agents

- `GET /api/orchestration/agents`
- `POST /api/orchestration/agents`
- `GET /api/orchestration/agents/[id]`
- `PATCH /api/orchestration/agents/[id]`
- `DELETE /api/orchestration/agents/[id]`
- `POST /api/orchestration/agents/[id]/wakeup`
- `POST /api/orchestration/agents/[id]/pause`
- `POST /api/orchestration/agents/[id]/resume`

### Runs

- `GET /api/orchestration/runs/[id]`
- `POST /api/orchestration/runs/[id]/replay`
- `POST /api/orchestration/runs/[id]/cancel`
- `GET /api/orchestration/runs/[id]/checkpoints`
- `GET /api/orchestration/runs/[id]/delegations`

### Workflow

- `GET /api/orchestration/workflows`
- `POST /api/orchestration/workflows`
- `GET /api/orchestration/workflows/[id]`
- `PATCH /api/orchestration/workflows/[id]`
- `DELETE /api/orchestration/workflows/[id]`
- `POST /api/orchestration/workflows/[id]/publish`
- `POST /api/orchestration/workflows/[id]/run`
- `GET /api/orchestration/workflow-runs/[id]`

### Operations

- `GET /api/orchestration/dlq`
- `POST /api/orchestration/dlq/[id]/retry`
- `GET /api/orchestration/metrics`
- `GET /api/orchestration/health`
- `GET /api/orchestration/circuit-breakers`

### Experiments

- `GET /api/orchestration/experiments`
- `POST /api/orchestration/experiments`
- `PATCH /api/orchestration/experiments/[id]`
- `POST /api/orchestration/experiments/[id]/start`
- `POST /api/orchestration/experiments/[id]/stop`

## 8.4 UI

Нужно создать или расширить страницы:

- `/settings/agents/[id]`
- `/settings/agents/runs/[runId]/replay`
- `/settings/agents/workflows`
- `/settings/agents/workflows/[id]`
- `/settings/agents/workflow-runs/[id]`
- `/settings/agents/observability`
- `/settings/agents/dlq`
- `/settings/agents/experiments`

## 8.5 Notifications / integrations

Нужно добавить:

- Slack channel;
- Discord channel;
- email channel;
- generic signed webhook;
- delivery status tracking;
- notification preferences by workspace / severity.

---

## 9. Подробный план по этапам

Ниже — рекомендуемый боевой порядок. Он учитывает зависимость систем и минимизирует риск.

## Этап 0 — Stabilization Baseline

### Цель

Не строить новый слой поверх хрупкой базы.

### Что делаем

1. Зафиксировать текущий orchestration baseline.
2. Проверить незакрытые security/robustness issues.
3. Вычистить критичные слабые места:
   - auth gap в revisions endpoint;
   - daemon secret validation;
   - idempotency foundation;
   - transaction boundaries в executor.

### Что создаём

- security checklist;
- hardening tasks;
- baseline metrics snapshot.

### Результат этапа

Стабильная база, на которую можно безопасно наслаивать replay/workflows.

---

## Этап 1 — Reliability Core

### Цель

Сделать execution path production-grade.

### Что делаем

1. Вводим idempotency key для wakeups/runs.
2. Дорабатываем queue semantics.
3. Добавляем retry policy.
4. Добавляем DLQ.
5. Вводим timeout discipline.
6. Вводим circuit breaker.
7. Укрепляем cron parser или заменяем его на battle-tested implementation.

### Что создаём

- `retry-policy-service.ts`
- `circuit-breaker-service.ts`
- `DeadLetterJob` model
- retry and DLQ UI

### Как это должно работать

- duplicate trigger не создаёт повторный run;
- flaky adapter не кладёт систему;
- failed wakeup не пропадает;
- scheduler predictable и прозрачен.

### Acceptance criteria

- duplicate manual/scheduled triggers dedupe correctly;
- retryable failures repeat with backoff;
- non-retryable failures уходят в DLQ;
- failing adapter переводится в `open` state;
- UI показывает breaker status.

---

## Этап 2 — Test and Validation Wall

### Цель

Поднять доверие к orchestration-коду.

### Что делаем

1. Добавляем unit tests на все critical services.
2. Добавляем integration tests на API.
3. Добавляем end-to-end flow tests:
   - manual wakeup;
   - scheduled wakeup;
   - budget stop;
   - retry/DLQ;
   - approval-required run.

### Что создаём

- `agent-service.test.ts`
- `heartbeat-executor.test.ts`
- `goal-service.test.ts`
- `job-queue.test.ts`
- `adapters.test.ts`
- route integration tests
- workflow tests later

### Acceptance criteria

- coverage critical path >= 50% на этом этапе;
- все failure classes имеют test coverage;
- любые новые orchestration features идут только вместе с tests.

---

## Этап 3 — Checkpointing and Replay

### Цель

Дать воспроизводимость и recovery.

### Что делаем

1. Добавляем `HeartbeatRunCheckpoint`.
2. В executor вводим checkpoint boundaries.
3. Добавляем replay API и replay UI.
4. Добавляем run lineage.
5. Вводим failure-to-replay workflow.

### Что создаём

- `checkpoint-service.ts`
- replay endpoints
- replay panel in run details

### Как это должно работать

- после каждого meaningful step сохраняется checkpoint;
- пользователь видит список checkpoints;
- replay можно запустить с начала или с выбранной точки;
- replay связан с original run.

### Acceptance criteria

- сложный run можно повторить с точки сохранения;
- UI показывает origin/replay relation;
- audit не теряет original history.

---

## Этап 4 — Structured Delegation

### Цель

Вывести multi-agent collaboration из скрытого runtime-поведения в управляемый orchestration layer.

### Что делаем

1. Добавляем `AgentDelegation`.
2. Создаём `delegation-service.ts`.
3. В executor добавляем delegation action.
4. Прокидываем context/trace/budget lineage.
5. Добавляем visual chain в Run Inspector.

### Что создаём

- delegation model;
- service;
- API and UI chain view;
- budget propagation rules.

### Как это должно работать

- parent agent создаёт child work transparently;
- user видит, кто кому что поручил;
- child cost учитывается в общей картине;
- permission boundary соблюдается.

### Acceptance criteria

- delegation chain видна в UI;
- child runs не теряют project/task/goal context;
- запрещённые delegation paths блокируются.

---

## Этап 5 — Workflow Engine

### Цель

Поднять orchestration с уровня одиночных запусков на уровень бизнес-процессов.

### Что делаем

1. Проектируем workflow DSL/JSON schema.
2. Добавляем workflow models.
3. Реализуем `workflow-service.ts`.
4. Реализуем `workflow-executor.ts`.
5. Добавляем branching, conditions, waits, approvals, agent steps.
6. Привязываем workflow runs к checkpoints и agent runs.

### Что создаём

- `WorkflowTemplate`
- `WorkflowRun`
- `WorkflowRunStep`
- workflow APIs
- workflow list/detail pages

### Как это должно работать

- один workflow может запускать нескольких агентов и approval steps;
- каждый step имеет статус;
- step failures могут retry/replay;
- workflow можно dry-run before publish.

### Acceptance criteria

- минимум 5 типов узлов работают стабильно;
- workflow run инспектируем по шагам;
- workflow versioning присутствует.

---

## Этап 6 — Workflow Builder UX

### Цель

Сделать workflow engine доступным операционно, а не только кодом.

### Что делаем

1. Добавляем canvas builder.
2. Добавляем node palette.
3. Добавляем graph validation.
4. Добавляем JSON editor fallback.
5. Добавляем publish/draft model.
6. Добавляем dry-run preview.

### Что создаём

- визуальный builder;
- validation sidebar;
- publish controls;
- simulation view.

### Acceptance criteria

- non-developer operator может собрать типовой workflow;
- система показывает ошибки графа до публикации;
- draft/published versions разделены.

---

## Этап 7 — Observability and Operations

### Цель

Сделать orchestration диагностируемым на production-уровне.

### Что делаем

1. Добавляем trace IDs.
2. Добавляем structured metrics.
3. Добавляем execution latency/error dashboards.
4. Добавляем adapter health and breaker dashboard.
5. Добавляем operational health endpoints.

### Что создаём

- `observability-service.ts`
- metrics endpoint;
- observability page;
- trace correlation in runs/workflows.

### Acceptance criteria

- каждый run имеет traceId;
- по traceId можно собрать полную цепочку;
- health panel показывает scheduler, queue, adapters, breakers, DLQ.

---

## Этап 8 — Governance and Enterprise Safety

### Цель

Закрепить управляемость на enterprise-уровне.

### Что делаем

1. Добавляем richer approval gates.
2. Вводим permission expiration / grant metadata.
3. Добавляем secret rotation flows.
4. Добавляем policy checks для dangerous actions.
5. Добавляем spend forecasting и reserve budget.

### Acceptance criteria

- sensitive actions не проходят без policy/approval;
- можно отследить кто выдал право и когда оно истекает;
- secret usage and rotation inspectable.

---

## Этап 9 — Differentiation Layer

### Цель

Не просто догнать best practices, а выйти вперёд.

### Что делаем

1. A/B testing agents.
2. Multi-channel notifications.
3. Marketplace/import-export templates.
4. NL workflow builder.
5. Recommendation engine:
   - предложить лучший schedule;
   - предложить лучший agent;
   - предложить budget settings;
   - предложить delegation chain.

### Acceptance criteria

- CEOClaw не просто orchestration platform, а orchestration operating system.

---

## 10. Что должно быть проверено на каждом этапе

Для каждого этапа обязательны:

1. schema review;
2. service tests;
3. API tests;
4. UI smoke path;
5. failure path tests;
6. auth/permission validation;
7. cost/budget assertions;
8. event/logging assertions;
9. docs update.

---

## 11. Definition of Done для всей программы

Программу можно считать завершённой, когда выполняются все условия ниже.

## 11.1 Функционально

- агент можно создать, настроить, включить, ограничить и наблюдать;
- run можно запустить вручную, по расписанию, по событию, по workflow;
- run можно replay;
- run может делегировать child runs;
- workflow можно собрать, опубликовать и выполнить;
- approval gates реально интегрированы;
- DLQ и retries работают;
- metrics и health доступны.

## 11.2 Операционно

- дубликаты run-ов подавляются;
- неуспешные jobs не теряются;
- failing adapters не ломают всю систему;
- budget enforcement стабилен;
- traceability есть от trigger до final result.

## 11.3 С точки зрения продукта

- пользователь понимает, что делает каждый агент;
- пользователь доверяет системе;
- пользователь видит стоимость;
- пользователь может безопасно вмешаться;
- пользователь может масштабировать orchestration без ручной инженерной импровизации.

## 11.4 С точки зрения качества

- critical orchestration coverage >= 80%;
- failure modes covered;
- replay and workflow scenarios covered;
- observability surfaces complete enough for production support.

---

## 12. Приоритетный рекомендуемый порядок старта

Если идти прагматично, следующий боевой порядок должен быть таким:

1. Reliability Core
2. Test Wall
3. Checkpointing / Replay
4. Structured Delegation
5. Workflow Engine
6. Workflow Builder
7. Observability
8. Governance Enhancements
9. Differentiation Layer

Это лучший порядок, потому что:

- сначала убирается хрупкость;
- потом растёт доверие;
- потом добавляется replay;
- потом настоящая multi-agent coordination;
- и только затем workflow UX и advanced features.

---

## 13. Финальный ожидаемый результат

В финале CEOClaw должен давать такой опыт:

1. Компания или workspace создаёт агентную оргструктуру.
2. Каждый агент имеет ясную роль, бюджет, цели, права и каналы интеграции.
3. Агенты работают не хаотично, а по управляемым правилам и workflows.
4. Все действия видны, трассируемы и объяснимы.
5. Любой run можно разобрать, повторить, ограничить или остановить.
6. Ошибки не превращаются в хаос благодаря retry, DLQ, breakers, approvals.
7. Руководитель видит не только “LLM что-то сделал”, а полноценную операционную систему исполнения проектов.

Ключевая итоговая позиция продукта:

**CEOClaw должен стать лучшей в классе PM-native orchestration platform, где agent execution, project execution и governance являются одной системой, а не тремя разрозненными слоями.**

---

## 14. Короткий управленческий вывод

Самое важное:

- база уже сильная;
- конкурентное преимущество уже есть;
- главный путь к лидерству — не “добавить ещё агентов”, а сделать execution layer надёжным, воспроизводимым, наблюдаемым и process-native;
- ближайшие highest-impact блоки: **reliability -> tests -> replay -> delegation -> workflows**.

Этот документ и есть единый master-plan, по которому дальше стоит двигаться.

# CEOClaw v2.0 — Детальный план реализации

> **Автор:** Copilot (Claude Opus 4.6)  
> **Дата:** 2026-03-25  
> **Аудитория:** Разработчик (AI-модель или человек) без контекста проекта  
> **Базовое состояние:** 878 TS-файлов, 178 API routes, 51+ Prisma models, 141 тест, build green

---

## СОДЕРЖАНИЕ

1. [Текущее состояние проекта](#1-текущее-состояние-проекта)
2. [Анализ концепции v2.0](#2-анализ-концепции-v20)
3. [Мои выводы и рекомендации](#3-мои-выводы-и-рекомендации)
4. [Phase 1: Module System + Event Bus + Workflow Engine](#phase-1-module-system--event-bus--workflow-engine)
5. [Phase 2: Procurement Module](#phase-2-procurement-module)
6. [Phase 3: Contractor Module](#phase-3-contractor-module)
7. [Phase 4: Onboarding v2 + Agent Orchestrator](#phase-4-onboarding-v2--agent-orchestrator)
8. [Phase 5: QC + Tenders](#phase-5-qc--tenders)
9. [Справочник существующих паттернов](#справочник-существующих-паттернов)

---

## 1. Текущее состояние проекта

### Что уже работает (verified by deep audit)

| Категория | Компоненты | Готовность |
|---|---|---|
| **PM Core** | Projects, Tasks, Gantt (CPM + resource leveling + auto-schedule), Kanban, Risks, Milestones, Approvals, Work Reports | 95% |
| **Finance** | Expenses, Contracts, Materials, Suppliers, Equipment, EVM snapshots, Finance cockpit, Stripe billing (3 tiers) | 80% |
| **Connectors** | Telegram (webhook), Email (SMTP), GPS/GLONASS (telemetry), 1С (OData + cron), OAuth platform (Google/MS/Yandex/QB/Xero) | 90% |
| **AI** | 13 tools, function calling, voice→text, daemon (cron/health/auto-actions), signal packets | 85% |
| **Auth** | NextAuth, RBAC (5 ролей, 18 permissions), SSO Yandex, middleware | 90% |
| **Maps/Calendar** | Map provider abstraction (Yandex+Google), Calendar abstraction (Internal+Google+MS365) | 80% |
| **Export** | CSV/XLSX/PDF export service, task/project export API, ExportButton UI component | 75% |
| **i18n** | ru/en/zh, dark mode, LanguageSwitcher, ThemeSwitcher | 90% |
| **Resources** | Resource calendar (weekly heatmap), overallocation calculator, assignment costing, resource leveling | 80% |
| **Regional** | 4 профиля: Russia, Global SMB, Global Enterprise, Hybrid | 80% |

### Ключевые файлы и паттерны

```
ceoclaw-dev/
├── app/                         # Next.js App Router
│   ├── api/                     # 178 API routes
│   │   ├── middleware/auth.ts   # authorizeRequest() — ИСПОЛЬЗУЙ ЭТО
│   │   ├── tasks/               # CRUD + export
│   │   ├── projects/            # CRUD + export + labor-cost
│   │   ├── connectors/          # Registry + OAuth + credentials
│   │   ├── map/                 # geocode, route, search, projects
│   │   ├── calendar/            # events, providers, sync
│   │   ├── finance/             # export, imports
│   │   ├── resources/           # daily-load
│   │   └── search/              # server-side search
│   ├── (dashboard)/             # Protected pages
│   │   ├── projects/
│   │   ├── tasks/
│   │   └── ...
│   └── onboarding/              # Current basic onboarding
├── components/                  # 243 React components
│   ├── layout/topbar.tsx        # NotificationBell + LanguageSwitcher + ThemeSwitcher
│   ├── resources/               # resource-calendar, types
│   └── export/                  # export-button
├── lib/                         # Business logic
│   ├── connectors/              # ★ ПАТТЕРН ДЛЯ МОДУЛЕЙ ★
│   │   ├── registry.ts          # ConnectorRegistry class
│   │   ├── types.ts             # ConnectorAdapter interface
│   │   ├── manifests.ts         # Dynamic loading
│   │   ├── profiles.ts          # Regional profiles
│   │   ├── oauth/               # OAuth service + providers
│   │   └── adapters/            # telegram, email, gps, one-c
│   ├── ai/                      # AI tools, action engine, chat
│   ├── scheduling/              # auto-schedule, critical-path, gantt, resource-leveling, overallocation
│   ├── finance/                 # canonical-model, import-service, assignment-costing, adapters/
│   ├── maps/                    # map-provider, adapters/ (yandex, google)
│   ├── calendars/               # calendar-provider, adapters/ (internal, google, microsoft)
│   └── export/                  # export-service (CSV/XLSX/PDF)
├── prisma/
│   └── schema.prisma            # 51+ models, 1093+ lines
├── contexts/
│   └── locale-context.tsx       # useLocale() — i18n hook
└── __tests__/                   # 141 tests (vitest)
```

### Критические паттерны кода

#### Авторизация API (ОБЯЗАТЕЛЬНО)
```typescript
// Файл: app/api/middleware/auth.ts
// Импорт: import { authorizeRequest } from "@/app/api/middleware/auth";
//
// ВСЕГДА используй этот паттерн в API routes:

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS", // опционально — конкретное право
  });
  if (authResult instanceof NextResponse) return authResult;
  
  const { workspaceId } = authResult.accessProfile;
  // ... логика
}
```

#### Prisma access
```typescript
import { prisma } from "@/lib/db";
// Всегда фильтруй по workspaceId для multi-tenancy!
```

#### Connector Registry pattern (шаблон для модулей)
```typescript
// lib/connectors/registry.ts — ИСПОЛЬЗУЙ КАК ШАБЛОН
export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorAdapter>();
  register(connector: ConnectorAdapter): this { ... }
  get(id: string): ConnectorAdapter | undefined { ... }
  list(): ConnectorAdapter[] { ... }
}
```

#### i18n
```typescript
// Не используй useLocale() для новых ключей — строго типизирован.
// Для новых компонентов: используй inline строки с fallback
// Или добавляй ключи в contexts/locale-context.tsx
```

---

## 2. Анализ концепции v2.0

### Что предлагают 4 документа

| Документ | Суть | Ключевые идеи |
|---|---|---|
| **v2-concept.md** | Vision "Proactive Business OS" | Self-Configuring Engine, Plugin Architecture, 5-фазный roadmap, KPI: TTFI <10 мин |
| **new-features-analysis.md** | Новые модули | Procurement (P0), Contractors (P1), QC (P2), Tenders (P2) |
| **universal-architecture-concept.md** | Platform-Plugin | Core (Identity, Projects, Events, 1C Bridge, Workflow) + Industry Plugins |
| **onboarding-flow.md** | 7-step wizard | AI auto-config, ФНС/DaData API, ОКВЭД→modules, AI calibration |

### GAP-анализ: Концепция vs. Реальность

| Компонент v2.0 | Текущее состояние | Готовность | Действие |
|---|---|---|---|
| Plugin System | ConnectorRegistry (только коннекторы) | **0%** | Создать ModuleRegistry |
| Event Bus | Нет (notifications = прямые записи в БД) | **0%** | Создать EventBus |
| Workflow Engine | Task-specific statuses (hardcoded) | **30%** | Создать WorkflowEngine |
| Procurement | Supplier model есть, workflow нет | **0%** | Phase 2 |
| Contractors | Supplier.rating (1 поле) | **5%** | Phase 3 |
| QC | Нет | **0%** | Phase 5 |
| Tenders | Нет | **0%** | Phase 5 |
| AI Self-Config | Нет | **0%** | Phase 4 (упрощённо) |
| Industry Plugins | Всё в монолите | **0%** | Phase 1 (decoupling) |

---

## 3. Мои выводы и рекомендации

### Вывод 1: Plugin SDK (Docker/WASM) — это overengineering

Концепция предлагает dynamic loading через Docker контейнеры или WASM агенты. Для текущей стадии проекта (1 разработчик + AI) это:
- Месяцы инфраструктурной работы без видимого продуктового эффекта
- Сложность отладки inter-process communication
- Overkill для 5-10 модулей

**Рекомендация:** "Convention-based module system":
- Каждый модуль = папка `lib/modules/{id}/` с `manifest.ts`
- Registry по аналогии с ConnectorRegistry
- Даёт 80% пользы плагинной системы при 20% затрат
- Легко мигрировать на full SDK позже (если нужно)

### Вывод 2: Procurement (P0) — абсолютно правильный приоритет

Procurement напрямую связан с уже готовыми сущностями:
- `Supplier` → Vendor Scoring → RFQ → RFP
- `Contract` → Contract Workflow → Purchase Order
- `Expense` → PO-linked Expenses

Это минимальный мост от "PM tool" к "Business OS". Моментальный ROI.

### Вывод 3: AI Self-Config — НЕ нужен на MVP

"AI сканирует Email и настраивает систему" красиво для pitch deck, но:
- Юзер не даст доступ к Email на первом знакомстве (trust barrier)
- Парсинг документов для авто-настройки = hallucination risk
- **Лучше:** умный wizard с предустановками по отрасли/ОКВЭД (уже начали с Regional Profiles)

### Вывод 4: Event Bus — lightweight, не Kafka

Для текущего масштаба (1 сервер, in-process) достаточно TypedEventEmitter. Kafka/RabbitMQ — когда будут микросервисы.

### Вывод 5: Tenders — отложить

Парсинг тендерных площадок (zakupki.gov.ru):
- Юридически серая зона (нет публичного API, только scraping)
- API ломается при каждом обновлении сайта
- **Рекомендация:** Отложить до Phase 5, начать с RSS-лент (если доступны)

---

## Phase 1: Module System + Event Bus + Workflow Engine

> **Цель:** Создать фундамент платформы, на котором строятся все бизнес-модули  
> **Зависимости:** Нет  
> **Результат:** Рабочая модульная система + event bus + workflow engine  

### Задача 1.1: Module System

#### Что создать

**Файл: `lib/modules/types.ts`**
```typescript
/**
 * Module manifest — каждый модуль в lib/modules/{id}/ экспортирует это
 */
export interface ModuleManifest {
  id: string;                    // "procurement", "qc", "contractors"
  name: string;                  // "Procurement Management"
  description: string;
  version: string;
  category: ModuleCategory;
  requiredModules?: string[];    // зависимости от других модулей
  
  // Что модуль предоставляет
  prismaModels?: string[];       // названия моделей которые модуль добавляет
  apiRoutes?: string[];          // пути API routes
  uiPages?: string[];            // пути UI pages
  aiTools?: string[];            // ID AI tools которые модуль регистрирует
  events?: ModuleEventDef[];     // события которые модуль публикует
  workflows?: string[];          // ID workflow definitions
}

export type ModuleCategory = 
  | "core"           // Identity, Projects, Notifications
  | "industry"       // Construction, Manufacturing, IT
  | "business"       // Procurement, QC, Tenders
  | "integration";   // Connectors, Calendars, Maps

export interface ModuleEventDef {
  name: string;                  // "PurchaseOrderCreated"
  description: string;
  payload: string;               // TypeScript type name
}

export interface ModuleInstance {
  manifest: ModuleManifest;
  enabled: boolean;
  loadedAt: Date;
}
```

**Файл: `lib/modules/registry.ts`**
```typescript
/**
 * Module Registry — управляет жизненным циклом модулей
 * Паттерн аналогичен lib/connectors/registry.ts
 */
import type { ModuleManifest, ModuleInstance } from "./types";
import { logger } from "@/lib/logger";

class ModuleRegistry {
  private readonly modules = new Map<string, ModuleInstance>();

  register(manifest: ModuleManifest): this {
    if (this.modules.has(manifest.id)) {
      throw new Error(`Module '${manifest.id}' already registered`);
    }
    this.modules.set(manifest.id, {
      manifest,
      enabled: true,
      loadedAt: new Date(),
    });
    logger.info(`Module registered: ${manifest.id}`);
    return this;
  }

  get(id: string): ModuleInstance | undefined {
    return this.modules.get(id);
  }

  list(): ModuleInstance[] {
    return Array.from(this.modules.values());
  }

  listEnabled(): ModuleInstance[] {
    return this.list().filter((m) => m.enabled);
  }

  enable(id: string): boolean {
    const module = this.modules.get(id);
    if (!module) return false;
    
    // Проверить зависимости
    const deps = module.manifest.requiredModules || [];
    for (const dep of deps) {
      const depModule = this.modules.get(dep);
      if (!depModule?.enabled) {
        throw new Error(
          `Cannot enable '${id}': dependency '${dep}' is not enabled`
        );
      }
    }
    
    module.enabled = true;
    return true;
  }

  disable(id: string): boolean {
    const module = this.modules.get(id);
    if (!module) return false;
    
    // Проверить что никто не зависит от этого модуля
    for (const [otherId, other] of this.modules) {
      if (other.enabled && other.manifest.requiredModules?.includes(id)) {
        throw new Error(
          `Cannot disable '${id}': module '${otherId}' depends on it`
        );
      }
    }
    
    module.enabled = false;
    return true;
  }

  isEnabled(id: string): boolean {
    return this.modules.get(id)?.enabled ?? false;
  }
}

// Singleton
let registry: ModuleRegistry | null = null;

export function getModuleRegistry(): ModuleRegistry {
  if (!registry) {
    registry = new ModuleRegistry();
    // Auto-register core modules
    loadCoreModules(registry);
  }
  return registry;
}

function loadCoreModules(reg: ModuleRegistry) {
  // Core modules — всегда включены
  reg.register({
    id: "core-projects",
    name: "Projects & Tasks",
    description: "Project management, tasks, Gantt, Kanban, milestones",
    version: "1.0.0",
    category: "core",
    prismaModels: ["Project", "Task", "Milestone", "Risk", "Board"],
    apiRoutes: ["/api/projects", "/api/tasks", "/api/milestones"],
    uiPages: ["/projects", "/tasks", "/gantt", "/kanban"],
    aiTools: ["create_tasks", "update_tasks", "reschedule_tasks"],
    events: [],
    workflows: ["task-workflow"],
  });

  reg.register({
    id: "core-finance",
    name: "Finance & Resources",
    description: "Expenses, contracts, materials, equipment, EVM",
    version: "1.0.0",
    category: "core",
    prismaModels: ["Expense", "Contract", "Material", "Equipment", "Supplier"],
    apiRoutes: ["/api/expenses", "/api/contracts", "/api/suppliers"],
    uiPages: ["/finance", "/resources", "/suppliers"],
    aiTools: [],
    events: [],
    workflows: [],
  });

  reg.register({
    id: "core-connectors",
    name: "Integration Platform",
    description: "Telegram, Email, GPS, 1C, OAuth, Maps, Calendar",
    version: "1.0.0",
    category: "integration",
    prismaModels: ["ConnectorCredential", "ConnectorSyncEntry"],
    apiRoutes: ["/api/connectors", "/api/map", "/api/calendar"],
    uiPages: ["/integrations"],
    aiTools: [],
    events: [],
    workflows: [],
  });
}
```

**Файл: `lib/modules/index.ts`**
```typescript
export { getModuleRegistry } from "./registry";
export type { ModuleManifest, ModuleInstance, ModuleCategory } from "./types";
```

**API route: `app/api/modules/route.ts`**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getModuleRegistry } from "@/lib/modules";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const registry = getModuleRegistry();
  const modules = registry.list().map((m) => ({
    id: m.manifest.id,
    name: m.manifest.name,
    description: m.manifest.description,
    version: m.manifest.version,
    category: m.manifest.category,
    enabled: m.enabled,
    loadedAt: m.loadedAt.toISOString(),
    apiRoutes: m.manifest.apiRoutes,
    uiPages: m.manifest.uiPages,
  }));

  return NextResponse.json({ modules });
}
```

#### Валидация
```bash
npx tsc --noEmit && npm run test:run
```

---

### Задача 1.2: Event Bus

#### Что создать

**Файл: `lib/events/types.ts`**
```typescript
/**
 * Domain events — все бизнес-события системы
 * Каждый модуль может публиковать и подписываться
 */

// ─── Base ────────────────────────────────────────────────

export interface DomainEvent<T = unknown> {
  type: string;
  timestamp: Date;
  sourceModule: string;
  workspaceId?: string;
  userId?: string;
  payload: T;
}

// ─── Project events ────────────────────────────────────────

export interface ProjectCreatedPayload {
  projectId: string;
  name: string;
  status: string;
}

export interface TaskStatusChangedPayload {
  taskId: string;
  projectId: string;
  oldStatus: string;
  newStatus: string;
  changedBy?: string;
}

// ─── Procurement events ────────────────────────────────────

export interface SupplierScoredPayload {
  supplierId: string;
  score: number;
  previousScore?: number;
  factors: Record<string, number>;
}

export interface PurchaseOrderCreatedPayload {
  orderId: string;
  supplierId: string;
  totalAmount: number;
  currency: string;
  projectId?: string;
}

export interface RFQResponseReceivedPayload {
  rfqId: string;
  supplierId: string;
  responseId: string;
  totalAmount: number;
}

// ─── Workflow events ────────────────────────────────────────

export interface WorkflowTransitionedPayload {
  entityType: string;     // "task", "purchase_order", "inspection"
  entityId: string;
  workflowId: string;
  fromState: string;
  toState: string;
  triggeredBy?: string;
}

// ─── Event Map ────────────────────────────────────────────

export interface EventMap {
  "project.created": ProjectCreatedPayload;
  "task.status_changed": TaskStatusChangedPayload;
  "supplier.scored": SupplierScoredPayload;
  "purchase_order.created": PurchaseOrderCreatedPayload;
  "rfq.response_received": RFQResponseReceivedPayload;
  "workflow.transitioned": WorkflowTransitionedPayload;
  // Добавляй новые события сюда
}

export type EventType = keyof EventMap;
export type EventHandler<T extends EventType> = (
  event: DomainEvent<EventMap[T]>
) => void | Promise<void>;
```

**Файл: `lib/events/event-bus.ts`**
```typescript
/**
 * Lightweight in-process event bus
 * НЕ Kafka, НЕ RabbitMQ — простой TypedEventEmitter
 * Достаточно для single-server deployment
 */
import { logger } from "@/lib/logger";
import type {
  DomainEvent,
  EventMap,
  EventType,
  EventHandler,
} from "./types";

class EventBus {
  private handlers = new Map<string, Set<EventHandler<any>>>();

  /**
   * Подписаться на событие
   */
  on<T extends EventType>(type: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // Возвращает unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  /**
   * Опубликовать событие (fire-and-forget)
   * Handlers выполняются асинхронно, ошибки логируются но не бросаются
   */
  async emit<T extends EventType>(
    type: T,
    payload: EventMap[T],
    meta?: { sourceModule?: string; workspaceId?: string; userId?: string }
  ): Promise<void> {
    const event: DomainEvent<EventMap[T]> = {
      type,
      timestamp: new Date(),
      sourceModule: meta?.sourceModule || "unknown",
      workspaceId: meta?.workspaceId,
      userId: meta?.userId,
      payload,
    };

    const handlers = this.handlers.get(type);
    if (!handlers || handlers.size === 0) return;

    logger.debug(`Event: ${type}`, { handlersCount: handlers.size });

    const promises = Array.from(handlers).map(async (handler) => {
      try {
        await handler(event);
      } catch (error) {
        logger.error(`Event handler error for ${type}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Количество подписчиков
   */
  listenerCount(type: EventType): number {
    return this.handlers.get(type)?.size ?? 0;
  }

  /**
   * Очистить все подписки (для тестов)
   */
  clear(): void {
    this.handlers.clear();
  }
}

// Singleton
const bus = new EventBus();

export function getEventBus(): EventBus {
  return bus;
}
```

**Файл: `lib/events/handlers/notification-handler.ts`**
```typescript
/**
 * Автоматическое создание уведомлений из domain events
 */
import { getEventBus } from "../event-bus";
import { prisma } from "@/lib/db";

export function registerNotificationHandlers() {
  const bus = getEventBus();

  bus.on("task.status_changed", async (event) => {
    const { taskId, newStatus, changedBy } = event.payload;

    // Найти assignee задачи
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true, title: true },
    });

    if (task?.assigneeId && task.assigneeId !== changedBy) {
      await prisma.notification.create({
        data: {
          id: `notif-${Date.now()}`,
          userId: task.assigneeId,
          type: "status_changed",
          title: `Task status changed: ${task.title}`,
          message: `Status changed to "${newStatus}"`,
          entityType: "task",
          entityId: taskId,
        },
      });
    }
  });

  bus.on("purchase_order.created", async (event) => {
    const { orderId, totalAmount, currency } = event.payload;
    // Уведомить всех с правом MANAGE_FINANCE
    // TODO: реализовать после Phase 2
  });

  bus.on("workflow.transitioned", async (event) => {
    const { entityType, entityId, fromState, toState } = event.payload;
    // Логируем все переходы workflow в audit log
    // (можно расширить до полного audit trail)
  });
}
```

**Файл: `lib/events/index.ts`**
```typescript
export { getEventBus } from "./event-bus";
export type { EventMap, EventType, EventHandler, DomainEvent } from "./types";
export { registerNotificationHandlers } from "./handlers/notification-handler";
```

#### Валидация
```bash
npx tsc --noEmit && npm run test:run
```

---

### Задача 1.3: Workflow Engine

#### Что создать

**Файл: `lib/workflow/types.ts`**
```typescript
/**
 * Configurable workflow / state machine
 * Каждая сущность (task, PO, inspection) может иметь свой workflow
 */

export interface WorkflowDef {
  id: string;                    // "task-workflow", "po-workflow"
  name: string;
  entityType: string;            // "task", "purchase_order", "qc_inspection"
  initialState: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

export interface WorkflowState {
  id: string;                    // "draft", "pending_approval", "approved"
  label: string;
  type: "initial" | "intermediate" | "final";
  color?: string;                // для UI badge
}

export interface WorkflowTransition {
  id: string;
  from: string;                  // state ID
  to: string;                    // state ID
  label: string;                 // "Submit for Approval"
  requiredPermission?: string;   // "APPROVE_PURCHASE_ORDERS"
  guards?: TransitionGuard[];    // дополнительные условия
  autoActions?: AutoAction[];    // действия при переходе
}

export interface TransitionGuard {
  type: "field_required" | "amount_limit" | "custom";
  config: Record<string, unknown>;
  errorMessage: string;
}

export interface AutoAction {
  type: "create_notification" | "emit_event" | "update_field" | "call_webhook";
  config: Record<string, unknown>;
}

export interface TransitionResult {
  success: boolean;
  fromState: string;
  toState: string;
  error?: string;
}
```

**Файл: `lib/workflow/engine.ts`**
```typescript
/**
 * Workflow Engine — выполняет переходы между состояниями
 */
import { getEventBus } from "@/lib/events";
import type {
  WorkflowDef,
  WorkflowTransition,
  TransitionResult,
} from "./types";

// Хранилище workflow definitions (in-memory, presets loaded at startup)
const workflows = new Map<string, WorkflowDef>();

/**
 * Зарегистрировать workflow definition
 */
export function registerWorkflow(def: WorkflowDef): void {
  workflows.set(def.id, def);
}

/**
 * Получить workflow по ID
 */
export function getWorkflow(id: string): WorkflowDef | undefined {
  return workflows.get(id);
}

/**
 * Получить все workflows для entity type
 */
export function getWorkflowsForEntity(entityType: string): WorkflowDef[] {
  return Array.from(workflows.values()).filter(
    (w) => w.entityType === entityType
  );
}

/**
 * Получить доступные переходы из текущего состояния
 */
export function getAvailableTransitions(
  workflowId: string,
  currentState: string,
  userPermissions?: string[]
): WorkflowTransition[] {
  const workflow = workflows.get(workflowId);
  if (!workflow) return [];

  return workflow.transitions.filter((t) => {
    if (t.from !== currentState) return false;

    // Проверить permission если задано
    if (t.requiredPermission && userPermissions) {
      return userPermissions.includes(t.requiredPermission);
    }

    return true;
  });
}

/**
 * Выполнить переход (transition)
 * Возвращает результат, НЕ обновляет БД — это делает вызывающий код
 */
export async function executeTransition(
  workflowId: string,
  currentState: string,
  transitionId: string,
  context?: {
    entityId?: string;
    userId?: string;
    workspaceId?: string;
    entityData?: Record<string, unknown>;
  }
): Promise<TransitionResult> {
  const workflow = workflows.get(workflowId);
  if (!workflow) {
    return { success: false, fromState: currentState, toState: currentState, error: "Workflow not found" };
  }

  const transition = workflow.transitions.find(
    (t) => t.id === transitionId && t.from === currentState
  );
  if (!transition) {
    return { success: false, fromState: currentState, toState: currentState, error: "Invalid transition" };
  }

  // Execute guards
  for (const guard of transition.guards || []) {
    if (guard.type === "field_required") {
      const field = guard.config.field as string;
      if (!context?.entityData?.[field]) {
        return {
          success: false,
          fromState: currentState,
          toState: currentState,
          error: guard.errorMessage,
        };
      }
    }
    // Добавляй другие guard types здесь
  }

  // Emit workflow event
  const bus = getEventBus();
  await bus.emit("workflow.transitioned", {
    entityType: workflow.entityType,
    entityId: context?.entityId || "",
    workflowId: workflow.id,
    fromState: currentState,
    toState: transition.to,
    triggeredBy: context?.userId,
  }, {
    sourceModule: "workflow-engine",
    workspaceId: context?.workspaceId,
    userId: context?.userId,
  });

  return {
    success: true,
    fromState: currentState,
    toState: transition.to,
  };
}

/**
 * Список всех зарегистрированных workflows
 */
export function listWorkflows(): WorkflowDef[] {
  return Array.from(workflows.values());
}
```

**Файл: `lib/workflow/presets.ts`**
```typescript
/**
 * Preset workflow definitions
 * Загружаются при старте приложения
 */
import { registerWorkflow } from "./engine";
import type { WorkflowDef } from "./types";

export const TASK_WORKFLOW: WorkflowDef = {
  id: "task-standard",
  name: "Standard Task Workflow",
  entityType: "task",
  initialState: "todo",
  states: [
    { id: "todo", label: "To Do", type: "initial", color: "#94a3b8" },
    { id: "in_progress", label: "In Progress", type: "intermediate", color: "#3b82f6" },
    { id: "review", label: "In Review", type: "intermediate", color: "#f59e0b" },
    { id: "done", label: "Done", type: "final", color: "#22c55e" },
    { id: "cancelled", label: "Cancelled", type: "final", color: "#ef4444" },
  ],
  transitions: [
    { id: "start", from: "todo", to: "in_progress", label: "Start Work" },
    { id: "submit_review", from: "in_progress", to: "review", label: "Submit for Review" },
    { id: "approve", from: "review", to: "done", label: "Approve", requiredPermission: "MANAGE_TASKS" },
    { id: "reject", from: "review", to: "in_progress", label: "Request Changes" },
    { id: "cancel", from: "todo", to: "cancelled", label: "Cancel", requiredPermission: "MANAGE_TASKS" },
    { id: "cancel_wip", from: "in_progress", to: "cancelled", label: "Cancel", requiredPermission: "MANAGE_TASKS" },
  ],
};

export const PURCHASE_ORDER_WORKFLOW: WorkflowDef = {
  id: "po-standard",
  name: "Purchase Order Workflow",
  entityType: "purchase_order",
  initialState: "draft",
  states: [
    { id: "draft", label: "Draft", type: "initial", color: "#94a3b8" },
    { id: "submitted", label: "Submitted", type: "intermediate", color: "#3b82f6" },
    { id: "approved", label: "Approved", type: "intermediate", color: "#22c55e" },
    { id: "sent", label: "Sent to Supplier", type: "intermediate", color: "#8b5cf6" },
    { id: "received", label: "Goods Received", type: "intermediate", color: "#06b6d4" },
    { id: "closed", label: "Closed", type: "final", color: "#22c55e" },
    { id: "cancelled", label: "Cancelled", type: "final", color: "#ef4444" },
  ],
  transitions: [
    { id: "submit", from: "draft", to: "submitted", label: "Submit for Approval",
      guards: [{ type: "field_required", config: { field: "supplierId" }, errorMessage: "Supplier is required" }] },
    { id: "approve", from: "submitted", to: "approved", label: "Approve", requiredPermission: "APPROVE_PURCHASES" },
    { id: "reject", from: "submitted", to: "draft", label: "Return to Draft" },
    { id: "send", from: "approved", to: "sent", label: "Send to Supplier" },
    { id: "receive", from: "sent", to: "received", label: "Mark as Received" },
    { id: "close", from: "received", to: "closed", label: "Close Order" },
    { id: "cancel", from: "draft", to: "cancelled", label: "Cancel" },
    { id: "cancel_submitted", from: "submitted", to: "cancelled", label: "Cancel", requiredPermission: "APPROVE_PURCHASES" },
  ],
};

export const QC_INSPECTION_WORKFLOW: WorkflowDef = {
  id: "qc-inspection",
  name: "QC Inspection Workflow",
  entityType: "qc_inspection",
  initialState: "scheduled",
  states: [
    { id: "scheduled", label: "Scheduled", type: "initial", color: "#94a3b8" },
    { id: "in_progress", label: "In Progress", type: "intermediate", color: "#3b82f6" },
    { id: "completed", label: "Completed", type: "intermediate", color: "#22c55e" },
    { id: "failed", label: "Failed (NCR)", type: "intermediate", color: "#ef4444" },
    { id: "resolved", label: "Resolved", type: "final", color: "#22c55e" },
    { id: "closed", label: "Closed", type: "final", color: "#94a3b8" },
  ],
  transitions: [
    { id: "begin", from: "scheduled", to: "in_progress", label: "Begin Inspection" },
    { id: "pass", from: "in_progress", to: "completed", label: "Pass" },
    { id: "fail", from: "in_progress", to: "failed", label: "Fail (Create NCR)" },
    { id: "resolve", from: "failed", to: "resolved", label: "NCR Resolved" },
    { id: "close_pass", from: "completed", to: "closed", label: "Close" },
    { id: "close_resolved", from: "resolved", to: "closed", label: "Close" },
  ],
};

/**
 * Загрузить все preset workflows
 * Вызывай при старте приложения
 */
export function loadPresetWorkflows(): void {
  registerWorkflow(TASK_WORKFLOW);
  registerWorkflow(PURCHASE_ORDER_WORKFLOW);
  registerWorkflow(QC_INSPECTION_WORKFLOW);
}
```

**Файл: `lib/workflow/index.ts`**
```typescript
export {
  registerWorkflow,
  getWorkflow,
  getWorkflowsForEntity,
  getAvailableTransitions,
  executeTransition,
  listWorkflows,
} from "./engine";
export { loadPresetWorkflows } from "./presets";
export type {
  WorkflowDef,
  WorkflowState,
  WorkflowTransition,
  TransitionGuard,
  AutoAction,
  TransitionResult,
} from "./types";
```

**API route: `app/api/workflows/route.ts`**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { listWorkflows, getAvailableTransitions } from "@/lib/workflow";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get("entityType");
  const workflowId = searchParams.get("workflowId");
  const currentState = searchParams.get("currentState");

  // Если запрос конкретных transitions
  if (workflowId && currentState) {
    const transitions = getAvailableTransitions(workflowId, currentState);
    return NextResponse.json({ transitions });
  }

  // Иначе — список workflows
  let workflows = listWorkflows();
  if (entityType) {
    workflows = workflows.filter((w) => w.entityType === entityType);
  }

  return NextResponse.json({ workflows });
}
```

#### Валидация Phase 1
```bash
npx tsc --noEmit && npm run test:run && npm run build
git add -A && git commit -m "feat: Phase 1 — module system, event bus, workflow engine

- lib/modules/: ModuleManifest, ModuleRegistry, core module auto-registration
- lib/events/: TypedEventBus, domain events, notification handler
- lib/workflow/: WorkflowEngine, state machine, preset workflows (task, PO, QC)
- API: /api/modules, /api/workflows

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Phase 2: Procurement Module

> **Цель:** Создать полноценный закупочный модуль — главная бизнес-ценность v2.0  
> **Зависимости:** Phase 1 (module system, workflow engine)  
> **Результат:** Vendor scoring → RFQ → RFP → Purchase Orders  

### Задача 2.1: Vendor Scoring & Due Diligence

#### Prisma models (добавить в schema.prisma)
```prisma
// В конец schema.prisma добавить:

model VendorScore {
  id             String   @id @default(cuid())
  supplierId     String
  score          Float    // 0-100
  qualityScore   Float    @default(0)  // качество поставок
  priceScore     Float    @default(0)  // конкурентность цен
  deliveryScore  Float    @default(0)  // соблюдение сроков
  reliabilityScore Float  @default(0)  // надёжность (из истории)
  complianceScore Float   @default(0)  // юридическая чистота
  calculatedAt   DateTime @default(now())
  supplier       Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId, calculatedAt])
}

model DueDiligenceCheck {
  id            String   @id @default(cuid())
  supplierId    String
  checkType     String   // "inn_verification", "financial_check", "license_check"
  status        String   @default("pending") // "pending", "passed", "failed", "expired"
  result        String?  // JSON string с деталями
  checkedAt     DateTime?
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
  supplier      Supplier @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@index([supplierId, checkType])
}
```

Также добавить в модель Supplier:
```prisma
model Supplier {
  // ... существующие поля ...
  scores          VendorScore[]
  dueDiligence    DueDiligenceCheck[]
}
```

#### Логика scoring

**Файл: `lib/modules/procurement/vendor-scoring.ts`**
```typescript
/**
 * Vendor Scoring Engine
 * Рассчитывает рейтинг поставщика по 5 факторам (0-100)
 */
import { prisma } from "@/lib/db";
import { getEventBus } from "@/lib/events";

interface ScoreFactors {
  qualityScore: number;    // % контрактов без рекламаций
  priceScore: number;      // конкурентность цен (из RFQ responses)
  deliveryScore: number;   // % контрактов завершённых в срок
  reliabilityScore: number; // общая история (кол-во контрактов, давность)
  complianceScore: number;  // все DD checks passed?
}

/**
 * Пересчитать рейтинг поставщика
 */
export async function recalculateVendorScore(
  supplierId: string
): Promise<{ score: number; factors: ScoreFactors }> {
  // 1. Quality: из Contract completion rate
  const contracts = await prisma.contract.findMany({
    where: { supplierId },
    select: { status: true, amount: true },
  });
  const completedContracts = contracts.filter((c) => c.status === "completed");
  const qualityScore = contracts.length > 0
    ? (completedContracts.length / contracts.length) * 100
    : 50; // default для новых поставщиков

  // 2. Price: пока placeholder (будет из RFQ responses в Phase 2.2)
  const priceScore = 50;

  // 3. Delivery: из Contract.endDate vs actual
  const deliveryScore = qualityScore; // упрощённо, пока == quality

  // 4. Reliability: больше контрактов = выше
  const reliabilityScore = Math.min(contracts.length * 10, 100);

  // 5. Compliance: из DueDiligenceCheck
  const ddChecks = await prisma.dueDiligenceCheck.findMany({
    where: { supplierId },
  });
  const passedChecks = ddChecks.filter((d) => d.status === "passed");
  const complianceScore = ddChecks.length > 0
    ? (passedChecks.length / ddChecks.length) * 100
    : 0;

  const factors: ScoreFactors = {
    qualityScore: Math.round(qualityScore),
    priceScore,
    deliveryScore: Math.round(deliveryScore),
    reliabilityScore: Math.round(reliabilityScore),
    complianceScore: Math.round(complianceScore),
  };

  // Weighted average
  const score = Math.round(
    factors.qualityScore * 0.25 +
    factors.priceScore * 0.25 +
    factors.deliveryScore * 0.20 +
    factors.reliabilityScore * 0.15 +
    factors.complianceScore * 0.15
  );

  // Сохранить в БД
  await prisma.vendorScore.create({
    data: {
      supplierId,
      score,
      ...factors,
    },
  });

  // Обновить Supplier.rating
  await prisma.supplier.update({
    where: { id: supplierId },
    data: { rating: score },
  });

  // Emit event
  const bus = getEventBus();
  await bus.emit("supplier.scored", {
    supplierId,
    score,
    factors: factors as unknown as Record<string, number>,
  }, { sourceModule: "procurement" });

  return { score, factors };
}
```

#### API routes

**Файл: `app/api/suppliers/[id]/score/route.ts`**
```typescript
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { recalculateVendorScore } from "@/lib/modules/procurement/vendor-scoring";
import { prisma } from "@/lib/db";

// GET — текущий score
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const scores = await prisma.vendorScore.findMany({
    where: { supplierId: id },
    orderBy: { calculatedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({ scores });
}

// POST — пересчитать
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;
  const result = await recalculateVendorScore(id);
  return NextResponse.json(result);
}
```

#### Валидация
```bash
npx prisma generate  # после добавления моделей
npx tsc --noEmit && npm run test:run
```

---

### Задача 2.2: RFQ / RFP (Request for Quote / Request for Proposal)

#### Prisma models
```prisma
model PurchaseRequest {
  id              String   @id @default(cuid())
  projectId       String?
  title           String
  description     String?
  status          String   @default("draft")  // workflow: draft→approved→rfq_sent→evaluated→closed
  requiredBy      DateTime?
  estimatedAmount Float?
  currency        String   @default("RUB")
  createdById     String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  project         Project? @relation(fields: [projectId], references: [id])
  lineItems       PRLineItem[]
  rfqs            RFQ[]

  @@index([projectId, status])
}

model PRLineItem {
  id                String   @id @default(cuid())
  purchaseRequestId String
  description       String
  quantity          Float
  unit              String   @default("шт")
  estimatedPrice    Float?
  specifications    String?
  purchaseRequest   PurchaseRequest @relation(fields: [purchaseRequestId], references: [id], onDelete: Cascade)
}

model RFQ {
  id                String   @id @default(cuid())
  purchaseRequestId String
  supplierId        String
  status            String   @default("sent")  // sent, responded, expired, declined
  sentAt            DateTime @default(now())
  respondBy         DateTime?
  purchaseRequest   PurchaseRequest @relation(fields: [purchaseRequestId], references: [id])
  supplier          Supplier        @relation(fields: [supplierId], references: [id])
  response          RFQResponse?

  @@index([purchaseRequestId])
  @@index([supplierId])
}

model RFQResponse {
  id            String   @id @default(cuid())
  rfqId         String   @unique
  totalAmount   Float
  currency      String   @default("RUB")
  deliveryDays  Int?
  validUntil    DateTime?
  notes         String?
  attachmentUrl String?
  respondedAt   DateTime @default(now())
  rfq           RFQ      @relation(fields: [rfqId], references: [id], onDelete: Cascade)
  lineItems     RFQResponseLine[]
}

model RFQResponseLine {
  id             String   @id @default(cuid())
  responseId     String
  description    String
  quantity       Float
  unitPrice      Float
  totalPrice     Float
  availableFrom  DateTime?
  response       RFQResponse @relation(fields: [responseId], references: [id], onDelete: Cascade)
}
```

#### Логика

**Файл: `lib/modules/procurement/rfq-service.ts`**

Создать сервис с функциями:
- `createPurchaseRequest(data)` — создание заявки
- `createRFQ(purchaseRequestId, supplierIds)` — отправить RFQ выбранным поставщикам
- `submitRFQResponse(rfqId, responseData)` — поставщик отвечает
- `compareRFQResponses(purchaseRequestId)` — сравнительная таблица ответов

**Файл: `lib/modules/procurement/rfp-evaluator.ts`**

AI-assisted evaluation:
- `evaluateResponses(purchaseRequestId)` — AI анализирует все ответы
- Возвращает ранжированный список с обоснованием (price, delivery, quality)
- Использует существующий AI chat system (`lib/ai/`)

#### API routes
- `POST /api/procurement/purchase-requests` — CRUD
- `POST /api/procurement/rfq/send` — отправить RFQ
- `POST /api/procurement/rfq/[id]/respond` — ответ от поставщика
- `GET /api/procurement/purchase-requests/[id]/compare` — сравнение ответов

---

### Задача 2.3: Purchase Orders

#### Prisma models
```prisma
model PurchaseOrder {
  id               String   @id @default(cuid())
  number           String   @unique
  purchaseRequestId String?
  supplierId       String
  projectId        String?
  status           String   @default("draft")  // workflow: po-standard
  totalAmount      Float
  currency         String   @default("RUB")
  issueDate        DateTime @default(now())
  expectedDelivery DateTime?
  notes            String?
  createdById      String?
  approvedById     String?
  approvedAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  supplier         Supplier  @relation(fields: [supplierId], references: [id])
  project          Project?  @relation(fields: [projectId], references: [id])
  lineItems        POLineItem[]
  approvals        POApproval[]

  @@index([supplierId])
  @@index([projectId, status])
  @@index([status])
}

model POLineItem {
  id              String   @id @default(cuid())
  purchaseOrderId String
  description     String
  quantity        Float
  unit            String   @default("шт")
  unitPrice       Float
  totalPrice      Float
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)
}

model POApproval {
  id              String   @id @default(cuid())
  purchaseOrderId String
  approverId      String
  action          String   // "approved", "rejected"
  comment         String?
  createdAt       DateTime @default(now())
  purchaseOrder   PurchaseOrder @relation(fields: [purchaseOrderId], references: [id], onDelete: Cascade)

  @@index([purchaseOrderId])
}
```

#### Логика

**Файл: `lib/modules/procurement/po-service.ts`**
- `createPurchaseOrder(data)` — создание PO (может из RFQ response)
- `submitForApproval(poId)` — отправить на утверждение (workflow transition)
- `approvePO(poId, approverId, comment?)` — утвердить
- `sendToSupplier(poId)` — отправить поставщику (через Email/Telegram connector)
- `markAsReceived(poId)` — пометить как полученный

Каждое действие — workflow transition через `executeTransition()` из Phase 1.

#### API routes
- `GET/POST /api/procurement/purchase-orders` — CRUD
- `POST /api/procurement/purchase-orders/[id]/approve` — утвердить
- `POST /api/procurement/purchase-orders/[id]/send` — отправить
- `POST /api/procurement/purchase-orders/[id]/receive` — получить

#### UI pages
- `/procurement` — dashboard (заявки, RFQ, PO, статистика)
- `/procurement/purchase-requests/new` — создание заявки
- `/procurement/compare/[id]` — сравнительная таблица RFQ ответов
- `/procurement/orders` — список PO

#### Module manifest

**Файл: `lib/modules/procurement/manifest.ts`**
```typescript
import type { ModuleManifest } from "@/lib/modules/types";

export const PROCUREMENT_MANIFEST: ModuleManifest = {
  id: "procurement",
  name: "Procurement Management",
  description: "Закупки: заявки, RFQ, сравнение КП, Purchase Orders",
  version: "1.0.0",
  category: "business",
  requiredModules: ["core-finance"],
  prismaModels: ["PurchaseRequest", "RFQ", "RFQResponse", "PurchaseOrder"],
  apiRoutes: ["/api/procurement"],
  uiPages: ["/procurement"],
  aiTools: ["create_purchase_request", "evaluate_rfq_responses"],
  events: [
    { name: "purchase_order.created", description: "PO создан", payload: "PurchaseOrderCreatedPayload" },
    { name: "rfq.response_received", description: "Получен ответ на RFQ", payload: "RFQResponseReceivedPayload" },
  ],
  workflows: ["po-standard"],
};
```

#### Валидация Phase 2
```bash
npx prisma generate
npx tsc --noEmit && npm run test:run && npm run build
git add -A && git commit -m "feat: Phase 2 — Procurement module (vendor scoring, RFQ/RFP, purchase orders)
..."
```

---

## Phase 3: Contractor Module

> **Зависимости:** Phase 2 (vendor scoring)  

### Задача 3.1: Contractor Registry

#### Prisma models
```prisma
model ContractorProfile {
  id              String   @id @default(cuid())
  supplierId      String   @unique
  specializations String[] // ["дорожное строительство", "электромонтаж"]
  certifications  ContractorCertification[]
  insuranceExpiry DateTime?
  safetyRating    Float?   @default(0)
  workersCount    Int?
  equipmentCount  Int?
  notes           String?
  verifiedAt      DateTime?
  supplier        Supplier @relation(fields: [supplierId], references: [id])
}

model ContractorCertification {
  id              String   @id @default(cuid())
  profileId       String
  name            String   // "СРО", "ISO 9001", "Лицензия Ростехнадзора"
  number          String?
  issuedBy        String?
  issuedAt        DateTime?
  expiresAt       DateTime?
  documentUrl     String?
  profile         ContractorProfile @relation(fields: [profileId], references: [id], onDelete: Cascade)
}
```

#### Логика

**Файл: `lib/modules/contractors/compliance-check.ts`**
- `checkINN(inn)` — stub для API ФНС / egrul.nalog.ru (возвращает mock для MVP)
- `checkLicenses(supplierId)` — проверка действительности лицензий
- `calculateSafetyRating(supplierId)` — рейтинг безопасности из истории инцидентов

**Файл: `lib/modules/contractors/reputation-engine.ts`**
- `calculateReputation(supplierId)` — рассчитать репутацию из:
  - VendorScore.score (из Phase 2)
  - Contract completion history
  - DueDiligence results
  - Safety incidents

### Задача 3.2: Contractor Portal

Создать публичные страницы (без auth):
- `/contractor-portal/[token]` — по инвайт-ссылке
- Contractor может: заполнить профиль, загрузить документы, видеть назначенные задачи
- Admin workflow: приглашение → заполнение → проверка → утверждение

---

## Phase 4: Onboarding v2 + Agent Orchestrator

> **Зависимости:** Phase 1 (module system)  

### Задача 4.1: Industry-Aware Onboarding

Улучшить существующий onboarding wizard:
1. **Company identity** — ИНН → auto-fill через DaData API (stub-able)
2. **Industry** — ОКВЭД → автоматически рекомендовать модули
3. **Data sources** — список коннекторов с toggle
4. **Module activation** — показать рекомендованные модули, дать включить/выключить
5. **AI calibration** — стиль общения, приоритеты

Использовать: существующий `app/tenant-onboarding/` + `lib/connectors/profiles.ts`

### Задача 4.2: Agent Orchestrator

**Файл: `lib/ai/orchestrator.ts`**
- `AgentOrchestrator` class — управляет AI агентами
- Каждый модуль может зарегистрировать свои AI tools
- Orchestrator решает какого агента вызвать на основе запроса пользователя
- Использует существующий `lib/ai/tool-registry.ts`

---

## Phase 5: QC + Tenders

> **Зависимости:** Phase 1  
> **Приоритет:** LOW — реализовывать когда будет product-market fit  

### QC Module
- QCChecklist, QCInspection, NonConformanceReport models
- Mobile-first UI для полевых проверок
- Интеграция с existing evidence ledger (GPS + фото)

### Tender Aggregator
- RSS/API integration с официальными тендерными источниками
- AI scoring relevance per company profile
- Notification через existing Telegram/Email connectors

---

## Справочник существующих паттернов

### Auth import
```typescript
import { authorizeRequest } from "@/app/api/middleware/auth";
```

### Prisma
```typescript
import { prisma } from "@/lib/db";
```

### i18n — НЕ используй для новых ключей
```typescript
// Строго типизирован. Для новых компонентов используй inline strings:
<span>Purchase Orders</span>
// НЕ делай: t("purchaseOrders") — будет TS ошибка
```

### Next.js dynamic route params (App Router)
```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ...
}
```

### Buffer → NextResponse
```typescript
// Buffer нельзя передавать напрямую в NextResponse, нужен Uint8Array:
return new NextResponse(new Uint8Array(buffer), { headers: {...} });
```

### Prisma schema — Project fields
```
Project.start (не startDate!)
Project.end (не endDate!)
Task.percentComplete (не progress!)
Task.dueDate
Milestone.title (не name!)
Milestone.date (не dueDate!)
Supplier: contactName, phone, email (не contact!)
```

### Connector pattern (шаблон для нового adapter)
```typescript
// Смотри: lib/connectors/adapters/telegram.ts как образец
// ConnectorAdapter interface: id, name, description, direction, operations, getStatus()
```

### Validation pipeline
```bash
npx tsc --noEmit          # TypeScript проверка
npm run test:run          # 141+ тестов (vitest)
npm run build             # Full Next.js build (нужны DATABASE_URL + DIRECT_URL)

# Для build с фейковым DB URL:
DATABASE_URL='postgresql://u:p@localhost:5432/db' DIRECT_URL='postgresql://u:p@localhost:5432/db' npm run build
```

### Git commit format
```bash
git add -A && git commit -m "feat: <описание>

<детали>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Порядок выполнения (для AI-модели)

1. **Читай этот документ ЦЕЛИКОМ перед началом работы**
2. Начни с Phase 1.1 (Module System) — создай файлы, проверь TSC
3. Затем Phase 1.2 (Event Bus) — создай файлы, проверь TSC
4. Затем Phase 1.3 (Workflow Engine) — создай файлы, проверь TSC + test + build
5. Коммит Phase 1
6. Phase 2.1 (Vendor Scoring) — добавь Prisma models, `prisma generate`, логика, API
7. Phase 2.2 (RFQ/RFP) — models, service, API
8. Phase 2.3 (Purchase Orders) — models, service, API, UI
9. Коммит Phase 2
10. Phase 3 → Phase 4 → Phase 5 (по порядку)

**После КАЖДОЙ задачи:**
```bash
npx tsc --noEmit && npm run test:run
```

**После КАЖДОЙ фазы:**
```bash
npx tsc --noEmit && npm run test:run && npm run build
git add -A && git commit -m "..."
```

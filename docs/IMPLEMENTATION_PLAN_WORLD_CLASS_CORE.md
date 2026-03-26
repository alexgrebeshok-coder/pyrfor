# CEOClaw — План доведения ядра до мирового класса
# Implementation Plan: World-Class Multi-Agent Core

> **Дата:** 2026-03-26
> **Версия:** 1.0
> **Цель:** Поэтапный план для AI-модели, реализующей улучшения ядра CEOClaw
> **Основа:** Архитектурное сравнение CEOClaw vs OpenClaw vs LangGraph/AutoGen/MetaGPT
> **Источник:** `docs/ARCHITECTURE_COMPARISON_2026-03-26.md`

---

## ПОЛНЫЙ ПУТЬ АНАЛИЗА (что было исследовано)

### Шаг 1: Аудит CEOClaw (commit 8d1a0fd)
- **1,013 TS/TSX файлов**, 167,022 LOC, 54 Prisma-модели, 179 API-маршрутов, 245 компонентов
- Обнаружено: 25 агентов в 8 категориях, 8 LLM-провайдеров, 5 hardcoded collaboration blueprints
- Уникально: Evidence Ledger (3 уровня верификации), Safety Profiles (proposal-as-draft), PM Domain (EVM, critical path, risk matrix)
- Слабо: агенты = prompt templates, нет памяти, нет inter-agent communication, нет расширяемости

### Шаг 2: Анализ OpenClaw (`~/Desktop/OpenClaw`)
- 20 агентов в 3-уровневой иерархии (3 orchestrators → 11 workers → 6 utilities)
- Истинная автономность: per-agent workspace + SQLite memory + semantic embeddings + sandbox
- 12 messaging channels (Telegram, WhatsApp, Slack, Discord, Signal, iMessage...)
- Per-agent tool profiles с allowlist/deny/sandbox security

### Шаг 3: Рыночные конкуренты
- **LangGraph**: DAG-оркестрация, 94% accuracy, checkpointing, 90k GitHub stars
- **AutoGen/MS Agent Framework**: event-driven, Azure native, 20% быстрее
- **Semantic Kernel**: pluggable orchestration (.NET/TypeScript), concurrent/sequential/handoff/group-chat
- **CrewAI**: role-based teams, YAML config, MVP/prototype уровень
- **MetaGPT**: SOP-driven software company, 46.67% SWE-Bench Lite

### Шаг 4: 12-параметровое сравнение
| Критерий | CEOClaw | OpenClaw | LangGraph | AutoGen |
|----------|---------|----------|-----------|---------|
| Оркестрация | 3/5 | 4/5 | 5/5 | 4/5 |
| Автономность | **1/5** | 5/5 | 4/5 | 5/5 |
| Память | **1/5** | 4/5 | 4/5 | 4/5 |
| Tool Use | 2/5 | 5/5 | 5/5 | 5/5 |
| LLM Providers | **5/5** | 3/5 | 5/5 | 4/5 |
| Безопасность | **5/5** | 4/5 | 4/5 | 4/5 |
| Evidence | **5/5** | 2/5 | 3/5 | 3/5 |
| PM Domain | **5/5** | 1/5 | 0/5 | 0/5 |
| Multi-channel | 2/5 | 5/5 | 0/5 | 2/5 |
| Расширяемость | **1/5** | 4/5 | 5/5 | 5/5 |

### Стратегическая рекомендация
**"Лучшее из всех миров":**
1. **СОХРАНИТЬ**: Evidence Ledger + Safety Profiles + PM Domain + Russian LLMs (уникально, нет конкурентов)
2. **ДОБАВИТЬ из OpenClaw**: agent memory, hierarchical orchestration, agent-to-agent messaging, multi-channel
3. **ДОБАВИТЬ из LangGraph/AutoGen**: DAG workflows, dynamic planning, checkpointing, observability
4. **ИТОГ**: Первая в мире PM-specific multi-agent platform с enterprise-grade safety + true agent autonomy

---

## ТЕХНИЧЕСКИЙ КОНТЕКСТ ДЛЯ РЕАЛИЗУЮЩЕЙ МОДЕЛИ

### Текущая структура файлов AI-ядра
```
/Users/aleksandrgrebeshok/ceoclaw-dev/lib/ai/
├── agents.ts                    (256 строк) — registry 25 агентов (МЕНЯТЬ: добавить loader)
├── types.ts                     (369 строк) — типы (РАСШИРЯТЬ)
├── kernel-control-plane.ts      (424 строки) — central dispatcher 8 ops (МЕНЯТЬ: добавить ops)
├── multi-agent-runtime.ts       (714 строк) — 5 blueprints + collaboration (МЕНЯТЬ: dynamic planner)
├── server-runs.ts               (569 строк) — run lifecycle (МЕНЯТЬ: интегрировать AgentExecutor)
├── providers.ts                 (890 строк) — 8 провайдеров + AIRouter (РАЗБИВАТЬ: P1)
├── context-builder.ts           (802 строки) — AI context assembly (МЕНЯТЬ: +memory+RAG)
├── openclaw-gateway.ts          (810 строк) — gateway orchestration (МЕНЯТЬ: +streaming)
├── grounding.ts                 (534 строки) — evidence integration (НЕ МЕНЯТЬ)
├── kernel-tool-plane.ts         (282 строки) — 13 tools (МЕНЯТЬ: +plugin registry)
├── auto-routing.ts              (185 строк) — keyword routing (МЕНЯТЬ: LLM-based routing)
├── safety.ts                    (226 строк) — safety profiles (НЕ МЕНЯТЬ, только расширять)
├── proposal-apply-executor.ts   (280 строк) — proposal execution (МЕНЯТЬ: +agent-initiated)
├── action-engine.ts             — action engine
├── adapter.ts                   (16 строк) — adapter factory
├── gateway-adapter.ts           (165 строк) — HTTP adapter
├── mock-adapter.ts              (1032 строки) — mock adapter
├── tools.ts                     (443 строки) — 13 tool definitions
├── quick-actions.ts             (53 строки) — 5 quick actions
├── circuit-breaker.ts           (уже существует — проверить содержимое!)
└── tool-services/               — 4 domain services
    ├── project-service.ts
    ├── finance-service.ts
    ├── inventory-service.ts
    └── scheduling-service.ts
```

### Prisma schema (ключевые существующие модели)
- `AgentSession` — уже есть: agentId, status, cost, tokens (использовать как основу для cost tracking)
- `AIProvider` — уже есть: id, name, apiKey, priority (использовать в circuit breaker)
- `EvidenceRecord` — Evidence Ledger (НЕ МЕНЯТЬ)
- `WorkReport` → ... — Work-Report Chain (НЕ МЕНЯТЬ)
- **Нужно добавить**: AgentMemory, WorkflowCheckpoint, ProjectDocument, AIRunCost, WorkflowTemplate

### Важные ограничения
1. `authorizeRequest()` используется в ВСЕХ 179 API-маршрутах — не ломать
2. `typescript strict:true` — все новые файлы должны проходить tsc
3. `132/132 тестов` — не ломать существующие тесты
4. `next/image` не используется — при добавлении UI-компонентов использовать
5. `.next = 2.2GB` — минимизировать добавление зависимостей, использовать dynamic imports

---

## ФАЗЫ РЕАЛИЗАЦИИ

---

## PHASE 0: ПОДГОТОВКА (1 неделя)
*Цель: Зафиксировать текущее состояние, написать tests as contracts, подготовить инфраструктуру*

### Задача P0-1: Зафиксировать публичные интерфейсы AI core
**Файлы для создания:**
- `lib/ai/__tests__/contracts.test.ts`

**Что делать:**
```typescript
// Проверить что эти типы существуют и не изменились
import type {
  AIKernelRequest, AIKernelResponse,    // kernel-control-plane
  AIRunInput, AIRunResult, AIRunRecord, // server-runs
  AIAdapter,                             // adapter
  AIAgentDefinition,                     // agents
  AIChatContextBundle,                   // context-builder
  AIProposalState, AIActionType,         // types
} from "@/lib/ai/types";

// Contract test: dispatch принимает правильные типы
it("KernelControlPlane dispatches run.create", async () => {
  const req: AIKernelRequest = {
    operation: "run.create",
    payload: { agentId: "auto-routing", prompt: "test", workspaceId: "ws-1" }
  };
  expect(req.operation).toBe("run.create");
});
```

### Задача P0-2: Baseline metrics
**Запустить и зафиксировать:**
```bash
npm run test:run   # должно быть 132/132
npx tsc --noEmit  # 0 ошибок
npm run build     # успешная сборка
```
**Создать файл:** `docs/BASELINE_2026-03-26.md` с результатами

### Задача P0-3: Проверить существующий circuit-breaker.ts
```bash
cat lib/ai/circuit-breaker.ts
```
**Если файл уже содержит реализацию** — изучить и использовать как основу для P1-2.

---

## PHASE 1: FOUNDATION REFACTORING (2-3 недели)
*Цель: Чистая, расширяемая основа. Нет монолитов. Circuit breaker. Cost tracking. Config-driven agents.*

### Задача P1-1: Разбить providers.ts на отдельные файлы

**Создать структуру:**
```
lib/ai/providers/
├── index.ts          ← AIRouter + createAIRouter() factory
├── base.ts           ← AIProvider interface + AIProviderConfig
├── gigachat.ts       ← GigaChatProvider
├── yandexgpt.ts      ← YandexGPTProvider
├── openrouter.ts     ← OpenRouterProvider
├── openai.ts         ← OpenAIProvider
├── aijora.ts         ← AIJoraProvider
├── polza.ts          ← PolzaProvider
├── bothub.ts         ← BothubProvider
├── zai.ts            ← ZAIProvider
├── manifests.ts      ← provider manifests (из provider-manifests.ts)
└── __tests__/
    └── router.test.ts
```

**Сохранить обратную совместимость — в providers.ts:**
```typescript
// lib/ai/providers.ts (оставить как re-export для совместимости)
export * from "./providers/index";
export * from "./providers/base";
```

**Интерфейс базового провайдера (base.ts):**
```typescript
export interface AIProvider {
  readonly name: string;
  readonly models: string[];
  chat(
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
    options?: { model?: string; temperature?: number; maxTokens?: number }
  ): Promise<string>;
  chatStream?(
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
    options?: { model?: string }
  ): AsyncIterable<string>;
}

export interface AIProviderConfig {
  name: string;
  priority: number;  // lower = higher priority
  enabled: boolean;
  models: { id: string; costPerInputToken: number; costPerOutputToken: number }[];
  defaultModel: string;
}
```

### Задача P1-2: Circuit Breaker + Cross-Provider Fallback

**Файл:** `lib/ai/providers/circuit-breaker.ts`

```typescript
export interface CircuitBreakerConfig {
  failureThreshold: number;  // default: 3
  cooldownMs: number;        // default: 60_000 (1 min)
  halfOpenRequests: number;  // default: 1 (probe request)
}

type CircuitState = "closed" | "open" | "half-open";

interface ProviderHealth {
  state: CircuitState;
  failures: number;
  lastFailureAt: number | null;
  successCount: number;
}

export class ProviderCircuitBreaker {
  private health: Map<string, ProviderHealth> = new Map();

  constructor(private config: CircuitBreakerConfig = {
    failureThreshold: 3,
    cooldownMs: 60_000,
    halfOpenRequests: 1
  }) {}

  isAvailable(providerName: string): boolean {
    const h = this.health.get(providerName);
    if (!h) return true;
    if (h.state === "closed") return true;
    if (h.state === "open") {
      const elapsed = Date.now() - (h.lastFailureAt ?? 0);
      if (elapsed >= this.config.cooldownMs) {
        h.state = "half-open";
        return true;
      }
      return false;
    }
    return h.state === "half-open";
  }

  recordSuccess(providerName: string): void {
    const h = this.getOrCreate(providerName);
    h.failures = 0;
    h.state = "closed";
    h.successCount++;
  }

  recordFailure(providerName: string): void {
    const h = this.getOrCreate(providerName);
    h.failures++;
    h.lastFailureAt = Date.now();
    if (h.failures >= this.config.failureThreshold) {
      h.state = "open";
    }
  }

  private getOrCreate(name: string): ProviderHealth {
    if (!this.health.has(name)) {
      this.health.set(name, { state: "closed", failures: 0, lastFailureAt: null, successCount: 0 });
    }
    return this.health.get(name)!;
  }

  getStatus(): Record<string, ProviderHealth> {
    return Object.fromEntries(this.health.entries());
  }
}

// Singleton
export const providerCircuitBreaker = new ProviderCircuitBreaker();
```

**Интегрировать в AIRouter (providers/index.ts):**
```typescript
async chat(messages: Message[], options?: { provider?: string; model?: string }): Promise<string> {
  const providerName = options?.provider ?? this.defaultProvider;
  const fallbackChain = this.buildFallbackChain(providerName);

  for (const name of fallbackChain) {
    if (!providerCircuitBreaker.isAvailable(name)) continue;
    const provider = this.providers.get(name);
    if (!provider) continue;

    const startMs = Date.now();
    try {
      const result = await provider.chat(messages, options);
      providerCircuitBreaker.recordSuccess(name);
      // Log cost
      await costTracker.log({ provider: name, model: options?.model ?? "default",
        latencyMs: Date.now() - startMs, inputTokens: estimateTokens(messages) });
      return result;
    } catch (err) {
      providerCircuitBreaker.recordFailure(name);
      logger.warn(`Provider ${name} failed, trying next in chain`, { err });
    }
  }
  throw new Error("All providers in fallback chain failed");
}

private buildFallbackChain(primary: string): string[] {
  const allProviders = ["gigachat", "yandexgpt", "aijora", "polza", "bothub", "openrouter", "openai", "zai"];
  const available = allProviders.filter(p => this.providers.has(p));
  return [primary, ...available.filter(p => p !== primary)];
}
```

### Задача P1-3: Cost Tracking

**Добавить в `prisma/schema.prisma`:**
```prisma
model AIRunCost {
  id           String   @id @default(cuid())
  runId        String?
  agentId      String?
  provider     String
  model        String
  inputTokens  Int      @default(0)
  outputTokens Int      @default(0)
  costRub      Decimal  @default(0) @db.Decimal(10, 4)
  latencyMs    Int      @default(0)
  workspaceId  String?
  success      Boolean  @default(true)
  errorCode    String?
  createdAt    DateTime @default(now())

  @@index([provider, createdAt])
  @@index([agentId, createdAt])
  @@index([workspaceId, createdAt])
}
```

**Создать `lib/ai/cost-tracker.ts`:**
```typescript
// Стоимости токенов в рублях (обновлять периодически)
const TOKEN_COSTS_RUB: Record<string, { input: number; output: number }> = {
  "gigachat-pro":     { input: 0.0003, output: 0.0006 },
  "yandexgpt":        { input: 0.0002, output: 0.0004 },
  "gpt-5.2":          { input: 0.0045, output: 0.0135 },
  "gpt-4o-mini":      { input: 0.00015, output: 0.0006 },
  "gemma-3-27b:free": { input: 0, output: 0 },
};

export async function logAIRunCost(params: {
  runId?: string;
  agentId?: string;
  workspaceId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  success: boolean;
  errorCode?: string;
}): Promise<void> {
  const costs = TOKEN_COSTS_RUB[params.model] ?? { input: 0.001, output: 0.002 };
  const costRub = params.inputTokens * costs.input + params.outputTokens * costs.output;

  await prisma.aIRunCost.create({
    data: { ...params, costRub }
  });
}

export async function getAICostSummary(workspaceId: string, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000);
  return prisma.aIRunCost.groupBy({
    by: ["provider", "agentId"],
    where: { workspaceId, createdAt: { gte: since } },
    _sum: { costRub: true, inputTokens: true, outputTokens: true },
    _avg: { latencyMs: true },
    _count: true,
  });
}
```

**Создать `app/api/admin/ai/costs/route.ts`:**
```typescript
export async function GET(req: NextRequest) {
  const { workspaceId, days } = await authorizeRequest(req);
  const summary = await getAICostSummary(workspaceId, Number(days ?? 30));
  return NextResponse.json(summary);
}
```

### Задача P1-4: Config-Driven Agent Registry

**Создать `config/agents/` директорию. Схема для каждого агента:**

```typescript
// lib/ai/agent-config.ts — Zod schema
export const AgentConfigSchema = z.object({
  id: z.string(),
  kind: z.enum(["analyst", "planner", "reporter", "researcher"]),
  category: z.enum(["auto", "strategic", "planning", "monitoring", "financial", "knowledge", "communication", "special"]),
  icon: z.string(),
  nameKey: z.string(),
  descriptionKey: z.string().optional(),
  accentClass: z.string(),
  recommended: z.boolean().optional(),
  model: z.object({
    primary: z.string(),                    // e.g. "gigachat-pro"
    fallback: z.array(z.string()).optional() // ["yandexgpt", "gpt-4o-mini"]
  }).optional(),
  allowedTools: z.array(z.string()).optional(), // tool names from tools.ts
  systemPromptFile: z.string().optional(),      // path to .md file in prompts/
  memory: z.object({
    enabled: z.boolean().default(false),
    maxHistory: z.number().default(50),
    useEpisodic: z.boolean().default(false),
  }).optional(),
  subagents: z.array(z.string()).optional(),    // IDs of agents this can delegate to
  rateLimit: z.object({
    maxConcurrent: z.number().default(1),
    minIntervalMs: z.number().default(3000),
  }).optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

**Пример файла `config/agents/risk-researcher.json`:**
```json
{
  "id": "risk-researcher",
  "kind": "researcher",
  "category": "monitoring",
  "icon": "⚠️",
  "nameKey": "agent.riskResearcher",
  "descriptionKey": "agent.riskResearcherDescription",
  "accentClass": "border-red-200/80 bg-gradient-to-br from-red-50 to-white dark:border-red-400/20 dark:bg-red-500/10",
  "model": {
    "primary": "gigachat-pro",
    "fallback": ["yandexgpt", "gpt-4o-mini"]
  },
  "allowedTools": ["get_project_summary", "list_tasks", "get_critical_path", "get_budget_summary"],
  "systemPromptFile": "prompts/agents/risk-researcher.md",
  "memory": {
    "enabled": true,
    "maxHistory": 30,
    "useEpisodic": true
  },
  "subagents": []
}
```

**Создать `lib/ai/agent-loader.ts`:**
```typescript
import fs from "fs";
import path from "path";
import { AgentConfigSchema, type AgentConfig } from "./agent-config";

const AGENTS_DIR = path.join(process.cwd(), "config", "agents");

let cachedConfigs: Map<string, AgentConfig> | null = null;

export function loadAgentConfigs(): Map<string, AgentConfig> {
  if (cachedConfigs) return cachedConfigs;

  const configs = new Map<string, AgentConfig>();
  if (!fs.existsSync(AGENTS_DIR)) return configs;

  const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith(".json"));
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), "utf-8"));
    const config = AgentConfigSchema.parse(raw);
    configs.set(config.id, config);
  }

  cachedConfigs = configs;
  return configs;
}

export function getAgentConfig(id: string): AgentConfig | undefined {
  return loadAgentConfigs().get(id);
}

// Обратная совместимость — переиспользовать тип AIAgentDefinition из agents.ts
export function toAgentDefinition(config: AgentConfig): AIAgentDefinition {
  return {
    id: config.id,
    kind: config.kind,
    category: config.category,
    icon: config.icon,
    nameKey: config.nameKey as MessageKey,
    descriptionKey: config.descriptionKey as MessageKey | undefined,
    accentClass: config.accentClass,
    recommended: config.recommended,
  };
}
```

**Обновить `lib/ai/agents.ts`** — добавить загрузку из конфигов, не трогать hardcoded массив:
```typescript
// В конце agents.ts добавить:
export function getEnrichedAgentById(id: string): AIAgentDefinition & AgentConfig | undefined {
  const def = aiAgents.find(a => a.id === id);
  const cfg = getAgentConfig(id);
  if (!def) return undefined;
  return { ...def, ...cfg };
}
```

---

## PHASE 2: AGENT INTELLIGENCE (3-4 недели)
*Цель: Настоящие автономные агенты с памятью, function calling, динамическим планированием*

### Задача P2-1: Agent Memory System

**Добавить в `prisma/schema.prisma`:**
```prisma
model AgentMemory {
  id          String   @id @default(cuid())
  agentId     String
  workspaceId String
  content     String   // текст воспоминания
  embedding   Unsupported("vector(1536)")?  // pgvector
  memoryType  String   @default("short_term") // short_term | long_term | episodic
  sessionId   String?  // для short_term привязка к сессии
  relevance   Float    @default(1.0) // decay coefficient
  metadata    Json?
  expiresAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([agentId, workspaceId, memoryType])
  @@index([agentId, sessionId])
}
```

**Включить pgvector расширение (создать миграцию):**
```sql
-- prisma/migrations/XXXXXX_add_pgvector/migration.sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "AgentMemory" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
CREATE INDEX IF NOT EXISTS agent_memory_embedding_idx 
  ON "AgentMemory" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

**Создать `lib/ai/memory/agent-memory-store.ts`:**
```typescript
import { prisma } from "@/lib/prisma";
import { AIRouter } from "@/lib/ai/providers";

export class AgentMemoryStore {
  constructor(
    private agentId: string,
    private workspaceId: string,
    private router: AIRouter
  ) {}

  // Запомнить (добавить в memory)
  async remember(content: string, type: "short_term" | "long_term" | "episodic" = "short_term", sessionId?: string): Promise<void> {
    const embedding = await this.embed(content);
    const expiresAt = type === "short_term" ? new Date(Date.now() + 3_600_000) : undefined; // 1h TTL for short-term

    await prisma.agentMemory.create({
      data: {
        agentId: this.agentId,
        workspaceId: this.workspaceId,
        content,
        embedding: embedding ? `[${embedding.join(",")}]` : undefined,
        memoryType: type,
        sessionId,
        expiresAt,
      }
    });
  }

  // Вспомнить (semantic search)
  async recall(query: string, topK = 5): Promise<Array<{ content: string; relevance: number }>> {
    const queryEmbedding = await this.embed(query);
    if (!queryEmbedding) {
      // Fallback: recent memories
      const recent = await prisma.agentMemory.findMany({
        where: { agentId: this.agentId, workspaceId: this.workspaceId },
        orderBy: { createdAt: "desc" },
        take: topK
      });
      return recent.map(m => ({ content: m.content, relevance: 1.0 }));
    }

    // pgvector similarity search
    const results = await prisma.$queryRaw<Array<{ content: string; similarity: number }>>`
      SELECT content, 1 - (embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector) AS similarity
      FROM "AgentMemory"
      WHERE "agentId" = ${this.agentId}
        AND "workspaceId" = ${this.workspaceId}
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      ORDER BY embedding <=> ${`[${queryEmbedding.join(",")}]`}::vector
      LIMIT ${topK}
    `;

    return results.map(r => ({ content: r.content, relevance: r.similarity }));
  }

  // Получить короткую историю (последние N записей)
  async getRecentHistory(sessionId: string, limit = 20): Promise<string[]> {
    const records = await prisma.agentMemory.findMany({
      where: { agentId: this.agentId, workspaceId: this.workspaceId, sessionId, memoryType: "short_term" },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return records.map(r => r.content).reverse();
  }

  // Очистить просроченные
  async flushExpired(): Promise<number> {
    const result = await prisma.agentMemory.deleteMany({
      where: { agentId: this.agentId, workspaceId: this.workspaceId, expiresAt: { lt: new Date() } }
    });
    return result.count;
  }

  // Создать эмбеддинг через первый доступный провайдер с embeddings API
  private async embed(text: string): Promise<number[] | null> {
    try {
      // OpenAI text-embedding-3-small
      const provider = this.router.getProvider("openai");
      if (provider && "embed" in provider) {
        return await (provider as any).embed(text);
      }
      return null;
    } catch {
      return null;
    }
  }
}

// Cron job для очистки (добавить в daemon/cron/)
export async function flushExpiredMemories(): Promise<void> {
  await prisma.agentMemory.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
}
```

**Интегрировать память в `lib/ai/context-builder.ts`:**
```typescript
// В функцию buildAIChatContextBundle добавить:
// 1. Получить релевантные воспоминания агента
async function enrichContextWithMemory(
  bundle: AIChatContextBundle,
  agentId: string,
  workspaceId: string,
  userMessage: string,
  router: AIRouter
): Promise<AIChatContextBundle> {
  const memStore = new AgentMemoryStore(agentId, workspaceId, router);
  const memories = await memStore.recall(userMessage, 3);

  if (memories.length === 0) return bundle;

  const memorySection: AIChatContextSection = {
    type: "agent_memory",
    title: "Relevant past context",
    items: memories.map(m => ({
      label: "Past interaction",
      value: m.content,
      relevance: m.relevance
    }))
  };

  return {
    ...bundle,
    sections: [memorySection, ...bundle.sections]
  };
}
```

### Задача P2-2: Agent Executor с Function Calling

**Создать `lib/ai/agent-executor.ts`:**
```typescript
import type { AgentConfig } from "./agent-config";
import type { AIChatContextBundle } from "./types";
import { kernelToolPlane } from "./kernel-tool-plane";
import { getProposalSafetyProfile } from "./safety";
import { AgentMemoryStore } from "./memory/agent-memory-store";
import { aiRouter } from "./providers";

export interface AgentExecutionResult {
  status: "done" | "needs_approval" | "failed";
  output: string;
  toolCalls: Array<{ tool: string; args: unknown; result: unknown }>;
  pendingApprovals?: Array<{ toolName: string; args: unknown; reason: string }>;
  iterations: number;
  costRub?: number;
}

export interface AgentExecutionOptions {
  sessionId?: string;
  workspaceId: string;
  maxIterations?: number;   // default: 3 (reflection loops)
  provider?: string;        // override provider
  signal?: AbortSignal;
}

export class AgentExecutor {
  async run(
    config: AgentConfig,
    input: string,
    context: AIChatContextBundle,
    options: AgentExecutionOptions
  ): Promise<AgentExecutionResult> {
    const { workspaceId, maxIterations = 3, sessionId } = options;
    const memory = new AgentMemoryStore(config.id, workspaceId, aiRouter);

    // 1. Вспомнить релевантный контекст
    const memories = await memory.recall(input, 3);
    const memoryContext = memories.map(m => m.content).join("\n");

    // 2. Получить allowed tools
    const allowedToolNames = config.allowedTools ?? [];
    const tools = kernelToolPlane.getToolDescriptors(allowedToolNames);

    // 3. Построить системный промпт
    const systemPrompt = await this.buildSystemPrompt(config, context, memoryContext);

    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: input },
    ];

    const allToolCalls: AgentExecutionResult["toolCalls"] = [];
    const pendingApprovals: NonNullable<AgentExecutionResult["pendingApprovals"]> = [];

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (options.signal?.aborted) break;

      // 4. Вызвать LLM с function calling
      const provider = aiRouter.getProvider(options.provider ?? config.model?.primary ?? "auto");
      if (!provider) throw new Error(`Provider not found for agent ${config.id}`);

      const response = await provider.chat(messages, {
        tools: tools.length > 0 ? tools : undefined,
      });

      // 5. Если нет tool calls — мы готовы
      if (!response.includes("tool_call:")) {
        // Запомнить взаимодействие
        await memory.remember(`Q: ${input}\nA: ${response}`, "short_term", sessionId);

        return {
          status: "done",
          output: response,
          toolCalls: allToolCalls,
          iterations: iteration + 1,
        };
      }

      // 6. Обработать tool calls
      const toolCallsInResponse = this.extractToolCalls(response);

      for (const call of toolCallsInResponse) {
        // Safety check
        const safety = getProposalSafetyProfile(call.name as any);
        if (safety && !safety.allowAutonomousExecution) {
          pendingApprovals.push({
            toolName: call.name,
            args: call.args,
            reason: `Safety level: ${safety.level}. Requires human approval.`
          });
          continue;
        }

        // Execute tool
        const result = await kernelToolPlane.execute(call);
        allToolCalls.push({ tool: call.name, args: call.args, result });

        // Add result to conversation
        messages.push({
          role: "assistant",
          content: `Tool ${call.name} result: ${JSON.stringify(result)}`
        });
      }

      if (pendingApprovals.length > 0) {
        return {
          status: "needs_approval",
          output: `Agent ${config.id} needs approval for ${pendingApprovals.length} actions`,
          toolCalls: allToolCalls,
          pendingApprovals,
          iterations: iteration + 1,
        };
      }
    }

    // Max iterations reached
    return {
      status: "done",
      output: messages.at(-1)?.content ?? "Agent completed with no output",
      toolCalls: allToolCalls,
      iterations: maxIterations,
    };
  }

  private async buildSystemPrompt(
    config: AgentConfig,
    context: AIChatContextBundle,
    memoryContext: string
  ): Promise<string> {
    const base = context.systemPrompt;
    const memSection = memoryContext
      ? `\n\n## Relevant Past Context\n${memoryContext}`
      : "";
    return `${base}${memSection}\n\nYou are ${config.id}. Use available tools when needed.`;
  }

  private extractToolCalls(response: string): Array<{ name: string; args: unknown }> {
    // TODO: Implement actual tool call extraction based on provider response format
    // OpenAI: response.choices[0].message.tool_calls
    // Для упрощения — парсить JSON-блоки из текста
    const matches = [...response.matchAll(/```tool_call\n([\s\S]*?)\n```/g)];
    return matches.map(m => JSON.parse(m[1]));
  }
}

export const agentExecutor = new AgentExecutor();
```

**Обновить `lib/ai/safety.ts`** — добавить флаг автономного исполнения:
```typescript
// В каждый SafetyProfile добавить:
interface AIProposalSafetyProfile {
  // ... existing fields ...
  allowAutonomousExecution: boolean;  // true только для low-risk tools (query, read-only)
}

// Примеры:
// create_task: allowAutonomousExecution: false (требует одобрения)
// get_project_summary: allowAutonomousExecution: true (read-only, safe)
// list_tasks: allowAutonomousExecution: true
```

### Задача P2-3: Dynamic Planner

**Создать `lib/ai/orchestration/planner.ts`:**
```typescript
import type { AIRunInput, AIChatContextBundle } from "@/lib/ai/types";
import type { AgentConfig } from "@/lib/ai/agent-config";
import { aiRouter } from "@/lib/ai/providers";

export type StepDependency = "sequential" | "parallel" | "conditional";

export interface ExecutionStep {
  id: string;
  agentId: string;
  instruction: string;
  dependsOn: string[];           // step IDs
  runInParallel: boolean;
  condition?: string;            // JS expression evaluated against previous results
  maxRetries: number;
}

export interface ExecutionPlan {
  goal: string;
  steps: ExecutionStep[];
  estimatedAgents: string[];
  estimatedDuration: "fast" | "medium" | "complex";  // для UI
  fallbackToBlueprint?: string;  // если planning fails, используем старый blueprint
  planningConfidence: number;    // 0-1
}

// Сопоставление quick actions → старые blueprints (fallback)
const BLUEPRINT_FALLBACKS: Record<string, string> = {
  "summarize_portfolio": "summarize_portfolio",
  "analyze_project": "analyze_project",
  "suggest_tasks": "suggest_tasks",
  "draft_status_report": "draft_status_report",
  "triage_tasks": "triage_tasks",
};

export async function planExecution(
  input: AIRunInput,
  context: AIChatContextBundle
): Promise<ExecutionPlan> {
  const { agentId, prompt, quickAction } = input;

  // Если явно указан агент (не auto) — простой план
  if (agentId && agentId !== "auto-routing") {
    return buildSingleAgentPlan(agentId, prompt);
  }

  // Попытка LLM-based planning
  try {
    return await llmPlan(prompt, context);
  } catch (err) {
    // Fallback: старые blueprints
    const blueprint = quickAction ? BLUEPRINT_FALLBACKS[quickAction] : undefined;
    return buildBlueprintFallbackPlan(prompt, context, blueprint);
  }
}

async function llmPlan(prompt: string, context: AIChatContextBundle): Promise<ExecutionPlan> {
  const planningPrompt = `
You are a planning agent for a project management AI system.

Available agents:
- portfolio-analyst: Portfolio overview and strategic analysis
- execution-planner: Task planning and execution
- risk-researcher: Risk identification and mitigation
- budget-controller: Budget and financial analysis
- status-reporter: Status reporting and communication
- strategy-advisor: Strategic recommendations
- quality-guardian: Quality assurance
- timeline-optimizer: Schedule optimization
- resource-allocator: Resource planning

Current context:
- Scope: ${context.scope} (${context.projectName ?? "portfolio"})
- Summary: ${context.summary}

User request: "${prompt}"

Respond with a JSON execution plan:
{
  "goal": "...",
  "steps": [
    {
      "id": "step-1",
      "agentId": "...",
      "instruction": "...",
      "dependsOn": [],
      "runInParallel": false,
      "maxRetries": 1
    }
  ],
  "estimatedDuration": "fast|medium|complex",
  "planningConfidence": 0.0-1.0
}

Keep plans simple: 1-3 steps for most requests.
`.trim();

  const response = await aiRouter.chat([{ role: "user", content: planningPrompt }]);
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Planner: no JSON in response");

  const plan = JSON.parse(jsonMatch[0]) as Omit<ExecutionPlan, "estimatedAgents" | "fallbackToBlueprint">;
  return {
    ...plan,
    estimatedAgents: [...new Set(plan.steps.map(s => s.agentId))],
  };
}

function buildSingleAgentPlan(agentId: string, prompt: string): ExecutionPlan {
  return {
    goal: prompt,
    steps: [{ id: "step-1", agentId, instruction: prompt, dependsOn: [], runInParallel: false, maxRetries: 1 }],
    estimatedAgents: [agentId],
    estimatedDuration: "fast",
    planningConfidence: 1.0,
  };
}

function buildBlueprintFallbackPlan(prompt: string, context: AIChatContextBundle, blueprint?: string): ExecutionPlan {
  // Используем старую логику из multi-agent-runtime.ts
  const leaderAgent = blueprint ? getBlueprintLeader(blueprint) : "portfolio-analyst";
  const supportAgents = blueprint ? getBlueprintSupport(blueprint) : [];

  const steps: ExecutionStep[] = [
    ...supportAgents.map((agentId, i) => ({
      id: `support-${i + 1}`,
      agentId,
      instruction: `Provide ${agentId} perspective on: ${prompt}`,
      dependsOn: [],
      runInParallel: true,
      maxRetries: 1,
    })),
    {
      id: "leader",
      agentId: leaderAgent,
      instruction: prompt,
      dependsOn: supportAgents.map((_, i) => `support-${i + 1}`),
      runInParallel: false,
      maxRetries: 1,
    }
  ];

  return {
    goal: prompt,
    steps,
    estimatedAgents: [leaderAgent, ...supportAgents],
    estimatedDuration: supportAgents.length > 0 ? "medium" : "fast",
    fallbackToBlueprint: blueprint,
    planningConfidence: 0.7,
  };
}
```

**Обновить `lib/ai/multi-agent-runtime.ts`:**
```typescript
// Заменить shouldUseCollaborativeRun + buildCollaborativePlan на:
export async function executeRun(input: AIRunInput, context: AIChatContextBundle): Promise<AIRunResult> {
  const plan = await planExecution(input, context);

  if (plan.steps.length === 1) {
    // Одиночный агент
    return executeStep(plan.steps[0], context, {});
  }

  // Мульти-агентное выполнение по плану
  return executeMultiStepPlan(plan, context);
}

async function executeMultiStepPlan(plan: ExecutionPlan, context: AIChatContextBundle): Promise<AIRunResult> {
  const results: Record<string, AIRunResult> = {};

  // Топологическая сортировка + выполнение
  const executed = new Set<string>();

  while (executed.size < plan.steps.length) {
    const ready = plan.steps.filter(s =>
      !executed.has(s.id) &&
      s.dependsOn.every(dep => executed.has(dep))
    );

    if (ready.length === 0) throw new Error("Circular dependency in execution plan");

    const parallel = ready.filter(s => s.runInParallel);
    const sequential = ready.filter(s => !s.runInParallel);

    // Запустить параллельные
    if (parallel.length > 0) {
      const parallelResults = await Promise.all(
        parallel.map(step => executeStep(step, context, results))
      );
      parallel.forEach((step, i) => {
        results[step.id] = parallelResults[i];
        executed.add(step.id);
      });
    }

    // Запустить последовательные
    for (const step of sequential) {
      results[step.id] = await executeStep(step, context, results);
      executed.add(step.id);
    }
  }

  // Последний шаг = финальный результат
  const lastStep = plan.steps.at(-1)!;
  return results[lastStep.id];
}
```

### Задача P2-4: Streaming Responses (SSE)

**Создать `app/api/ai/run/stream/route.ts`:**
```typescript
import { NextRequest } from "next/server";
import { authorizeRequest } from "@/lib/auth/authorize";

export async function POST(req: NextRequest) {
  const { workspaceId, userId } = await authorizeRequest(req);
  const input = await req.json() as AIRunInput;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        send({ type: "start", runId: cuid() });

        // Streaming через провайдер
        const provider = aiRouter.getProvider(input.provider ?? "auto");
        if (provider?.chatStream) {
          for await (const token of provider.chatStream(messages)) {
            send({ type: "token", content: token });
          }
        } else {
          // Fallback: non-streaming
          const result = await aiRouter.chat(messages);
          send({ type: "token", content: result });
        }

        send({ type: "done" });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    }
  });
}
```

**Обновить `contexts/ai-context.tsx`:**
```typescript
// Добавить метод streamPrompt в AIWorkspaceContext
const streamPrompt = async (prompt: string, agentId: string) => {
  setStreamingContent("");
  const response = await fetch("/api/ai/run/stream", {
    method: "POST",
    body: JSON.stringify({ prompt, agentId, workspaceId }),
  });

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const lines = decoder.decode(value).split("\n\n");
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5));
      if (event.type === "token") {
        setStreamingContent(prev => prev + event.content);
      }
    }
  }
};
```

---

## PHASE 3: COMMUNICATION (2-3 недели)
*Цель: Agent-to-Agent communication, WhatsApp, Voice*

### Задача P3-1: Agent Message Bus

**Создать `lib/ai/messaging/agent-bus.ts`:**
```typescript
import { EventEmitter } from "events";
import { prisma } from "@/lib/prisma";

export interface AgentMessage {
  id: string;
  from: string;      // agentId
  to: string;        // agentId или "broadcast"
  type: "request" | "response" | "broadcast" | "event";
  payload: unknown;
  correlationId: string;
  workspaceId: string;
  timestamp: Date;
  ttlMs?: number;
}

type MessageHandler = (msg: AgentMessage) => Promise<void> | void;

class AgentMessageBus extends EventEmitter {
  private subscriptions: Map<string, Set<MessageHandler>> = new Map();
  private pendingRequests: Map<string, { resolve: (msg: AgentMessage) => void; timeout: NodeJS.Timeout }> = new Map();

  // Отправить без ожидания ответа
  async send(msg: Omit<AgentMessage, "id" | "timestamp">): Promise<void> {
    const full: AgentMessage = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };

    // Сохранить в БД для audit trail
    await prisma.agentMessage?.create({ data: {
      id: full.id,
      fromAgentId: full.from,
      toAgentId: full.to,
      type: full.type,
      payload: JSON.stringify(full.payload),
      correlationId: full.correlationId,
      workspaceId: full.workspaceId,
    }}).catch(() => {}); // non-critical

    // Доставить подписчикам
    const handlers = this.subscriptions.get(full.to) ?? new Set();
    for (const handler of handlers) {
      handler(full).catch(err => console.error("AgentBus handler error:", err));
    }

    // Доставить broadcast-подписчикам
    if (full.to !== "broadcast") {
      const broadcastHandlers = this.subscriptions.get("broadcast") ?? new Set();
      for (const handler of broadcastHandlers) {
        handler(full).catch(() => {});
      }
    }
  }

  // Отправить и ждать ответа (request-reply pattern)
  async request(
    msg: Omit<AgentMessage, "id" | "timestamp" | "type">,
    timeoutMs = 30_000
  ): Promise<AgentMessage> {
    return new Promise((resolve, reject) => {
      const full: AgentMessage = {
        ...msg,
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: "request",
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(full.correlationId);
        reject(new Error(`Agent ${msg.to} did not respond within ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(full.correlationId, { resolve, timeout });
      this.send(full);
    });
  }

  // Ответить на запрос
  async reply(originalMsg: AgentMessage, payload: unknown): Promise<void> {
    const pending = this.pendingRequests.get(originalMsg.correlationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(originalMsg.correlationId);
      pending.resolve({
        ...originalMsg,
        id: crypto.randomUUID(),
        from: originalMsg.to,
        to: originalMsg.from,
        type: "response",
        payload,
        timestamp: new Date(),
      });
    }
  }

  // Подписаться на сообщения для агента
  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.subscriptions.has(agentId)) {
      this.subscriptions.set(agentId, new Set());
    }
    this.subscriptions.get(agentId)!.add(handler);

    return () => {
      this.subscriptions.get(agentId)?.delete(handler);
    };
  }

  // Broadcast всем агентам
  async broadcast(from: string, workspaceId: string, payload: unknown): Promise<void> {
    await this.send({
      from,
      to: "broadcast",
      type: "broadcast",
      payload,
      correlationId: crypto.randomUUID(),
      workspaceId,
    });
  }
}

export const agentBus = new AgentMessageBus();
```

**Prisma модель для audit trail:**
```prisma
model AgentMessage {
  id           String   @id @default(cuid())
  fromAgentId  String
  toAgentId    String
  type         String   // request | response | broadcast | event
  payload      String   // JSON
  correlationId String
  workspaceId  String
  createdAt    DateTime @default(now())

  @@index([workspaceId, createdAt])
  @@index([correlationId])
  @@index([fromAgentId, toAgentId])
}
```

### Задача P3-2: WhatsApp Business API

**Установить зависимость:**
```bash
npm install @whatsapp-api-js/core
```

**Создать `lib/connectors/whatsapp-business.ts`:**
```typescript
// Использовать WhatsApp Cloud API (Meta)
// Получить: Phone Number ID, Access Token, Verify Token из Meta Business Dashboard

export interface WhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
  webhookUrl: string;
}

export class WhatsAppBusinessConnector {
  constructor(private config: WhatsAppConfig) {}

  async sendMessage(to: string, text: string): Promise<void> {
    await fetch(`https://graph.facebook.com/v18.0/${this.config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text }
      })
    });
  }

  verifyWebhook(query: URLSearchParams): string | null {
    if (query.get("hub.verify_token") === this.config.verifyToken) {
      return query.get("hub.challenge");
    }
    return null;
  }

  parseIncoming(body: unknown): { from: string; text: string; type: "text" | "audio" | "image" } | null {
    // Parse WhatsApp webhook payload
    const entry = (body as any)?.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    if (!message) return null;

    return {
      from: message.from,
      text: message.text?.body ?? "",
      type: message.type,
    };
  }
}
```

**Создать `app/api/webhooks/whatsapp/route.ts`:**
```typescript
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const challenge = whatsAppConnector.verifyWebhook(url.searchParams);
  if (challenge) return new Response(challenge, { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = whatsAppConnector.parseIncoming(body);
  if (!message) return NextResponse.json({ status: "ignored" });

  // Маршрутизировать к AI через агент-автороутер
  const result = await runAgentForChannel("whatsapp", message.from, message.text);
  await whatsAppConnector.sendMessage(message.from, result.output);

  return NextResponse.json({ status: "ok" });
}
```

**Добавить настройки в `/app/(app)/settings/channels/page.tsx`:**
- Поля: Phone Number ID, Access Token, Verify Token
- Сохранять в Prisma (модель WorkspaceIntegration)
- QR-код для быстрой настройки

### Задача P3-3: Voice Input

**В UI (компонент `components/ai/voice-input.tsx`):**
```tsx
"use client";
import { useState, useRef } from "react";
import { Mic, MicOff, Loader2 } from "lucide-react";

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  language?: string;
}

export function VoiceInput({ onTranscript, language = "ru" }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = e => chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      setLoading(true);
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const formData = new FormData();
      formData.append("audio", blob, "voice.webm");
      formData.append("language", language);

      const res = await fetch("/api/ai/transcribe", { method: "POST", body: formData });
      const { text } = await res.json();
      onTranscript(text);
      setLoading(false);
      stream.getTracks().forEach(t => t.stop());
    };

    recorder.start();
    setRecording(true);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  return (
    <button onClick={recording ? stopRecording : startRecording}
      className={`p-2 rounded-full ${recording ? "bg-red-500 text-white animate-pulse" : "bg-muted hover:bg-muted/80"}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> :
        recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}
```

**Создать `app/api/ai/transcribe/route.ts`:**
```typescript
export async function POST(req: NextRequest) {
  const { workspaceId } = await authorizeRequest(req);
  const formData = await req.formData();
  const audio = formData.get("audio") as Blob;
  const language = formData.get("language") as string ?? "ru";

  // Whisper API
  const whisperForm = new FormData();
  whisperForm.append("file", audio, "voice.webm");
  whisperForm.append("model", "whisper-1");
  whisperForm.append("language", language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
    body: whisperForm,
  });

  const { text } = await res.json();
  return NextResponse.json({ text });
}
```

---

## PHASE 4: ADVANCED ORCHESTRATION (4-6 недель)
*Цель: DAG workflows, plugin system, RAG, observability*

### Задача P4-1: DAG Workflow Engine

**Prisma модели:**
```prisma
model WorkflowTemplate {
  id          String   @id @default(cuid())
  name        String
  description String?
  graph       Json     // {nodes: [], edges: []}
  workspaceId String
  createdBy   String
  isPublic    Boolean  @default(false)
  runs        WorkflowRun[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([workspaceId])
}

model WorkflowRun {
  id          String   @id @default(cuid())
  templateId  String?
  template    WorkflowTemplate? @relation(fields: [templateId], references: [id])
  workspaceId String
  status      String   @default("running")  // running | paused | completed | failed
  input       Json
  output      Json?
  error       String?
  checkpoints Json?    // [{stepId, state, timestamp}]
  currentStep String?
  startedAt   DateTime @default(now())
  completedAt DateTime?

  @@index([workspaceId, status])
  @@index([templateId])
}
```

**Создать `lib/ai/workflow/dag-engine.ts`:**
```typescript
export interface WorkflowNode {
  id: string;
  agentId: string;
  label: string;
  tools: string[];
  condition?: string;   // evaluates previous results
  maxRetries: number;
  timeoutMs: number;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  condition?: string;   // "result.status === 'done'"
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export class DAGWorkflowEngine {
  async run(graph: WorkflowGraph, input: unknown, workspaceId: string): Promise<WorkflowRunResult> {
    // Создать WorkflowRun в БД
    const run = await prisma.workflowRun.create({
      data: { workspaceId, status: "running", input: input as any, checkpoints: [] }
    });

    try {
      const result = await this.executeGraph(graph, input, run.id, workspaceId);
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: "completed", output: result as any, completedAt: new Date() }
      });
      return { runId: run.id, status: "completed", output: result };
    } catch (err) {
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: "failed", error: (err as Error).message }
      });
      throw err;
    }
  }

  async rollback(runId: string, toStepId: string): Promise<void> {
    const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    const checkpoints = (run.checkpoints as any[]) ?? [];
    const checkpoint = checkpoints.find(c => c.stepId === toStepId);
    if (!checkpoint) throw new Error(`Checkpoint for step ${toStepId} not found`);

    await prisma.workflowRun.update({
      where: { id: runId },
      data: { status: "running", currentStep: toStepId }
    });
    // Continue execution from checkpoint
  }

  private async executeGraph(graph: WorkflowGraph, input: unknown, runId: string, workspaceId: string) {
    const results: Record<string, unknown> = { input };
    const executed = new Set<string>();
    const startNodes = graph.nodes.filter(n =>
      !graph.edges.some(e => e.to === n.id)
    );

    const executeNode = async (node: WorkflowNode): Promise<void> => {
      if (executed.has(node.id)) return;

      // Wait for dependencies
      const deps = graph.edges.filter(e => e.to === node.id).map(e => e.from);
      for (const dep of deps) {
        const depNode = graph.nodes.find(n => n.id === dep)!;
        await executeNode(depNode);
      }

      // Check conditions
      if (node.condition) {
        const condResult = new Function("results", `return ${node.condition}`)(results);
        if (!condResult) { executed.add(node.id); return; }
      }

      // Save checkpoint before execution
      await this.saveCheckpoint(runId, node.id, results);

      // Execute agent
      const config = getAgentConfig(node.agentId);
      if (!config) throw new Error(`Agent ${node.agentId} not found`);

      const agentResult = await agentExecutor.run(
        config,
        String(results[deps[0]] ?? input),
        {} as any, // context
        { workspaceId, maxIterations: node.maxRetries }
      );

      results[node.id] = agentResult.output;
      executed.add(node.id);
    };

    await Promise.all(startNodes.map(executeNode));
    return results;
  }

  private async saveCheckpoint(runId: string, stepId: string, state: unknown): Promise<void> {
    const run = await prisma.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    const checkpoints = [(run.checkpoints as any[]) ?? [], { stepId, state, timestamp: new Date() }].flat();
    await prisma.workflowRun.update({
      where: { id: runId },
      data: { checkpoints: checkpoints as any, currentStep: stepId }
    });
  }
}

export const dagEngine = new DAGWorkflowEngine();
```

### Задача P4-2: Plugin System

**Создать `lib/ai/plugins/plugin-registry.ts`:**
```typescript
import { z } from "zod";
import type { AIToolDefinition } from "@/lib/ai/tools";

export const PluginSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()),
  })),
  execute: z.function().optional(), // runtime loaded
});

export type AIPlugin = z.infer<typeof PluginSchema> & {
  execute: (toolName: string, args: unknown) => Promise<unknown>;
};

class PluginRegistry {
  private plugins: Map<string, AIPlugin> = new Map();

  register(plugin: AIPlugin): void {
    // Проверить нет ли конфликта имён tools
    for (const tool of plugin.tools) {
      if (this.findPluginByTool(tool.name)) {
        throw new Error(`Tool '${tool.name}' already registered by another plugin`);
      }
    }
    this.plugins.set(plugin.id, plugin);
  }

  async executePluginTool(toolName: string, args: unknown): Promise<unknown> {
    const plugin = this.findPluginByTool(toolName);
    if (!plugin) throw new Error(`No plugin found for tool: ${toolName}`);
    return plugin.execute(toolName, args);
  }

  getAllTools(): AIToolDefinition[] {
    return [...this.plugins.values()].flatMap(p => p.tools.map(t => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.parameters }
    })));
  }

  private findPluginByTool(toolName: string): AIPlugin | undefined {
    return [...this.plugins.values()].find(p => p.tools.some(t => t.name === toolName));
  }
}

export const pluginRegistry = new PluginRegistry();

// Пример встроенного плагина:
pluginRegistry.register({
  id: "core-pm",
  name: "Core PM Tools",
  version: "1.0.0",
  description: "Built-in PM tools (tasks, risks, budgets)",
  tools: [], // загрузить из tools.ts
  execute: async (toolName, args) => {
    return kernelToolPlane.execute({ name: toolName, args } as any);
  }
});
```

### Задача P4-3: RAG (Retrieval-Augmented Generation)

**Prisma модели:**
```prisma
model ProjectDocument {
  id          String   @id @default(cuid())
  projectId   String?
  workspaceId String
  title       String
  content     String
  contentHash String   // MD5 hash для дедупликации
  embedding   Unsupported("vector(1536)")?
  sourceType  String   @default("upload") // upload | report | email | meeting_notes
  sourceRef   String?  // ссылка на исходный документ
  indexedAt   DateTime @default(now())
  createdAt   DateTime @default(now())

  @@index([workspaceId, projectId])
  @@unique([workspaceId, contentHash])
}
```

**Создать `lib/ai/rag/document-indexer.ts`:**
```typescript
export class DocumentIndexer {
  async index(params: {
    workspaceId: string;
    projectId?: string;
    title: string;
    content: string;
    sourceType: string;
    sourceRef?: string;
  }): Promise<void> {
    // Чанкинг текста (512 токенов с overlap 50)
    const chunks = this.chunkText(params.content, 512, 50);

    for (const chunk of chunks) {
      const hash = this.md5(chunk);
      const embedding = await this.embedText(chunk);

      await prisma.projectDocument.upsert({
        where: { workspaceId_contentHash: { workspaceId: params.workspaceId, contentHash: hash } },
        create: {
          ...params,
          content: chunk,
          contentHash: hash,
          embedding: embedding ? `[${embedding.join(",")}]` : undefined,
        },
        update: { indexedAt: new Date() },
      });
    }
  }

  async search(query: string, workspaceId: string, projectId?: string, topK = 5): Promise<Array<{ content: string; title: string; similarity: number }>> {
    const embedding = await this.embedText(query);
    if (!embedding) return [];

    return prisma.$queryRaw`
      SELECT title, content, 1 - (embedding <=> ${`[${embedding.join(",")}]`}::vector) AS similarity
      FROM "ProjectDocument"
      WHERE "workspaceId" = ${workspaceId}
        ${projectId ? Prisma.sql`AND "projectId" = ${projectId}` : Prisma.empty}
      ORDER BY embedding <=> ${`[${embedding.join(",")}]`}::vector
      LIMIT ${topK}
    `;
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    const words = text.split(" ");
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      chunks.push(words.slice(i, i + chunkSize).join(" "));
      if (i + chunkSize >= words.length) break;
    }
    return chunks;
  }
}
```

### Задача P4-4: Observability Dashboard

**Создать `app/(app)/admin/ai-dashboard/page.tsx`:**
```tsx
// Компоненты для dashboard:
// 1. AIRunsOverTimeChart — recharts LineChart (runs per day)
// 2. CostByProviderChart — BarChart (рубли per provider за 30 дней)
// 3. LatencyTable — таблица p50/p95/p99 per agent
// 4. ErrorRateByProvider — BarChart (error%)
// 5. AgentUsagePie — PieChart (какой агент вызывается чаще)
// 6. EvidenceGroundingScore — средний confidence из Evidence Ledger
```

**Создать `app/api/admin/ai/metrics/route.ts`:**
```typescript
export async function GET(req: NextRequest) {
  const { workspaceId } = await authorizeRequest(req);
  const days = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const since = new Date(Date.now() - days * 86_400_000);

  const [costByProvider, latencyByAgent, errorRate, agentUsage] = await Promise.all([
    prisma.aIRunCost.groupBy({
      by: ["provider"],
      where: { workspaceId, createdAt: { gte: since } },
      _sum: { costRub: true },
    }),
    prisma.aIRunCost.groupBy({
      by: ["agentId"],
      where: { workspaceId, createdAt: { gte: since } },
      _avg: { latencyMs: true },
      _count: true,
    }),
    prisma.aIRunCost.groupBy({
      by: ["provider"],
      where: { workspaceId, createdAt: { gte: since }, success: false },
      _count: true,
    }),
    prisma.aIRunCost.groupBy({
      by: ["agentId"],
      where: { workspaceId, createdAt: { gte: since } },
      _count: true,
      orderBy: { _count: { agentId: "desc" } },
      take: 10,
    })
  ]);

  return NextResponse.json({ costByProvider, latencyByAgent, errorRate, agentUsage });
}
```

---

## PHASE 5: WORLD-CLASS FEATURES (ongoing)

### Задача P5-1: Agent Self-Reflection
После каждого run добавить reflection step через отдельный LLM-вызов. Prompt:
```
You just completed this task:
INPUT: {userPrompt}
YOUR OUTPUT: {agentOutput}
TOOLS USED: {toolCalls}
EVIDENCE USED: {evidenceCount} records

Evaluate your response:
1. Quality score (1-10)
2. What you did well
3. What you missed or could improve
4. Confidence in the proposal

Respond as JSON: {"score": N, "strengths": [], "improvements": [], "confidence": 0.0-1.0}
```
Сохранить reflection в AgentMemory (episodic). Если score < 7 — переиграть с учётом feedback.

### Задача P5-2: Offline Mode (Ollama)
```typescript
// lib/ai/providers/ollama.ts
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly baseUrl = "http://localhost:11434";

  async chat(messages, options) {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: options?.model ?? "llama3.2:3b",
        messages,
        stream: false,
      })
    });
    const data = await res.json();
    return data.message.content;
  }

  async isAvailable(): Promise<boolean> {
    try {
      await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch { return false; }
  }
}
```

### Задача P5-3: MCP Server
```typescript
// mcp-server/index.ts — Model Context Protocol server
// Протокол: JSON-RPC 2.0 через stdin/stdout

const tools = {
  get_projects: async () => prisma.project.findMany({ where: { workspace... } }),
  get_tasks: async ({ projectId }) => prisma.task.findMany({ where: { projectId } }),
  create_task: async (args) => prisma.task.create({ data: args }),
  run_agent: async ({ agentId, prompt }) => agentExecutor.run(getAgentConfig(agentId), prompt, ...),
};

process.stdin.on("data", async (chunk) => {
  const req = JSON.parse(chunk.toString());
  const result = await tools[req.method]?.(req.params) ?? { error: "Unknown method" };
  process.stdout.write(JSON.stringify({ id: req.id, result }) + "\n");
});
```

---

## ТРЕБОВАНИЯ ДЛЯ КАЖДОЙ ЗАДАЧИ (для AI-модели)

При реализации каждой задачи ОБЯЗАТЕЛЬНО:

1. **Запустить тесты до изменений**: `npm run test:run` — зафиксировать baseline
2. **TypeScript**: все новые файлы с `"strict": true`, без `any` без комментария
3. **Обратная совместимость**: не менять публичные интерфейсы, только расширять
4. **Импорты**: использовать path aliases (`@/lib/...`), не относительные пути
5. **Prisma**: после изменения schema выполнить `npx prisma generate && npx prisma migrate dev`
6. **Тесты после изменений**: 132/132 должны проходить
7. **Логирование**: использовать существующий `lib/logger.ts`, не `console.log`
8. **Error handling**: все async функции должны иметь try/catch
9. **Environment variables**: новые секреты добавлять в `.env.example` с комментарием

### Порядок реализации задач (dependency graph)
```
P0-freeze → P0-baseline
              ↓
P1-split-providers → P1-circuit-breaker → P2-agent-executor
                   → P1-cost-tracking   → P4-observability
P0-baseline → P1-config-agents → P2-agent-memory → P2-agent-executor
                               → P4-rag
                               → P4-plugin-system → P5-mcp-server

P2-agent-executor → P2-dynamic-planner → P4-dag-engine
P2-agent-executor → P2-streaming
P2-agent-executor → P3-agent-bus → P3-whatsapp
P1-split-providers → P3-voice

P4-dag-engine → P5-visual-editor
P2-agent-executor + P2-agent-memory → P5-reflection
P1-circuit-breaker → P5-offline
```

---

## KPI ИТОГОВОГО РЕЗУЛЬТАТА

После реализации всех фаз CEOClaw должен достигать:

| Метрика | Сейчас | Цель |
|---------|--------|------|
| Автономность агентов | 1/5 | 5/5 |
| Agent memory depth | 0 | Short + Long + Episodic |
| Orchestration patterns | 5 hardcoded | Dynamic DAG |
| Cross-provider fallback | ❌ | ✅ Circuit breaker |
| Messaging channels | 2 | 5+ (добавить WhatsApp, Voice) |
| Tool extensibility | 13 hardcoded | Plugin system (∞) |
| Observability | Correlation IDs | Full dashboard |
| Cost visibility | ❌ | Per-agent/per-run в рублях |
| RAG | ❌ | pgvector + document indexing |
| Offline capability | ❌ | Ollama fallback |
| Сравнение с рынком | 2.9/5 | **4.8/5** |

**Уникальное позиционирование после реализации:**
> *CEOClaw = единственная PM-specific multi-agent platform в мире с:*
> *Evidence Ledger + Safety Profiles + True Agent Autonomy + Russian LLMs + DAG Orchestration + PM Domain*

---

*Документ: `ceoclaw-dev/docs/IMPLEMENTATION_PLAN_WORLD_CLASS_CORE.md`*
*Версия: 1.0 | 2026-03-26*

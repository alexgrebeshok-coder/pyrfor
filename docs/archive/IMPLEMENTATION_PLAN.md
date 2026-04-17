# CEOClaw Backend — Детальный план реализации

**Старт:** 2026-03-14
**Цель:** Автономный CEOClaw с AI-архитектурой OpenClaw
**Срок:** 9 дней

---

## 📋 ЭТАП 1: Database Foundation (День 1)

### Чек-лист:
- [ ] 1.1 Обновить `prisma/schema.prisma`
- [ ] 1.2 Создать миграцию
- [ ] 1.3 Сгенерировать Prisma Client
- [ ] 1.4 Протестировать подключение

---

### 1.1 Обновить Prisma Schema

**Файл:** `prisma/schema.prisma`

**Что добавить:**
```prisma
// ============================================
// MEMORY SYSTEM (OpenClaw-style)
// ============================================

model Memory {
  id          String   @id @default(cuid())
  type        String   // "long_term" | "episodic" | "procedural"
  category    String   // "project" | "contact" | "skill" | "fact" | "chat"
  key         String   // "ЧЭМК" | "Саша" | "weather"
  value       Json     // { content: "...", metadata: {...} }
  validFrom   DateTime @default(now())
  validUntil  DateTime?
  confidence  Float    @default(1.0)
  source      String   @default("user") // "user" | "research" | "analysis"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([type, category])
  @@index([key])
}

// ============================================
// AGENT SYSTEM
// ============================================

model AgentSession {
  id          String   @id @default(cuid())
  agentId     String   // "main" | "main-worker" | "quick-research" | ...
  status      String   @default("idle") // "idle" | "running" | "completed" | "failed"
  task        String?  @db.Text
  result      Json?
  model       String?  // "glm-5" | "gemini-3.1-lite"
  provider    String?  // "zai" | "openrouter" | "openai"
  tokens      Int      @default(0)
  cost        Float    @default(0)
  startedAt   DateTime?
  endedAt     DateTime?
  createdAt   DateTime @default(now())

  @@index([agentId, status])
  @@index([createdAt])
}

// ============================================
// SKILLS SYSTEM
// ============================================

model Skill {
  id          String   @id @default(cuid())
  name        String   @unique // "weather" | "deep-research" | "decision-council"
  category    String   // "analysis" | "automation" | "research" | "creative"
  description String   @db.Text
  prompt      String   @db.Text // System prompt for skill
  enabled     Boolean  @default(true)
  triggers    Json?    // ["погода", "weather", "температура"]
  config      Json?    // Additional config
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([category, enabled])
}

// ============================================
// COMMUNICATION LOGS
// ============================================

model Communication {
  id          String   @id @default(cuid())
  channel     String   // "telegram" | "voice" | "chat" | "email"
  direction   String   // "inbound" | "outbound"
  message     String   @db.Text
  response    String?  @db.Text
  metadata    Json?    // { from: "...", chatId: "...", ... }
  createdAt   DateTime @default(now())

  @@index([channel, createdAt])
}

// ============================================
// AI PROVIDER CONFIG
// ============================================

model AIProvider {
  id          String   @id @default(cuid())
  name        String   @unique // "openrouter" | "zai" | "openai"
  apiKey      String   // Encrypted
  baseUrl     String?
  enabled     Boolean  @default(true)
  models      Json     // ["glm-5", "glm-4.7-flash"]
  defaultModel String?
  priority    Int      @default(0) // For fallback
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([enabled, priority])
}

// ============================================
// CONTEXT SNAPSHOT
// ============================================

model ContextSnapshot {
  id          String   @id @default(cuid())
  type        String   // "project" | "full" | "daily"
  projectId   String?
  data        Json     // Full context snapshot
  tokens      Int      @default(0)
  createdAt   DateTime @default(now())

  @@index([type, createdAt])
}
```

**Команда:**
```bash
cd ~/ceoclaw-dev
# Добавить модели в prisma/schema.prisma
```

---

### 1.2 Создать миграцию

**Команда:**
```bash
cd ~/ceoclaw-dev
npx prisma migrate dev --name add_ai_backend_systems
```

**Ожидаемый результат:**
```
Applying migration `20260314130000_add_ai_backend_systems`
✔ Generated Prisma Client
```

---

### 1.3 Сгенерировать Prisma Client

**Команда:**
```bash
cd ~/ceoclaw-dev
npx prisma generate
```

**Ожидаемый результат:**
```
✔ Generated Prisma Client in ./node_modules/@prisma/client
```

---

### 1.4 Протестировать подключение

**Файл:** `scripts/test-db.ts`

```typescript
import { prisma } from '../lib/prisma';

async function test() {
  // Test Memory
  const memory = await prisma.memory.create({
    data: {
      type: 'long_term',
      category: 'test',
      key: 'test-key',
      value: { content: 'Test memory' },
    },
  });
  console.log('✅ Memory created:', memory.id);

  // Test AgentSession
  const session = await prisma.agentSession.create({
    data: {
      agentId: 'test-agent',
      task: 'Test task',
      model: 'test-model',
      provider: 'test-provider',
    },
  });
  console.log('✅ AgentSession created:', session.id);

  // Test Skill
  const skill = await prisma.skill.create({
    data: {
      name: 'test-skill',
      category: 'test',
      description: 'Test skill',
      prompt: 'Test prompt',
    },
  });
  console.log('✅ Skill created:', skill.id);

  // Cleanup
  await prisma.memory.delete({ where: { id: memory.id } });
  await prisma.agentSession.delete({ where: { id: session.id } });
  await prisma.skill.delete({ where: { id: skill.id } });
  console.log('✅ All tests passed!');

  await prisma.$disconnect();
}

test().catch(console.error);
```

**Команда:**
```bash
cd ~/ceoclaw-dev
npx tsx scripts/test-db.ts
```

---

## 📋 ЭТАП 2: AI Provider System (День 2)

### Чек-лист:
- [ ] 2.1 Создать `lib/ai/types.ts`
- [ ] 2.2 Создать `lib/ai/providers/openrouter.ts`
- [ ] 2.3 Создать `lib/ai/providers/zai.ts`
- [ ] 2.4 Создать `lib/ai/router.ts`
- [ ] 2.5 Создать `app/api/ai/test/route.ts`
- [ ] 2.6 Протестировать оба провайдера

---

### 2.1 Создать AI Types

**Файл:** `lib/ai/types.ts`

```typescript
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AIProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  stream?(messages: Message[], options?: ChatOptions): AsyncIterable<string>;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
}
```

---

### 2.2 Создать OpenRouter Provider

**Файл:** `lib/ai/providers/openrouter.ts`

```typescript
import { AIProvider, Message, ChatOptions } from '../types';

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models = [
    'google/gemini-3.1-flash-lite-preview',
    'deepseek/deepseek-r1:free',
    'qwen/qwen3-coder:free',
  ];

  private apiKey: string;
  private baseUrl = 'https://openrouter.ai/api/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ceoclaw.com',
        'X-Title': 'CEOClaw',
      },
      body: JSON.stringify({
        model: options?.model || this.models[0],
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}
```

---

### 2.3 Создать ZAI Provider

**Файл:** `lib/ai/providers/zai.ts`

```typescript
import { AIProvider, Message, ChatOptions } from '../types';

export class ZAIProvider implements AIProvider {
  name = 'zai';
  models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];

  private apiKey: string;
  private baseUrl = 'https://api.zukijourney.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'glm-5',
        messages,
        temperature: options?.temperature || 0.7,
        max_tokens: options?.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      throw new Error(`ZAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}
```

---

### 2.4 Создать AI Router

**Файл:** `lib/ai/router.ts`

```typescript
import { AIProvider, Message, ChatOptions } from './types';
import { OpenRouterProvider } from './providers/openrouter';
import { ZAIProvider } from './providers/zai';
import { prisma } from '@/lib/prisma';

export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  private defaultProvider = 'openrouter';

  constructor() {
    this.initializeProviders();
  }

  private async initializeProviders() {
    // Load from database
    const configs = await prisma.aIProvider.findMany({
      where: { enabled: true },
      orderBy: { priority: 'asc' },
    });

    for (const config of configs) {
      if (config.name === 'openrouter') {
        this.providers.set('openrouter', new OpenRouterProvider(config.apiKey));
      } else if (config.name === 'zai') {
        this.providers.set('zai', new ZAIProvider(config.apiKey));
      }

      if (config.priority === 0) {
        this.defaultProvider = config.name;
      }
    }
  }

  async chat(
    messages: Message[],
    options: { provider?: string; model?: string } = {}
  ): Promise<string> {
    const providerName = options.provider || this.defaultProvider;
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    return provider.chat(messages, options);
  }

  getAvailableModels() {
    const models: { provider: string; model: string }[] = [];

    for (const [name, provider] of this.providers) {
      for (const model of provider.models) {
        models.push({ provider: name, model });
      }
    }

    return models;
  }
}
```

---

### 2.5 Создать Test Endpoint

**Файл:** `app/api/ai/test/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { AIRouter } from '@/lib/ai/router';

export async function POST(req: NextRequest) {
  try {
    const { provider, message } = await req.json();

    const router = new AIRouter();
    const response = await router.chat(
      [{ role: 'user', content: message || 'Hello!' }],
      { provider }
    );

    return NextResponse.json({
      success: true,
      provider,
      response,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
```

---

### 2.6 Протестировать провайдеры

**Команда:**
```bash
# Test OpenRouter
curl -X POST http://localhost:3000/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "openrouter", "message": "Hello!"}'

# Test ZAI
curl -X POST http://localhost:3000/api/ai/test \
  -H "Content-Type: application/json" \
  -d '{"provider": "zai", "message": "Привет!"}'
```

---

## 📋 ЭТАП 3: Memory System (День 3)

### Чек-лист:
- [ ] 3.1 Создать `lib/memory/manager.ts`
- [ ] 3.2 Создать `lib/memory/context-builder.ts`
- [ ] 3.3 Создать `app/api/memory/route.ts`
- [ ] 3.4 Протестировать CRUD операции
- [ ] 3.5 Протестировать context builder

---

### 3.1 Создать Memory Manager

**Файл:** `lib/memory/manager.ts`

```typescript
import { prisma } from '@/lib/prisma';

export class MemoryManager {
  // Получить долгосрочную память (аналог MEMORY.md)
  async getLongTerm(category?: string) {
    return prisma.memory.findMany({
      where: {
        type: 'long_term',
        ...(category && { category }),
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  // Получить эпизодическую память (аналог daily notes)
  async getEpisodic(date?: Date) {
    const targetDate = date || new Date();
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    return prisma.memory.findMany({
      where: {
        type: 'episodic',
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Добавить запись
  async remember(data: {
    type: 'long_term' | 'episodic' | 'procedural';
    category: string;
    key: string;
    value: any;
    validUntil?: Date;
    confidence?: number;
    source?: string;
  }) {
    return prisma.memory.create({
      data: {
        ...data,
        value: JSON.parse(JSON.stringify(data.value)),
        confidence: data.confidence || 1.0,
        source: data.source || 'user',
      },
    });
  }

  // Обновить запись
  async update(id: string, data: Partial<{
    value: any;
    validUntil: Date;
    confidence: number;
  }>) {
    return prisma.memory.update({
      where: { id },
      data: {
        ...data,
        ...(data.value && { value: JSON.parse(JSON.stringify(data.value)) }),
      },
    });
  }

  // Забыть
  async forget(id: string) {
    return prisma.memory.delete({ where: { id } });
  }

  // Проверить валидность
  async checkValidity() {
    const now = new Date();
    return prisma.memory.findMany({
      where: {
        validUntil: { lt: now },
      },
    });
  }

  // Поиск по ключу
  async search(query: string) {
    return prisma.memory.findMany({
      where: {
        OR: [
          { key: { contains: query } },
          { category: { contains: query } },
        ],
      },
      take: 20,
    });
  }
}
```

---

### 3.2 Создать Context Builder

**Файл:** `lib/memory/context-builder.ts`

```typescript
import { MemoryManager } from './manager';
import { prisma } from '@/lib/prisma';

export class ContextBuilder {
  constructor(private memory: MemoryManager) {}

  // Собрать контекст для AI
  async buildForAI(projectId?: string) {
    const [longTerm, episodic, projects] = await Promise.all([
      this.memory.getLongTerm(),
      this.memory.getEpisodic(),
      projectId ? this.getProjectContext(projectId) : null,
    ]);

    return {
      memory: {
        longTerm: longTerm.slice(0, 20), // Топ-20 долгосрочных
        recent: episodic.slice(0, 10),   // Последние 10 записей
      },
      projects,
      timestamp: new Date().toISOString(),
    };
  }

  // Получить контекст проекта
  private async getProjectContext(projectId: string) {
    const [project, tasks, risks] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId } }),
      prisma.task.findMany({ where: { projectId }, take: 20 }),
      prisma.risk.findMany({ where: { projectId }, take: 10 }),
    ]);

    return { project, tasks, risks };
  }

  // Сжать контекст (compact)
  async compact() {
    const longTerm = await this.memory.getLongTerm();
    const recent = await this.memory.getEpisodic();

    // Summary format (как в OpenClaw)
    return {
      summary: {
        totalMemories: longTerm.length + recent.length,
        categories: [...new Set(longTerm.map(m => m.category))],
        lastUpdate: new Date().toISOString(),
      },
      key: longTerm.slice(0, 5).map(m => ({
        category: m.category,
        key: m.key,
        preview: JSON.stringify(m.value).slice(0, 100),
      })),
    };
  }
}
```

---

### 3.3 Создать Memory API

**Файл:** `app/api/memory/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { MemoryManager } from '@/lib/memory/manager';
import { ContextBuilder } from '@/lib/memory/context-builder';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') as 'long_term' | 'episodic';
  const category = searchParams.get('category');
  const query = searchParams.get('q');

  const memory = new MemoryManager();

  if (query) {
    const items = await memory.search(query);
    return NextResponse.json({ items });
  }

  if (type === 'long_term') {
    const items = await memory.getLongTerm(category || undefined);
    return NextResponse.json({ items });
  } else if (type === 'episodic') {
    const items = await memory.getEpisodic();
    return NextResponse.json({ items });
  }

  // Return context
  const builder = new ContextBuilder(memory);
  const context = await builder.buildForAI();
  return NextResponse.json({ context });
}

export async function POST(req: NextRequest) {
  const data = await req.json();

  const memory = new MemoryManager();
  const item = await memory.remember(data);

  return NextResponse.json({ item });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();

  const memory = new MemoryManager();
  await memory.forget(id);

  return NextResponse.json({ success: true });
}
```

---

### 3.4 Протестировать Memory CRUD

**Команда:**
```bash
# Create memory
curl -X POST http://localhost:3000/api/memory \
  -H "Content-Type: application/json" \
  -d '{
    "type": "long_term",
    "category": "project",
    "key": "ЧЭМК",
    "value": {"content": "Проект по переработке дунита в Харпе"}
  }'

# Get memory
curl "http://localhost:3000/api/memory?type=long_term"

# Search memory
curl "http://localhost:3000/api/memory?q=ЧЭМК"
```

---

### 3.5 Протестировать Context Builder

**Команда:**
```bash
# Get full context
curl "http://localhost:3000/api/memory"
```

---

## 📊 Следующие этапы (Дни 4-9)

### День 4: Agent System
- Base Agent class
- 7 agents (main, worker, research, coder, writer, planner, reviewer)
- Agent Orchestrator

### День 5: Agent API Endpoints
- `/api/agents/execute`
- `/api/agents/status`
- Session logging

### День 6: AI Chat Widget (Frontend)
- Chat component
- Integration with Dashboard

### День 7: AI Settings (Frontend)
- Provider configuration UI
- API key management

### День 8: Skills System
- Skill Runner
- 3 skills (weather, research, evaluation)

### День 9: QA Agent
- Diff analyzer
- Browser testing
- Health score

---

## ✅ Proof of Work (после каждого этапа)

После завершения каждого этапа:
1. ✅ Записать результаты в `memory/2026-03-14.md`
2. ✅ Создать git commit
3. ✅ Показать proof (output команд)

---

**Статус:** Готов к запуску ЭТАП 1
**Следующее действие:** 1.1 Обновить `prisma/schema.prisma`

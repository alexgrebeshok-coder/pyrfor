# CEOClaw Backend — План реализации

**Дата:** 2026-03-14
**Цель:** Автономный CEOClaw с AI-архитектурой OpenClaw внутри

---

## 📊 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CEOClaw Platform                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Frontend (Next.js)                                         │
│  ├── Dashboard (Projects, Tasks, Risks, Analytics)         │
│  ├── AI Chat Widget                                        │
│  └── Settings (AI Providers, Memory, Agents)               │
│                                                             │
│  Backend API (Next.js API Routes)                          │
│  ├── /api/ai/* — AI endpoints (chat, insights)            │
│  ├── /api/agents/* — Agent orchestration                   │
│  ├── /api/memory/* — Memory system                         │
│  └── /api/skills/* — Skill execution                       │
│                                                             │
│  Core Services                                              │
│  ├── Agent Orchestrator (7 agents)                         │
│  ├── Memory Manager (SQLite/PostgreSQL)                    │
│  ├── Skill Runner (20+ skills)                             │
│  ├── Provider Router (ZAI, OpenRouter, OpenAI)             │
│  └── Communication Hub (Telegram, Voice)                   │
│                                                             │
│  Database                                                   │
│  ├── SQLite (dev) / PostgreSQL (prod)                      │
│  ├── Tables: projects, tasks, risks, memory, agents        │
│  └── Prisma ORM                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 Phase 1: Backend Foundation (2-3 дня)

### День 1: Database Schema

**Файлы:**
- `prisma/schema.prisma` — обновить схему

**Что добавляем:**
```prisma
// Memory System
model Memory {
  id        String   @id @default(cuid())
  type      String   // "long_term" | "episodic" | "procedural"
  category  String   // "project" | "contact" | "skill" | "fact"
  key       String   // "ЧЭМК" | "Саша" | "weather"
  value     Json     // { content: "...", metadata: {...} }
  validFrom DateTime @default(now())
  validUntil DateTime?
  confidence Float   @default(1.0)
  source    String   @default("user") // "user" | "research" | "analysis"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

// Agent System
model AgentSession {
  id        String   @id @default(cuid())
  agentId   String   // "main" | "main-worker" | "quick-research"
  status    String   @default("idle") // "idle" | "running" | "completed" | "failed"
  task      String?
  result    Json?
  model     String?  // "glm-5" | "gemini-3.1-lite"
  provider  String?  // "zai" | "openrouter"
  tokens    Int      @default(0)
  cost      Float    @default(0)
  startedAt DateTime?
  endedAt   DateTime?
  createdAt DateTime @default(now())
}

// Skills System
model Skill {
  id          String   @id @default(cuid())
  name        String   @unique // "weather" | "deep-research"
  category    String   // "analysis" | "automation" | "research"
  description String
  prompt      String   // System prompt for skill
  enabled     Boolean  @default(true)
  triggers    Json?    // ["погода", "weather"]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Communication Logs
model Communication {
  id        String   @id @default(cuid())
  channel   String   // "telegram" | "voice" | "chat"
  direction String   // "inbound" | "outbound"
  message   String
  response  String?
  metadata  Json?
  createdAt DateTime @default(now())
}
```

**Задачи:**
- [ ] Обновить `prisma/schema.prisma`
- [ ] Создать миграцию: `npx prisma migrate dev --name add_memory_agents`
- [ ] Сгенерировать клиент: `npx prisma generate`

---

### День 2: AI Provider System

**Файлы:**
- `lib/ai/providers.ts` — провайдеры
- `lib/ai/router.ts` — маршрутизация

**Provider Interface:**
```typescript
// lib/ai/providers.ts
export interface AIProvider {
  name: string;
  models: string[];
  chat(messages: Message[], options?: ChatOptions): Promise<string>;
  stream?(messages: Message[], options?: ChatOptions): AsyncIterable<string>;
}

export class OpenRouterProvider implements AIProvider {
  name = 'openrouter';
  models = [
    'google/gemini-3.1-flash-lite-preview',
    'deepseek/deepseek-r1:free',
    'qwen/qwen3-coder:free',
  ];
  
  async chat(messages: Message[], options?: ChatOptions) {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || this.models[0],
        messages,
      }),
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
}

export class ZAIProvider implements AIProvider {
  name = 'zai';
  models = ['glm-5', 'glm-4.7', 'glm-4.7-flash'];
  
  async chat(messages: Message[], options?: ChatOptions) {
    const response = await fetch('https://api.zukijourney.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ZAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options?.model || 'glm-5',
        messages,
      }),
    });
    
    const data = await response.json();
    return data.choices[0].message.content;
  }
}
```

**Router:**
```typescript
// lib/ai/router.ts
export class AIRouter {
  private providers: Map<string, AIProvider> = new Map();
  
  constructor() {
    this.providers.set('openrouter', new OpenRouterProvider());
    this.providers.set('zai', new ZAIProvider());
  }
  
  async chat(
    messages: Message[],
    options: { provider?: string; model?: string } = {}
  ) {
    const providerName = options.provider || 'openrouter';
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

**Задачи:**
- [ ] Создать `lib/ai/providers.ts`
- [ ] Создать `lib/ai/router.ts`
- [ ] Добавить env variables (OPENROUTER_API_KEY, ZAI_API_KEY)
- [ ] Протестировать оба провайдера

---

### День 3: Memory System

**Файлы:**
- `lib/memory/manager.ts` — менеджер памяти
- `lib/memory/context-builder.ts` — сборка контекста

**Memory Manager:**
```typescript
// lib/memory/manager.ts
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
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));
    
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
        value: JSON.stringify(data.value),
        confidence: data.confidence || 1.0,
        source: data.source || 'user',
      },
    });
  }
  
  // Забыть устаревшее
  async forget(id: string) {
    return prisma.memory.delete({ where: { id } });
  }
  
  // Проверить валидность (validity tracking)
  async checkValidity() {
    const now = new Date();
    const expired = await prisma.memory.findMany({
      where: {
        validUntil: { lt: now },
      },
    });
    
    return expired;
  }
}
```

**Context Builder:**
```typescript
// lib/memory/context-builder.ts
export class ContextBuilder {
  constructor(private memory: MemoryManager) {}
  
  // Собрать контекст для AI (как OpenClaw делает перед задачей)
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
  
  private async getProjectContext(projectId: string) {
    // Получить данные проекта
    return {
      project: await prisma.project.findUnique({ where: { id: projectId } }),
      tasks: await prisma.task.findMany({ where: { projectId } }),
      risks: await prisma.risk.findMany({ where: { projectId } }),
    };
  }
}
```

**Задачи:**
- [ ] Создать `lib/memory/manager.ts`
- [ ] Создать `lib/memory/context-builder.ts`
- [ ] Протестировать CRUD операции
- [ ] Протестировать context builder

---

## 🚀 Phase 2: Agent System (2-3 дня)

### День 4: Agent Orchestrator

**Файлы:**
- `lib/agents/orchestrator.ts` — оркестратор
- `lib/agents/base-agent.ts` — базовый класс

**Base Agent:**
```typescript
// lib/agents/base-agent.ts
export abstract class BaseAgent {
  abstract id: string;
  abstract name: string;
  abstract role: string;
  
  protected model: string;
  protected provider: string;
  protected router: AIRouter;
  
  constructor(config: { model: string; provider: string }) {
    this.model = config.model;
    this.provider = config.provider;
    this.router = new AIRouter();
  }
  
  abstract execute(task: string, context?: any): Promise<string>;
  
  protected async chat(messages: Message[]) {
    return this.router.chat(messages, {
      model: this.model,
      provider: this.provider,
    });
  }
}
```

**Agent Implementations:**
```typescript
// lib/agents/main-agent.ts
export class MainAgent extends BaseAgent {
  id = 'main';
  name = 'Main';
  role = 'Оркестратор и коммуникатор';
  
  async execute(task: string, context?: any) {
    const systemPrompt = `Ты Main — оркестратор CEOClaw.
    
Твоя роль:
- Принимать задачи от пользователя
- Делегировать workers
- Не исполнять самому

Приоритеты: скорость → качество → экономия токенов.

Контекст:
${JSON.stringify(context, null, 2)}`;

    return this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task },
    ]);
  }
}

// lib/agents/research-agent.ts
export class ResearchAgent extends BaseAgent {
  id = 'quick-research';
  name = 'Research';
  role = 'Research, web поиск';
  
  constructor() {
    super({ model: 'gemini-3.1-flash-lite-preview', provider: 'openrouter' });
  }
  
  async execute(task: string, context?: any) {
    // Web search + analysis
    const results = await webSearch(task);
    
    return this.chat([
      { role: 'system', content: 'Ты Research Agent. Ищи информацию в интернете и анализируй.' },
      { role: 'user', content: `Найди: ${task}\n\nРезультаты:\n${results}` },
    ]);
  }
}
```

**Orchestrator:**
```typescript
// lib/agents/orchestrator.ts
export class AgentOrchestrator {
  private agents: Map<string, BaseAgent> = new Map();
  
  constructor() {
    this.agents.set('main', new MainAgent());
    this.agents.set('quick-research', new ResearchAgent());
    this.agents.set('main-worker', new WorkerAgent());
    this.agents.set('quick-coder', new CoderAgent());
    this.agents.set('writer', new WriterAgent());
    this.agents.set('planner', new PlannerAgent());
    this.agents.set('main-reviewer', new ReviewerAgent());
  }
  
  async execute(agentId: string, task: string, context?: any) {
    const agent = this.agents.get(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }
    
    // Log session start
    const session = await prisma.agentSession.create({
      data: {
        agentId: agent.id,
        task,
        status: 'running',
        model: (agent as any).model,
        provider: (agent as any).provider,
        startedAt: new Date(),
      },
    });
    
    try {
      const result = await agent.execute(task, context);
      
      // Update session
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: 'completed',
          result: { content: result },
          endedAt: new Date(),
        },
      });
      
      return result;
    } catch (error) {
      await prisma.agentSession.update({
        where: { id: session.id },
        data: {
          status: 'failed',
          result: { error: String(error) },
          endedAt: new Date(),
        },
      });
      
      throw error;
    }
  }
  
  async runParallel(tasks: { agentId: string; task: string }[]) {
    return Promise.all(
      tasks.map(t => this.execute(t.agentId, t.task))
    );
  }
}
```

**Задачи:**
- [ ] Создать `lib/agents/base-agent.ts`
- [ ] Создать 7 агентов (main, worker, research, coder, writer, planner, reviewer)
- [ ] Создать `lib/agents/orchestrator.ts`
- [ ] Протестировать execute и parallel execution

---

### День 5: API Endpoints

**Файлы:**
- `app/api/ai/chat/route.ts`
- `app/api/agents/execute/route.ts`
- `app/api/memory/route.ts`

**AI Chat Endpoint:**
```typescript
// app/api/ai/chat/route.ts
import { AIRouter } from '@/lib/ai/router';
import { ContextBuilder } from '@/lib/memory/context-builder';
import { MemoryManager } from '@/lib/memory/manager';

export async function POST(req: Request) {
  const { message, projectId } = await req.json();
  
  // Build context
  const memory = new MemoryManager();
  const contextBuilder = new ContextBuilder(memory);
  const context = await contextBuilder.buildForAI(projectId);
  
  // Chat with AI
  const router = new AIRouter();
  const response = await router.chat([
    {
      role: 'system',
      content: `Ты CEOClaw AI — ассистент для управления проектами.
      
Контекст:
${JSON.stringify(context, null, 2)}

Отвечай кратко, по делу. Используй данные из контекста.`,
    },
    { role: 'user', content: message },
  ]);
  
  // Save to memory
  await memory.remember({
    type: 'episodic',
    category: 'chat',
    key: `chat-${Date.now()}`,
    value: { user: message, assistant: response },
  });
  
  return Response.json({ response });
}
```

**Agent Execute Endpoint:**
```typescript
// app/api/agents/execute/route.ts
import { AgentOrchestrator } from '@/lib/agents/orchestrator';
import { ContextBuilder } from '@/lib/memory/context-builder';

export async function POST(req: Request) {
  const { agentId, task, projectId } = await req.json();
  
  const orchestrator = new AgentOrchestrator();
  const context = projectId 
    ? await new ContextBuilder(new MemoryManager()).buildForAI(projectId)
    : undefined;
  
  const result = await orchestrator.execute(agentId, task, context);
  
  return Response.json({ result });
}
```

**Memory Endpoint:**
```typescript
// app/api/memory/route.ts
import { MemoryManager } from '@/lib/memory/manager';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') as 'long_term' | 'episodic';
  const category = searchParams.get('category');
  
  const memory = new MemoryManager();
  
  if (type === 'long_term') {
    const items = await memory.getLongTerm(category || undefined);
    return Response.json({ items });
  } else {
    const items = await memory.getEpisodic();
    return Response.json({ items });
  }
}

export async function POST(req: Request) {
  const data = await req.json();
  
  const memory = new MemoryManager();
  const item = await memory.remember(data);
  
  return Response.json({ item });
}
```

**Задачи:**
- [ ] Создать `/api/ai/chat`
- [ ] Создать `/api/agents/execute`
- [ ] Создать `/api/memory`
- [ ] Протестировать через curl

---

## 🎨 Phase 3: Frontend Integration (2-3 дня)

### День 6: AI Chat Widget

**Файлы:**
- `components/ai/chat-widget.tsx`
- `components/ai/chat-message.tsx`

**Chat Widget:**
```typescript
// components/ai/chat-widget.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChatMessage } from './chat-message';

export function AIChatWidget() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  
  async function sendMessage() {
    if (!input.trim()) return;
    
    const userMessage = { role: 'user' as const, content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input }),
      });
      
      const data = await response.json();
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Ошибка: не удалось получить ответ',
      }]);
    } finally {
      setLoading(false);
    }
  }
  
  return (
    <div className="flex flex-col h-[500px] border rounded-lg">
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <ChatMessage key={i} {...msg} />
        ))}
        {loading && <div className="text-muted">Печатает...</div>}
      </div>
      
      <div className="border-t p-4 flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Напишите сообщение..."
          disabled={loading}
        />
        <Button onClick={sendMessage} disabled={loading}>
          Отправить
        </Button>
      </div>
    </div>
  );
}
```

**Задачи:**
- [ ] Создать `components/ai/chat-widget.tsx`
- [ ] Добавить виджет на Dashboard
- [ ] Протестировать real-time chat

---

### День 7: AI Settings Page

**Файлы:**
- `app/settings/ai/page.tsx`

**Settings Page:**
```typescript
// app/settings/ai/page.tsx
'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';

export default function AISettings() {
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [zaiKey, setZaiKey] = useState('');
  const [defaultProvider, setDefaultProvider] = useState('openrouter');
  
  async function saveSettings() {
    await fetch('/api/settings/ai', {
      method: 'POST',
      body: JSON.stringify({
        openrouterKey,
        zaiKey,
        defaultProvider,
      }),
    });
  }
  
  async function testConnection() {
    const response = await fetch('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify({ provider: defaultProvider }),
    });
    
    const data = await response.json();
    alert(data.success ? '✅ Соединение успешно' : '❌ Ошибка');
  }
  
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">AI Провайдеры</h1>
      
      {/* OpenRouter */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">OpenRouter</h2>
        <Input
          type="password"
          placeholder="sk-or-..."
          value={openrouterKey}
          onChange={(e) => setOpenrouterKey(e.target.value)}
        />
        <p className="text-sm text-muted mt-2">
          Модели: Gemini 3.1 Lite, DeepSeek R1 Free, Qwen3 Coder
        </p>
      </Card>
      
      {/* ZAI */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">ZAI (Russian)</h2>
        <Input
          type="password"
          placeholder="zai-..."
          value={zaiKey}
          onChange={(e) => setZaiKey(e.target.value)}
        />
        <p className="text-sm text-muted mt-2">
          Модели: GLM-5, GLM-4.7 Flash
        </p>
      </Card>
      
      {/* Default Provider */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Провайдер по умолчанию</h2>
        <Select value={defaultProvider} onValueChange={setDefaultProvider}>
          <option value="openrouter">OpenRouter (Gemini 3.1 Lite)</option>
          <option value="zai">ZAI (GLM-5)</option>
        </Select>
      </Card>
      
      <div className="flex gap-4">
        <Button onClick={saveSettings}>Сохранить</Button>
        <Button variant="outline" onClick={testConnection}>
          Проверить соединение
        </Button>
      </div>
    </div>
  );
}
```

**Задачи:**
- [ ] Создать страницу `/settings/ai`
- [ ] Добавить сохранение ключей в .env
- [ ] Добавить тест соединения

---

## 🚀 Phase 4: Skills System (1-2 дня)

### День 8: Skill Runner

**Файлы:**
- `lib/skills/runner.ts`
- `lib/skills/weather.ts` (пример)
- `lib/skills/research.ts`

**Skill Interface:**
```typescript
// lib/skills/types.ts
export interface Skill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  execute(input: string, context: any): Promise<string>;
}
```

**Skill Runner:**
```typescript
// lib/skills/runner.ts
export class SkillRunner {
  private skills: Map<string, Skill> = new Map();
  
  register(skill: Skill) {
    this.skills.set(skill.id, skill);
  }
  
  async detectAndRun(input: string, context: any) {
    // Найти подходящий skill по триггерам
    for (const skill of this.skills.values()) {
      if (skill.triggers.some(t => input.toLowerCase().includes(t))) {
        return skill.execute(input, context);
      }
    }
    
    return null; // No skill matched
  }
}
```

**Weather Skill (пример):**
```typescript
// lib/skills/weather.ts
export class WeatherSkill implements Skill {
  id = 'weather';
  name = 'Погода';
  description = 'Получить текущую погоду и прогноз';
  triggers = ['погода', 'weather', 'температура'];
  
  async execute(input: string, context: any) {
    // Extract location from input
    const location = 'Сургут'; // Default
    
    // Fetch weather from Open-Meteo
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=61.25&longitude=73.43&current_weather=true`
    );
    
    const data = await response.json();
    
    return `Погода в ${location}: ${data.current_weather.temperature}°C`;
  }
}
```

**Задачи:**
- [ ] Создать `lib/skills/runner.ts`
- [ ] Создать weather skill
- [ ] Создать research skill
- [ ] Интегрировать с AI Chat

---

## 📊 Phase 5: QA + Browser (2-3 дня)

### День 9: QA Agent

**Файлы:**
- `lib/qa/agent.ts`
- `lib/qa/diff-analyzer.ts`
- `lib/qa/health-score.ts`

**QA Agent:**
```typescript
// lib/qa/agent.ts
export class QAAgent {
  async runQA() {
    // 1. Analyze diff
    const diff = await this.getDiff();
    const affectedRoutes = this.analyzeDiff(diff);
    
    // 2. Test each route
    const results = [];
    for (const route of affectedRoutes) {
      const result = await this.testRoute(route);
      results.push(result);
    }
    
    // 3. Calculate health score
    const healthScore = this.calculateHealthScore(results);
    
    return {
      healthScore,
      results,
      recommendations: this.generateRecommendations(results),
    };
  }
  
  private async testRoute(route: string) {
    // Browser testing logic
    // Use Playwright or fetch
  }
}
```

**Задачи:**
- [ ] Создать QA Agent
- [ ] Добавить diff analyzer
- [ ] Добавить health score calculator
- [ ] Создать `/api/qa/run` endpoint

---

## 🎯 Итоговый Timeline

| День | Фаза | Задачи | Результат |
|------|------|--------|-----------|
| 1 | Backend | Database schema | Prisma models |
| 2 | Backend | AI Providers | Router + 2 providers |
| 3 | Backend | Memory System | Manager + Context Builder |
| 4 | Agents | Base Agent + 7 agents | Agent System |
| 5 | Agents | API Endpoints | /api/ai/*, /api/agents/* |
| 6 | Frontend | AI Chat Widget | Chat in Dashboard |
| 7 | Frontend | AI Settings | Provider config UI |
| 8 | Skills | Skill Runner | 3 skills |
| 9 | QA | QA Agent | Health Score |

**Итого:** 9 дней → Автономный CEOClaw

---

## 🚀 После завершения

### Marketing & Sales:

1. **Landing Page**
   - ceoclaw.com
   - Features, pricing, demo

2. **Social Media**
   - Telegram канал
   - YouTube demo
   - Twitter/X thread

3. **Product Hunt**
   - Launch day
   - Community building

4. **Sales**
   - Enterprise план
   - Интеграции (1C, Telegram)
   - White-label решения

---

**Статус:** Готов к запуску!
**Следующий шаг:** День 1 — Database Schema

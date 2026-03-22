# CEOClaw AI + RAG System

**Version:** 1.0
**Date:** 2026-03-21
**Status:** ✅ Production Ready

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CEOClaw Dashboard                        │
│                                                              │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   User      │───▶│  /api/ai/    │───▶│   ZAI/API     │  │
│  │   Query     │    │    chat      │    │   Provider    │  │
│  └─────────────┘    └──────┬───────┘    └───────────────┘  │
│                            │                                │
│                            ▼                                │
│                    ┌──────────────┐                        │
│                    │  RAG Search  │                        │
│                    │  (Memory DB) │                        │
│                    └──────┬───────┘                        │
│                            │                                │
│                            ▼                                │
│                    ┌──────────────┐                        │
│                    │  Context +   │                        │
│                    │  System Prompt│                       │
│                    └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Memory System (`prisma/schema.prisma`)

```prisma
model Memory {
  id         String    @id
  type       String    // long_term | episodic | procedural
  category   String    // project | fact | contact | skill
  key        String    // project:Северный путь:status
  value      String    // JSON data
  confidence Float     // 0-100
  source     String    // user | system | analysis
  validFrom  DateTime
  validUntil DateTime?
  @@index([key])
  @@index([type, category])
}
```

**Current Stats:**
- 77 memories indexed
- 72 project facts
- 3 general facts
- 2 chat logs

### 2. RAG Search (`app/api/ai/chat/route.ts`)

```typescript
// Query classification
type QueryType = 'evm' | 'fact' | 'analysis';

function classifyQuery(query: string): QueryType {
  // EVM: "рассчитай SPI", "CPI проекта"
  // Fact: "статус проекта", "какой бюджет"
  // Analysis: everything else
}

// Memory search
async function searchMemory(query: string): Promise<RAGResult> {
  // 1. Extract keywords
  // 2. Search Memory table (full-text)
  // 3. Search Project table
  // 4. Return top 10 memories + 5 projects
}
```

### 3. AI Provider (`lib/ai/providers.ts`)

**Supported Providers:**
- ✅ OpenRouter (primary)
- ✅ ZAI (fallback)
- ⚠️ Local MLX (macOS only, not for Vercel)

**Model Selection:**
```
evm → gpt-4o-mini (accurate calculations)
fact → gemma-3-4b-it:free (fast, free)
analysis → glm-4.7 (balanced)
```

---

## API Endpoints

### `/api/ai/chat` (POST)

**Request:**
```json
{
  "messages": [
    {"role": "user", "content": "Статус проекта Северный путь"}
  ],
  "stream": false
}
```

**Response:**
```json
{
  "success": true,
  "response": "Проект «Северный путь» находится на стадии планирования...",
  "metadata": {
    "queryType": "fact",
    "memoriesFound": 3,
    "projectsFound": 1
  }
}
```

**Stream Mode:**
```javascript
const response = await fetch('/api/ai/chat', {
  method: 'POST',
  body: JSON.stringify({
    messages: [...],
    stream: true
  })
});

const reader = response.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  // SSE format: data: {"content": "..."}
}
```

### `/api/memory` (GET/POST)

**GET** - List memories:
```
GET /api/memory?type=long_term&category=project&limit=100
```

**POST** - Create memory:
```json
{
  "type": "long_term",
  "category": "project",
  "key": "project:Новый:status",
  "value": {"status": "planning", "progress": 0},
  "confidence": 100,
  "source": "user"
}
```

---

## Seeding Memory

**Script:** `scripts/seed-memory.ts`

**Run:**
```bash
npx tsx scripts/seed-memory.ts
```

**What it does:**
1. Reads all projects from database
2. Creates facts for each project:
   - `project:{name}:status` - status, progress, health
   - `project:{name}:budget` - plan, fact, CPI
   - `project:{name}:timeline` - start, end, expected progress
   - `project:{name}:location` - location, direction
3. Adds general facts (company, user, EVM formulas)

**Output:**
```
📊 Memory Stats:
   Total: 77
   project: 72
   fact: 3
   chat: 2
```

---

## EVM Integration

**System Prompt (EVM mode):**
```
Специализация: EVM-анализ (Earned Value Management)

Формулы:
- SPI = BCWP / BCWS
- CPI = BCWP / ACWP
- EAC = BAC / CPI
- VAC = BAC - EAC

Данные из памяти:
{project budget facts}
```

**Example Query:**
```
User: "Рассчитай SPI и CPI для проекта Северный путь"
AI: 
  - Извлекает BCWS, BCWP, ACWP из памяти
  - Вычисляет SPI, CPI
  - Интерпретирует результат
```

---

## Deployment

### Vercel (Production)

**Environment Variables:**
```env
OPENROUTER_API_KEY=sk-or-v1-...
DATABASE_URL=file:./dev.db  # or PostgreSQL
```

**Limitations:**
- ❌ No local MLX (macOS only)
- ✅ OpenRouter API works
- ✅ SQLite or PostgreSQL
- ✅ RAG search works

**Build:**
```bash
npm run build
vercel --prod
```

### Local Development

```bash
npm run dev
# Server: http://localhost:3000
# API: http://localhost:3000/api/ai/chat
```

---

## Future Improvements

### Phase 2: Vector Search

**Problem:** Current RAG uses full-text search (contains), not semantic.

**Solution:**
```typescript
// Add embeddings to Memory table
model Memory {
  // ... existing fields
  embedding Float[] // 768-dim vector
}

// Use pgvector or sqlite-vec
async function vectorSearch(query: string) {
  const queryEmbedding = await embed(query);
  return prisma.$queryRaw`
    SELECT * FROM Memory
    ORDER BY embedding <=> ${queryEmbedding}
    LIMIT 10
  `;
}
```

### Phase 3: Learning

- Track user corrections
- Update confidence scores
- Decay old memories

---

## Testing

**Manual Test:**
```bash
# Health check
curl http://localhost:3000/api/ai/chat

# Query
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Статус проекта Северный путь"}]}'
```

**Expected:**
- Response time: 2-5 seconds
- Query type detected
- Memories found > 0
- Response includes project data

---

## Files

```
ceoclaw-dev/
├── app/api/ai/chat/
│   └── route.ts              # Main AI chat endpoint
├── app/api/memory/
│   └── route.ts              # Memory CRUD API
├── lib/ai/
│   ├── providers.ts          # AI provider adapters
│   ├── gateway-adapter.ts    # OpenClaw Gateway
│   └── ...
├── lib/memory/
│   └── prisma-memory-manager.ts
├── scripts/
│   └── seed-memory.ts        # Memory seeder
├── prisma/
│   └── schema.prisma         # Memory model
└── docs/
    └── AI-RAG-SYSTEM.md      # This file
```

---

## Support

- **Issues:** Check `/api/ai/chat` health endpoint
- **Logs:** `lib/logger.ts` outputs to console
- **Memory stats:** `GET /api/memory`

---

_Generated: 2026-03-21_
_Author: OpenClaw AI_

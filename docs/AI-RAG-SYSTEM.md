# CEOClaw AI + RAG System

**Version:** `0.1.0` (web app package)  
**Date:** `2026-03-24`  
**Status:** Implemented subsystem; foundation hardening in progress

> This document describes the current AI/RAG surfaces and operational caveats. It should not be read as a claim that the whole product is already `production ready`.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     CEOClaw Dashboard                      │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │   User      │───▶│  /api/ai/    │───▶│ Provider /    │   │
│  │   Query     │    │    chat      │    │ model layer   │   │
│  └─────────────┘    └──────┬───────┘    └───────────────┘   │
│                            │                                 │
│                            ▼                                 │
│                    ┌──────────────┐                          │
│                    │  RAG /       │                          │
│                    │  memory read │                          │
│                    └──────┬───────┘                          │
│                            ▼                                 │
│                    ┌──────────────┐                          │
│                    │ Context +    │                          │
│                    │ system prompt│                          │
│                    └──────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Current subsystem reality

- `/api/ai/chat` is a real application surface, not a placeholder.
- Memory/RAG-adjacent server paths exist, including `/api/memory` and Prisma-backed memory helpers.
- Vercel runtime should use a real Postgres database; SQLite remains the checked-in local/default schema path.
- Vector search is **not** the shipped baseline yet; future `pgvector` work remains a roadmap item.
- CI still defaults to `SKIP_E2E=true`, so subsystem confidence today comes primarily from Vitest, smoke flows, and post-deploy checks.

---

## Components

### 1. Memory surfaces

Current repo surfaces include:

- `app/api/memory/route.ts`
- `app/api/memory/[id]/route.ts`
- `app/api/memory/search/route.ts`
- `app/api/memory/stats/route.ts`
- `lib/memory/prisma-memory-manager.ts`

These paths provide the current operational baseline for memory persistence and retrieval.

### 2. AI chat surface

Primary chat entry point:

- `app/api/ai/chat/route.ts`

Supporting run/trace surfaces also exist under:

- `app/api/ai/runs/**`

### 3. Provider posture

Current provider stack in the repository is centered around:

- **OpenRouter**
- **ZAI**
- optional **OpenAI**
- local MLX workflows for macOS/local experimentation

---

## Deployment posture

### Vercel / hosted environments

**Environment variables:**

```env
# Hosted environments should use Postgres
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
DIRECT_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_PRISMA_URL=postgresql://user:pass@host/db?sslmode=require
POSTGRES_URL=postgresql://user:pass@host/db?sslmode=require

# At least one provider key
OPENROUTER_API_KEY=sk-or-v1-...
# or ZAI_API_KEY=...
# or OPENAI_API_KEY=...
```

### Operational caveats

- Hosted preview/production should **not** rely on `file:./dev.db`.
- Checked-in `prisma/schema.prisma` is now the shared Postgres schema for local and hosted runtimes.
- Production deploys prepare Prisma through `npm run prisma:prepare:production`, including baseline bootstrap and readiness checks.
- `DIRECT_URL` should be configured for the migration/bootstrap path when a non-pooling connection is available.

### Build / release checks

```bash
npm run build
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

---

## Local development

```bash
npm run dev
# App: http://localhost:3000
# AI chat: http://localhost:3000/api/ai/chat
```

For local-only workflows you can stay on SQLite and local provider keys, but that is a development convenience, not the target hosted production posture.

---

## Future improvements

### Phase 2: Vector search

Current retrieval is still conventional/full-text oriented. Semantic retrieval remains future work.

Potential next step:

```typescript
// Example future direction only
async function vectorSearch(query: string) {
  // embed query
  // search pgvector-backed memory rows
}
```

### Phase 3: Learning loop

- Track user corrections
- Improve confidence scoring
- Add aging/decay rules for older memory items

---

## Testing and support

### Current validation paths

```bash
# Unit/integration baseline
npm run test:run

# Playwright smoke subset
npm run test:e2e:smoke

# Hosted smoke after deploy
BASE_URL="https://your-app.vercel.app" npm run smoke:postdeploy
```

### Support references

- `README.md` — current product posture
- `PROJECT_STATUS.md` — status and blockers
- `RUNBOOK.md` — deploy and health-check flow

---

_Generated/updated: 2026-03-24_

# CEOClaw API Reference

**Base URL:** `/api`
**Authentication:** NextAuth.js session (cookie-based)
**Rate Limiting:** 100 requests/min per IP on authenticated routes
**Content-Type:** `application/json`

---

## Authentication

All endpoints (except /api/health, /api/demo/*, /api/auth/*) require authentication.
Requests without a valid session return `401 Unauthorized`.

Rate-limited endpoints return `429 Too Many Requests` with a `Retry-After` header.

---

## Core Resources

### Projects

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects` | List all projects (with filters) |
| POST | `/api/projects` | Create a new project |
| GET | `/api/projects/:id` | Get project details |
| PUT | `/api/projects/:id` | Update a project |
| DELETE | `/api/projects/:id` | Delete a project |
| GET | `/api/projects/:id/gantt` | Get Gantt chart data |
| GET | `/api/projects/:id/labor-cost` | Get labor cost breakdown |
| GET | `/api/projects/:id/documents/index` | Get project documents |
| GET | `/api/projects/export` | Export projects (CSV/Excel) |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (with filters, pagination) |
| POST | `/api/tasks` | Create a new task |
| GET | `/api/tasks/:id` | Get task details |
| PUT | `/api/tasks/:id` | Update a task |
| DELETE | `/api/tasks/:id` | Delete a task |
| GET | `/api/tasks/:id/dependencies` | Get task dependencies |
| POST | `/api/tasks/:id/dependencies` | Add a dependency |
| DELETE | `/api/tasks/:id/dependencies/:depId` | Remove a dependency |
| POST | `/api/tasks/:id/move` | Move task (kanban) |
| POST | `/api/tasks/:id/reschedule` | Reschedule a task |
| POST | `/api/tasks/reorder` | Reorder tasks |
| GET | `/api/tasks/export` | Export tasks |

### Milestones

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/milestones` | List milestones |
| POST | `/api/milestones` | Create milestone |
| GET | `/api/milestones/:id` | Get milestone |
| PUT | `/api/milestones/:id` | Update milestone |

---

## Orchestration

### Agents

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orchestration/agents` | List registered agents |
| POST | `/api/orchestration/agents` | Register a new agent |
| GET | `/api/orchestration/agents/:id` | Get agent details |
| PATCH | `/api/orchestration/agents/:id` | Update agent config |
| DELETE | `/api/orchestration/agents/:id` | Remove agent |
| GET | `/api/orchestration/agents/:id/runs` | Get agent run history |
| GET | `/api/orchestration/agents/:id/keys` | List API keys |
| POST | `/api/orchestration/agents/:id/keys` | Create API key |
| DELETE | `/api/orchestration/agents/:id/keys/:keyId` | Revoke API key |
| POST | `/api/orchestration/agents/:id/wakeup` | Wake up agent |
| GET | `/api/orchestration/agents/:id/revisions` | Get config revisions |

### Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orchestration/workflows` | List workflows |
| POST | `/api/orchestration/workflows` | Create workflow |
| GET | `/api/orchestration/workflows/:id` | Get workflow details |
| PATCH | `/api/orchestration/workflows/:id` | Update workflow |
| GET | `/api/orchestration/workflows/:id/runs` | Get workflow runs |

### Workflow Runs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orchestration/workflow-runs` | List all workflow runs |
| GET | `/api/orchestration/workflow-runs/:runId` | Get run details |
| POST | `/api/orchestration/workflow-runs/:runId/advance` | Advance run to next stage |

### Orchestration Support

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orchestration/activity` | Activity feed |
| GET | `/api/orchestration/org-chart` | Agent organization chart |
| GET | `/api/orchestration/heartbeat/execute` | Run heartbeat check |
| GET | `/api/orchestration/ops` | Operational metrics |
| GET | `/api/orchestration/dlq` | Dead letter queue |
| GET | `/api/orchestration/permissions` | Permission matrix |
| GET | `/api/orchestration/templates` | Workflow templates |

---

## AI and Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/chat` | AI chat completion |
| POST | `/api/ai/stream` | Streaming AI response |
| POST | `/api/ai/kernel` | AI kernel execution |
| GET | `/api/ai/runs` | List AI runs |
| POST | `/api/ai/runs` | Create AI run |
| GET | `/api/ai/runs/:id` | Get run details |
| GET | `/api/ai/runs/:id/trace` | Get execution trace |
| POST | `/api/ai/runs/:id/replay` | Replay a run |
| POST | `/api/ai/runs/:id/proposals/:pid/apply` | Apply AI proposal |
| GET | `/api/ai/settings` | Get AI settings |
| POST | `/api/chat` | General chat endpoint |

---

## Work Reports

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/work-reports` | List work reports |
| POST | `/api/work-reports` | Create report |
| GET | `/api/work-reports/:id` | Get report |
| PUT | `/api/work-reports/:id` | Update report |
| DELETE | `/api/work-reports/:id` | Delete report |
| POST | `/api/work-reports/:id/approve` | Approve report |
| POST | `/api/work-reports/:id/reject` | Reject report |
| GET | `/api/work-reports/:id/signal-packet` | Get signal packet |
| POST | `/api/work-reports/:id/signal-packet/email` | Send via email |
| POST | `/api/work-reports/:id/signal-packet/telegram` | Send via Telegram |
| GET | `/api/work-reports/:id/signal-packet/export` | Export signal packet |
| GET | `/api/work-reports/:id/signal-packet/delivery-history` | Delivery history |

---

## Finance and Billing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/billing` | Get billing info |
| POST | `/api/billing/checkout` | Start checkout |
| GET | `/api/billing/portal` | Billing portal URL |
| POST | `/api/billing/webhook` | Stripe webhook |
| GET | `/api/finance/export` | Export financial data |
| POST | `/api/finance/imports` | Import financial data |
| GET | `/api/expenses` | List expenses |
| POST | `/api/expenses` | Create expense |
| GET | `/api/expenses/categories` | Expense categories |
| GET | `/api/contracts` | List contracts |
| POST | `/api/contracts` | Create contract |

---

## Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/analytics/overview` | Dashboard analytics |
| GET | `/api/analytics/plan-fact` | Plan vs fact analysis |
| GET | `/api/analytics/predictions` | AI predictions |
| GET | `/api/analytics/recommendations` | AI recommendations |
| GET | `/api/analytics/team-performance` | Team performance |
| GET | `/api/evm` | Earned value management |
| GET | `/api/evm/history` | EVM history |
| GET | `/api/evm/snapshot` | EVM snapshot |

---

## Evidence and Reconciliation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/evidence` | List evidence |
| POST | `/api/evidence` | Create evidence entry |
| GET | `/api/evidence/:id` | Get evidence details |
| POST | `/api/evidence/analyze` | Analyze evidence |
| POST | `/api/evidence/sync` | Sync evidence |
| POST | `/api/evidence/fusion` | Fuse evidence sources |
| GET | `/api/reconciliation/casefiles` | Get casefiles |
| POST | `/api/reconciliation/sync` | Sync reconciliation |

---

## Scheduling

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/scheduling/auto-schedule` | Auto-schedule tasks |
| GET | `/api/scheduling/baseline` | Get baseline |
| GET | `/api/scheduling/critical-path` | Calculate critical path |
| POST | `/api/scheduling/resource-leveling` | Level resources |
| GET | `/api/gantt` | Get Gantt data |
| GET | `/api/gantt/dependencies` | Get Gantt dependencies |

---

## Connectors

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/connectors` | List connectors |
| POST | `/api/connectors` | Create connector |
| GET | `/api/connectors/:id` | Get connector |
| PUT | `/api/connectors/:id/credentials` | Update credentials |
| GET | `/api/connectors/one-c/*` | 1C integration (5 endpoints) |
| GET | `/api/connectors/telegram/*` | Telegram integration (4 endpoints) |
| GET | `/api/connectors/gps/*` | GPS tracking (2 endpoints) |
| GET | `/api/connectors/email/briefs` | Email briefs |

---

## System

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (no auth) |
| GET | `/api/search` | Global search |
| GET | `/api/settings` | User settings |
| GET | `/api/sse` | Server-sent events stream |
| GET | `/api/notifications` | List notifications |
| POST | `/api/notifications/:id/read` | Mark notification read |
| POST | `/api/voice/tts` | Text-to-speech |

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| Status | Description |
|--------|-------------|
| 400 | Bad Request — invalid input |
| 401 | Unauthorized — no valid session |
| 403 | Forbidden — insufficient permissions |
| 404 | Not Found |
| 429 | Too Many Requests (rate limited) |
| 500 | Internal Server Error |

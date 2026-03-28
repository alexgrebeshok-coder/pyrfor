# CEOClaw — Architecture Snapshot

**Date:** `2026-03-25`
**Version:** `0.1.0` (web app package)
**Status:** Architecture truth synced to the post-roadmap repository state

---

## System overview

CEOClaw is a Next.js 15 full-stack PM / ops platform with five main operational spines:

1. **portfolio and execution surfaces** — dashboard, projects, tasks, gantt, calendar, risks, analytics;
2. **work-report control chain** — drafting, review, approval sync, signal packet generation, exports, delivery;
3. **evidence and reconciliation truth** — persisted ledger, analysis, casefiles, cross-source operational context;
4. **AI runtime** — route-aware provider shell, AI runs, chat/context flows, replayable execution traces;
5. **policy and access layer** — role/workspace policy used by both API guards and UI gating.

---

## Current architecture map

```text
┌──────────────────────────────────────────────────────────────┐
│                     CEOClaw (Next.js 15)                    │
│      portfolio + delivery + evidence + approvals + AI       │
└──────────────────────────────────────────────────────────────┘
                                │
        ┌───────────────────────┼────────────────────────┐
        │                       │                        │
        ▼                       ▼                        ▼
┌────────────────┐    ┌────────────────────┐   ┌─────────────────────┐
│ Client routes  │    │ API / domain       │   │ Policy / access     │
│ route-aware    │    │ services           │   │ workspaces + roles  │
│ AI shell       │    │ work reports       │   │ permissions         │
└────────────────┘    │ evidence / tasks   │   └─────────────────────┘
        │             │ approvals / ops    │              │
        └─────────────┴──────────┬─────────┴──────────────┘
                                 ▼
                      ┌────────────────────────┐
                      │ Prisma + Postgres-first│
                      │ schema + migrations    │
                      └────────────────────────┘
                                 │
                                 ▼
                  ┌────────────────────────────────┐
                  │ Telegram / Email / GPS / 1C /  │
                  │ other operational connectors   │
                  └────────────────────────────────┘
```

---

## Architecture highlights since the original baseline

### 1. Route-aware AI shell

- client AI provider is now scoped to the routes that need it instead of living across broad client surfaces;
- chat-heavy UI is lazy-loaded to reduce bundle pressure;
- AI runs, replay, and traces live beside the operational product instead of in a detached prototype lane.

### 2. Work-report control chain

Current chain:

```text
work report draft
  → submit / resubmit
  → canonical review workspace
  → synced Approval record
  → approved-only signal packet
  → markdown / JSON export
  → Telegram + email handoff
  → delivery ledger + history
```

Key implications:

- work-report approvals are no longer split across competing review surfaces;
- `/approvals` is a truthful global queue/history surface, not a second detached review engine;
- outbound delivery channels share the same delivery-ledger foundation.

### 3. Evidence and reconciliation truth layer

Current chain:

```text
connector sync / imported facts
  → persisted evidence ledger
  → selected-record operator inspection
  → on-demand evidence analysis
  → reconciliation casefiles
```

This means evidence is no longer just stored data. It is an operator-facing truth layer with persisted provenance, analysis, and case-level reconciliation context.

### 4. Dependency-aware task workflows

Dependency architecture now has two layers:

- **summary layer** — dependency badges, blocker counts, downstream impact metadata on tasks;
- **workspace layer** — live dependency workspace mounted inside `/tasks` and project task boards.

The workspace supports:

- direct predecessor/downstream inspection;
- dependency editing for roles with `MANAGE_TASKS`;
- read-only dependency context for viewer roles.

### 5. Shared policy vocabulary across API and UI

The repo now uses the same permission vocabulary in both server guards and UI surfaces for the major operational actions:

- `RUN_AI_ACTIONS`
- `VIEW_CONNECTORS`
- `VIEW_TASKS`
- `MANAGE_TASKS`
- work-report create/review/delivery permissions

This matters because sensitive controls are no longer expected to fail only after an API request; the UI degrades or hides them earlier.

---

## Key operational flows

### Task flow

```text
/tasks or project board
  → task summary + dependency badges
  → dependency workspace
  → dependency routes
  → refreshed blocker / downstream metadata
```

### Approval flow

```text
work report lifecycle
  → Approval record sync
  → /approvals queue/history visibility
  → canonical review workspace for work reports
```

### Delivery flow

```text
approved report
  → signal packet builder
  → markdown / JSON export
  → Telegram or email delivery
  → delivery ledger / recent history
```

### Evidence flow

```text
sync/import
  → persisted ledger
  → operator-selected record
  → analysis request
  → supporting sources / gaps / anomalies
```

---

## Data layer reality

- Prisma schema and committed migrations now describe a **Postgres-first** baseline.
- Tactical SQLite bridge logic has been removed from active production paths.
- The remaining database uncertainty is not schema intent but **external validation**: the committed bootstrap/migration path still needs a disposable real-Postgres rerun to close the last old-plan blocker.

---

## Validation metrics for this snapshot

| Metric | Current state |
|---|---|
| App / API routes | `131` |
| Automated tests | `132` passing |
| Build | clean production build against Postgres env vars |
| TypeScript | `strict: true` |
| Prod vulnerabilities | `0` |

---

## Repository structure (high signal)

```text
app/                     Next.js App Router pages + API routes
components/              product UI surfaces
lib/                     domain logic, policy, AI adapters, Prisma helpers
prisma/                  schema + committed migrations
__tests__/               repo-native Vitest coverage
```

Notable directories for current architecture work:

- `components/work-reports/`
- `components/integrations/`
- `components/tasks/`
- `components/approvals/`
- `lib/policy/`
- `lib/work-reports/`
- `lib/evidence/`
- `lib/tasks/`

---

## Bottom line

The current architecture is no longer “dashboard + AI demo.” It is a multi-surface operational platform with a shared control spine across delivery, evidence, approvals, tasks, and access policy.

The last meaningful architecture blocker from the old roadmap is external Postgres bootstrap validation, not missing in-repo foundations.

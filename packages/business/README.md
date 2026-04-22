# @ceoclaw/business

**CEOClaw Business** — SMB plugins for construction, manufacturing, services.

**License:** BSL 1.1 (Business Source License — open after 3 years, protected from fork-competitors)
**Status:** 🔧 R1 — active migration from `ceoclaw-dev` monolith

---

## What lives here

| Module | Description |
|--------|-------------|
| `src/evm/` | EVM calculations: CPI, SPI, EAC (Earned Value Management) |
| `src/autobusiness/` | 1С OData integration (read-only Phase 0 → full Phase 2) |
| `src/projects/` | Projects, Tasks, Milestones, Gantt, Kanban, Scheduling |
| `src/operations/` | Equipment, Materials, Suppliers, Field operations |
| `src/finance/` | Internal project finance, Expenses |
| `src/contracts/` | Contracts, КС-2/КС-3 generators, ГОСТ forms |
| `src/compliance/` | Audit packs, Evidence, Cutover decisions |
| `src/enterprise/` | Enterprise truth, Escalations |
| `src/tenant/` | Multi-tenant onboarding, readiness, rollout |
| `src/dashboards/` | Command center, BI dashboards |

## ICP

СМБ руководитель 35–55: строительство / производство / услуги, выручка 50–500M ₽/год.

## Dependencies

```
@ceoclaw/business → @ceoclaw/engine
@ceoclaw/business → @ceoclaw/ui
```

**Never the reverse.** Enforced by ESLint boundaries.

## Development

```bash
pnpm --filter @ceoclaw/business dev
pnpm --filter @ceoclaw/business typecheck
pnpm --filter @ceoclaw/business test
```

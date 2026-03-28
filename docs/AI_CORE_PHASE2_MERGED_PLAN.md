# CEOClaw AI Core Phase 2 Merged Plan

Date: 2026-03-26
Branch: `feature/map-first-ui`
Scope: production-hardening and execution-flow integration for the AI core introduced in commits `80313ba` and `911d39e`

## Why this merged plan exists

The original Phase 2 production plan is valid for the AI-core branch, but it needs two upgrades before execution:

1. It must be branch-scoped.
   The AI-core modules do not exist on the current `pm-dashboard-visual-test/main` checkout. This work belongs to `ceoclaw-dev` on `feature/map-first-ui`.

2. It must fit the larger CEOClaw architecture.
   The AI core is not the whole product. It must eventually integrate with the existing orchestra, perception, immunology, operator surfaces, and memory strategy.

This document keeps the original production-hardening intent but clarifies the execution order and adds the missing integration expectations.

## Phase 2 goals

1. Make the new AI core production-safe.
2. Wire the new modules into the real execution flow.
3. Add focused tests for the new modules.
4. Prepare the AI core for later integration with orchestra, perception, and delivery governance surfaces.

## Execution clusters

The original task list called out 14 parallel tasks. In practice, many tasks touch the same files. To reduce merge conflicts, the implementation should be grouped into write-safe clusters.

### Cluster A: Provider and runtime safety

Files:
- `lib/ai/providers.ts`
- `lib/ai/circuit-breaker.ts`
- `lib/ai/cost-tracker.ts`

Goals:
- fix streaming cleanup, wake-up races, and queue growth
- add provider timeouts and circuit-breaker execution timeout
- fix GigaChat token refresh concurrency
- improve cost tracking accuracy and persistence resilience

### Cluster B: Agent execution and tool flow

Files:
- `lib/ai/agent-executor.ts`
- `lib/ai/kernel-tool-plane.ts`
- `lib/ai/plugin-system.ts`
- `lib/ai/messaging/agent-bus.ts`

Goals:
- make tool-call parsing robust
- wire executor into collaborative agent flow
- surface plugin tools safely
- publish real execution events into the bus

### Cluster C: Memory and retrieval

Files:
- `lib/ai/memory/agent-memory-store.ts`
- `lib/ai/rag/document-indexer.ts`
- `lib/ai/kernel-context-stack.ts`
- `app/api/projects/[id]/documents/index/route.ts`

Goals:
- fix memory-store safety and retrieval quality
- inject memory into agent context
- inject RAG context into agent context
- add a project document indexing endpoint

### Cluster D: Orchestration hardening

Files:
- `lib/ai/orchestration/planner.ts`
- `lib/ai/orchestration/dag-engine.ts`
- `lib/ai/orchestration/reflection.ts`
- `lib/ai/multi-agent-runtime.ts`

Goals:
- remove dead blueprint logic
- use the dynamic planner as the real source of truth
- harden DAG execution against failed dependencies and bad gates
- harden reflection parsing and bounded revision behavior

### Cluster E: Data model and configuration

Files:
- `prisma/schema.prisma`
- `config/agents/*.json`
- `app/api/admin/ai/stats/route.ts`

Goals:
- remove Prisma `as any` casts where client types already exist
- add missing indexes for cost, memory, and document retrieval
- enrich the remaining agent config stubs
- keep admin observability backed by real AI-core telemetry

### Cluster F: Tests

Files:
- `lib/__tests__/...`

Goals:
- add direct module tests for circuit breaker, cost tracker, executor, planner, DAG, reflection, memory, RAG, bus, and plugins
- update runtime tests to cover executor-based collaborative runs and event publishing

## Added integration expectations

These expectations were not explicit enough in the original plan and are now required.

### Memory expectations

Phase 2 only wires the first production slice of memory:
- short-term in-process memory
- long-term episodic / semantic / procedural retrieval
- prompt injection for relevant recall

The broader CEOClaw memory OS remains a follow-up track:
- semantic memory
- episodic timeline
- planning memory
- procedural playbooks
- operational state memory
- freshness / validity markers

### UI and operator expectations

Phase 2 is still a core/backend wave, but it must leave the product explainable:
- admin AI stats must reflect real provider, bus, and cost activity
- tool/plugin execution must stay safety-gated
- memory/RAG context must be additive and bounded, not prompt-spamming
- later operator surfaces must be able to consume this telemetry

### Later product integration

Phase 2 does not finish the whole product. After this wave, the next major integration tracks remain:
- AI core into the orchestra / conductor path
- AI core into perception and trust-scored evidence flows
- AI core into operator/executive delivery surfaces
- bootstrap and runtime-mode productization

## Acceptance criteria for this implementation wave

1. Critical runtime safety issues fixed.
2. Memory, RAG, executor, plugins, and bus are no longer dead modules.
3. The collaborative runtime uses the executor path instead of raw `router.chat()` for support and synthesis steps where appropriate.
4. The AI admin stats endpoint reports real AI-core telemetry.
5. New tests exist for the hardened modules.
6. Validation passes:
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run test:run`
   - `npm run build`

## Non-goals for this wave

- full orchestra integration
- live perception connectors
- complete memory OS
- bootstrap / onboarding / deployment packaging
- large operator UI redesign

Those remain the next roadmap layers after the AI core is safe and fully wired.

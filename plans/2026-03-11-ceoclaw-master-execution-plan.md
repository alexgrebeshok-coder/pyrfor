# CEOClaw Master Execution Plan

**Date:** 2026-03-11
**Status:** Active
**Supersedes:** none
**Current finish-line execution plan:** `plans/2026-03-20-ceoclaw-final-mile-execution-plan.md`

## Execution Status Snapshot

As of 2026-03-12:
- Wave 0 core stabilization is complete.
- Session 01 import and validation pipeline is complete in the lead branch.
- Session 02 AI action engine generalization is complete in the lead branch.
- Session 03 executive brief and alert engine is complete in the lead branch.
- Session 04 work reports domain port is complete in the lead branch.
- Session 05 connector framework is complete and integrated in the lead branch.
- Session 06 UI shell is complete and integrated against live imports, briefs, work reports, and connector APIs.
- Session 07 organization, workspace, membership, and policy foundation is complete in the lead branch.
- Session 08 plan-vs-fact and financial truth layer is complete in the lead branch.
- Session 09 meeting-to-action vertical slice is complete in the lead branch.
- Session 10 work report signal-to-action loop is complete in the lead branch.
- Session 11 first live connector upgrade is complete in the lead branch.
- Session 12 Telegram brief delivery channel is complete in the lead branch.
- Session 13 scheduled executive digests and delivery policies is complete in the lead branch.
- Session 14 second live datasource connector upgrade is complete in the lead branch.
- Session 15 GPS read-only telemetry ingestion is complete in the lead branch.
- Session 16 evidence ledger and verification status is complete in the lead branch.
- Session 17 AI trace, provenance, and eval harness is complete in the lead branch.
- Session 18 1C live read connector is complete in the lead branch.
- Session 19 operator escalation queue and SLA layer is complete in the lead branch.
- Session 20 live-vs-demo truth in operator UX is complete in the lead branch.
- Session 21 outbound email delivery channel is complete in the lead branch.
- Session 22 Video Fact MVP is complete in the lead branch.
- Session 23 cross-source confidence fusion is complete in the lead branch.
- Session 24 action safety and compensation layer is complete in the lead branch.
- Session 28 evidence and escalation sync jobs is complete in the lead branch.
- Session 27 AI run persistence and workflow ledger is complete in the lead branch.
- Session 29 delivery ledger and idempotent execution is complete in the lead branch.
- Session 30 GPS telemetry domain expansion is complete in the lead branch.
- Session 31 1C financial truth deepening is complete in the lead branch.
- Session 32 reconciliation casefile and fact linking is complete in the lead branch.
- Session 33 executive command center and exception inbox is complete in the lead branch.
- Session 34 audit pack and operational exports is complete in the lead branch.
- Session 35 pilot controls and tenant readiness is complete in the lead branch.
- Session 36 pilot feedback ledger and resolution loop is complete in the lead branch.
- Session 37 tenant readiness and cutover checklist is complete in the lead branch.
- Session 38 pilot review scorecards and governance export is complete in the lead branch.
- Wave 1 foundation services are complete. Wave 2 fact capture and connector shell is complete. Wave 3 platform access model is complete through Session 08. Wave 4 vertical pilot now has Session 09, Session 10, Session 11, Session 12, Session 13, and Session 14 complete.
- Wave 5 evidence and runtime modernization is complete on the lead branch.
- Wave 6 integration truth expansion is complete on the lead branch through Session 26.
- Wave 7 durable runtime hardening is complete on the lead branch through Session 29.
- Wave 8 source-of-truth depth is complete on the lead branch through Session 32.
- Wave 9 pilot-grade operatorization is complete on the lead branch through Session 35.
- Wave 10 pilot feedback and go-live readiness is complete on the lead branch through Session 38.
- Wave 11 governance automation and controlled widening is complete on the lead branch.
- Session 39 governance review scheduling and delivery is complete on the lead branch.
- Session 40 cutover decision register and warning waivers is complete on the lead branch.
- Session 41 tenant onboarding runbook and rollout templates is complete on the lead branch.
- Session 42 tenant rollout packet and handoff export is complete on the lead branch.
- The next canonical step is to define Wave 12 based on what the bounded rollout handoff/export layer exposes as the next real bottleneck.

## 1. Product Direction

CEOClaw is not being developed as another PM dashboard.

Target form:

`enterprise facts -> verification -> agent analysis -> recommendation -> approval -> action -> trace`

North star:

`CEOClaw knows what is actually happening in the project or enterprise and helps management act in time.`

## 2. What We Are Building

### Core product

An AI operating layer for project-driven organizations:
- construction;
- infrastructure;
- logistics;
- industrial and operational projects;
- PMO-driven enterprises.

### Core promise

The system should:
- connect to enterprise facts;
- detect deviations between plan and reality;
- generate executive-grade signals;
- propose actions safely;
- apply approved changes to plans, tasks, risks, and communications.

### Product wedge

The first commercial wedge should be:
- construction and infrastructure first;
- logistics second;
- broader project-heavy enterprises later.

## 3. Reuse Strategy

### Reuse directly

1. AI-PMO Telegram work report workflow:
   - daily field reports;
   - reporter and admin roles;
   - submit, review, approve cycle;
   - CSV export;
   - attachment metadata shape.

2. AI-PMO real-data testing pipeline:
   - file import patterns;
   - validation logic;
   - project-level ingestion structure;
   - normalized data outputs.

### Reuse as specification

1. Agent roles and separation of responsibility.
2. GPS and telemetry as source-of-truth connectors.
3. Video Fact as evidence and early-warning layer.
4. EVM and financial truth on confirmed facts.
5. Principle: `AI recommends, human decides`.

### Do not reuse blindly

1. Claude AI-PMO repo is mostly documentation and design artifacts.
2. There is no finished production agent runtime to transplant.
3. We should port concepts and domain models, not cargo-cult the old architecture.

## 4. Delivery Model

### Recommended model

Use a hybrid model:
- I act as lead integrator and system designer.
- Parallel worker sessions are used only for isolated file zones.
- After each wave, one integration pass merges results into a coherent product.

This is better than:
- full sequential work only, because it is slower than necessary;
- uncontrolled parallel work, because the current wave still crosses telemetry, evidence, AI runtime, and operator surfaces.

## 5. Wave Plan

## Wave 0: Stabilize the Current Repo

**Mode:** Sequential only
**Owner:** Lead session only
**Reason:** The repo currently has broken build/test behavior.

### Goals

1. Build must complete reliably.
2. Unit tests must be real unit tests or be clearly split from integration tests.
3. Demo mode and production mode must be explicit.
4. Current API behavior must stop hiding failures behind broad mock fallbacks.

### Exit criteria

1. `npm run build` passes.
2. `npm run test:unit` is deterministic.
3. There is a written stability baseline.
4. Parallel workers can operate without debugging repo-wide failures first.

## Wave 1: Foundation Services

**Mode:** Parallel allowed
**Max parallel sessions:** 3

### Sessions

1. Session 01: Import and Validation Pipeline
   Status: complete on lead branch.
2. Session 02: AI Action Engine Generalization
   Status: complete on lead branch.
3. Session 03: Executive Brief and Alert Engine
   Status: complete on lead branch.

### Outcome

1. Data can be ingested in a normalized way.
   Current state: import validation and preview APIs exist for WBS, Budget Plan, Risk Register, Payment History, Worklog Summary, and Main Contract placeholder.
2. The AI layer can generate more than one action type.
   Current state: create_tasks, update_tasks, reschedule_tasks, raise_risks, draft_status_report, and notify_team now flow through the shared proposal/apply engine.
3. Executive briefs and alerts exist as first-class outputs.
   Current state: portfolio brief, project brief, and prioritized alerts APIs exist with localized `ru/en` output.

## Wave 2: Fact Capture and Connector Skeleton

**Mode:** Parallel allowed
**Max parallel sessions:** 3

### Sessions

1. Session 04: Work Reports Domain Port
   Status: complete on lead branch.
2. Session 05: Connector Framework
   Status: complete and integrated on lead branch.
3. Session 06: UI Shell for New Domains
   Status: complete and integrated on lead branch.

### Outcome

1. Field facts enter the product.
   Current state: `WorkReport` Prisma model, CRUD API, approve/reject flow, AI-PMO Telegram bot mapper, and smoke-tested project-scoped retrieval exist on the lead branch.
2. Connector registry and health model exist.
   Current state: `/api/connectors`, `/api/connectors/:id`, `/api/health`, adapters for Telegram, email, GPS, and 1C, plus registry-backed integrations UI exist on the lead branch.
3. New surfaces exist for imports, briefs, work reports, and integrations.
   Current state: `/imports`, `/briefs`, `/work-reports`, and `/integrations` are wired to live backend contracts instead of placeholder endpoints.

## Wave 3: Platform Access Model

**Mode:** Sequential preferred
**Max parallel sessions:** 1-2

### Sessions

1. Session 07: Organization, Workspace, Membership, Policy
   Status: complete and integrated on lead branch.
2. Session 08: Plan-vs-Fact and Financial Truth Layer
   Status: complete and integrated on lead branch.

### Rule

Session 07 should land before heavy rollout of session 08 because workspace, visibility, and policy will affect how plan-vs-fact results are exposed.

### Outcome

1. Workspace becomes real.
   Current state: workspace selection is now role-gated through the policy catalog instead of a decorative local preference list.
2. Visibility and permissions become enforceable.
   Current state: live policy checks protect briefs, connectors, imports, work reports, and the due-date cron route.
3. Plan-vs-fact and financial truth move closer to enterprise-grade behavior.
   Current state: portfolio/project plan-vs-fact summaries, EVM metrics, work-report evidence, and analytics/brief integration are live on the lead branch.

## Wave 4: Vertical Pilot

**Mode:** Sequential integration + selective parallel bugfixing

### Sessions

1. Session 09: Meeting-to-Action Vertical Slice
   Status: complete and integrated on lead branch.
2. Session 10: Work Report -> Signal -> Action Loop
   Status: complete and integrated on lead branch.
3. Session 11: First Real Connector Upgrade
   Status: complete and integrated on lead branch.
4. Session 12: Telegram Brief Delivery Channel
   Status: complete and integrated on lead branch.
5. Session 13: Scheduled Executive Digests and Delivery Policies
   Status: complete and integrated on lead branch.
6. Session 14: Second Live Datasource Connector Upgrade
   Status: complete and integrated on lead branch.

### Goals

1. Construction-first pilot scenario.
2. Meeting-to-action flow.
3. Daily executive brief.
4. Work report to signal to action loop.
5. One connector upgraded from stub to real integration.
6. A second datasource connector upgraded from stub to an honest live probe.

### Outcome

An actual pilotable alpha, not just a feature collection.

Current state:

1. `/meetings` provides a working intake UI for project-scoped meeting notes.
2. `/api/meetings/to-action` launches a packet of AI runs on one project context.
3. Tasks, risks, and status draft proposals can be reviewed and applied through the existing AI proposal engine.
4. `/work-reports` now provides a work report signal packet pilot with live packet creation, run polling, and proposal apply.
5. `/api/connectors` now exposes real Telegram, GPS, and 1C live probes instead of pure stubs.
6. `/integrations` now shows three live connectors and one remaining stub.
7. Runtime health now surfaces token, webhook, and GPS probe problems honestly; on the current machine Telegram resolves as `degraded` because Bot API returns `HTTP 404` on `getMe`, while GPS resolves as `ok` against the configured `/session-stats` probe.
8. `/api/connectors/telegram/briefs` now supports dry-run preview and outbound Telegram delivery for portfolio or project briefs.
9. `/briefs` now exposes a Telegram delivery panel with preview/send flow on top of the live brief generator.
10. `/api/connectors/telegram/briefs/policies` now persists scheduled Telegram digest policies with locale, cadence, timezone, target chat, and last delivery state.
11. `/api/connectors/telegram/briefs/policies/run-due` now executes due policies through the existing cron-safe auth pattern.
12. `/briefs` now exposes a scheduled digest operator panel with save, pause, and resume controls.

## Wave 5: Evidence and Runtime Modernization

**Mode:** Lead-first sequential delivery with selective parallel implementation only when file zones are isolated

### Sessions

1. Session 15: GPS Read-Only Telemetry Ingestion
   Status: complete on lead branch.
2. Session 16: Evidence Ledger and Verification Status
   Status: complete on lead branch.
3. Session 17: AI Trace, Provenance, and Eval Harness
   Status: complete on lead branch.

### Goals

1. Move from connector health to connector truth.
2. Distinguish reported facts from observed and verified evidence.
3. Make at least one AI operating loop inspectable and regression-testable.

### Outcome

This wave turned the current alpha from:

`facts -> recommendation -> approval`

into:

`facts -> evidence -> verification -> recommendation -> approval -> trace`

### Current state

1. GPS now has a live sample read path, not only a readiness probe.
2. Evidence is now surfaced with `reported / observed / verified` states.
3. One AI operating loop now exposes a trace route, provenance panel, and repeatable eval coverage.
4. Cross-source confidence fusion now rolls work reports, GPS telemetry, and linked visual evidence into one explainable operator view and `/api/evidence/fusion`.
5. Applied AI proposals now expose explicit safety posture, compensation mode, and guarded post-apply state in both trace and operator UI.

## Wave 6: Integration Truth Expansion

**Mode:** Lead-first sequencing with worker help only for isolated UI or route zones

### Sessions

1. Session 18: 1C Live Read Connector
   Status: complete on lead branch.
2. Session 19: Operator Escalation Queue and SLA Layer
   Status: complete on lead branch.
3. Session 20: Live-vs-Demo Truth in Operator UX
   Status: complete on lead branch.

### Goals

1. Extend enterprise truth beyond GPS and work reports.
2. Turn signals into managed operator workload.
3. Remove ambiguity between live and simulated product states.

### Current state

1. 1C now has a live project finance sample read path, not only a stub descriptor.
2. `/api/connectors/one-c/sample` exposes normalized project finance records for operators.
3. `/integrations` now shows a live 1C finance sample alongside GPS telemetry evidence.
4. `/api/escalations` and `/api/escalations/:id` now turn work-report signal runs into operator-managed queue items.
5. `/work-reports` now surfaces owner assignment, acknowledgment state, urgency, aging, and SLA context for unresolved signal items.
6. `/integrations`, `/work-reports`, and `/briefs` now surface a shared runtime truth card with live, demo, mixed, or degraded state.
7. Demo mode now blocks live delivery workflows and keeps `/work-reports` plus `/api/escalations` in a safe preview posture.

### 30/60/90-day direction

The detailed roadmap for post-alpha modernization is tracked in:

- `plans/2026-03-11-ceoclaw-modernization-roadmap.md`

## Wave 7: Durable Runtime Hardening

**Mode:** Lead-first sequential delivery. Worker help only for isolated route, UI, or test zones after state ownership is fixed.

### Sessions

1. Session 27: AI Run Persistence and Workflow Ledger
   Status: complete on lead branch.
2. Session 28: Evidence and Escalation Sync Jobs
   Status: complete on lead branch.
3. Session 29: Delivery Ledger and Idempotent Execution
   Status: complete on lead branch.

### Goals

1. Replace file-backed workflow state with durable database truth.
2. Remove critical sync-on-read behavior from evidence and escalation surfaces.
3. Make outbound execution auditable, retry-safe, and explainable.

### Target outcome

`durable runs + explicit sync jobs + idempotent delivery ledger`

### Why this wave is next

1. The current alpha already has enough product surface.
2. The largest architectural weakness is durability, not missing screens.
3. Pilot-grade trust requires that runs, jobs, and deliveries survive process restarts and partial failures.

### Current state

1. AI runs now persist in Prisma through `AiRunLedger`, not only in `.ceoclaw-cache`.
2. Mock-mode run progression no longer depends on in-memory adapter state to build traceable operator runs.
3. Existing `POST /api/ai/runs`, `GET /api/ai/runs/:id`, `POST /api/ai/runs/:id/proposals/:proposalId/apply`, and `GET /api/ai/runs/:id/trace` now read from the durable ledger when `DATABASE_URL` is configured.
4. File-backed run storage remains only as a fallback when no database is configured.
5. Outbound Telegram, email, and scheduled digest flows now persist delivery attempts in `DeliveryLedger`, reuse idempotency keys, and expose retry posture plus per-target execution state in the operator UI.
5. `GET /api/evidence` and `GET /api/escalations` are now read-only views over persisted derivation, with explicit `POST /api/evidence/sync` and `POST /api/escalations/sync` job boundaries and operator-visible freshness metadata.
6. Work-report writes now trigger narrow evidence sync jobs, and signal-packet / proposal-apply flows trigger narrow escalation sync jobs without recreating truth during reads.

## Wave 8: Source-of-Truth Depth

**Mode:** Sequential by default. Limited worker help only after schema and matching rules are fixed by the lead session.

### Sessions

1. Session 30: GPS Telemetry Domain Expansion
   Status: complete on 2026-03-12 in the lead branch.
2. Session 31: 1C Financial Truth Deepening
   Status: complete on 2026-03-12 in the lead branch.
3. Session 32: Reconciliation Casefile and Fact Linking
   Status: complete on 2026-03-12 in the lead branch.

### Goals

1. Expand GPS and 1C from narrow sample reads into deeper truth domains.
2. Link finance, telemetry, work reports, and visual evidence through deterministic reconciliation.
3. Turn mismatches into inspectable casefiles instead of hiding them inside rollups.

### Target outcome

`telemetry depth + finance depth + linked reconciliation casefiles`

### Why this wave follows Wave 7

1. Deeper truth is more valuable after runtime state is durable.
2. Reconciliation logic becomes safer once jobs and traces are persisted.
3. This is the wedge that best fits construction and infrastructure pilots.

## Wave 9: Pilot-Grade Operatorization

**Mode:** Lead-first sequencing with selective worker help for isolated UI and export surfaces.

### Sessions

1. Session 33: Executive Command Center and Exception Inbox
   Status: complete on 2026-03-12 in the lead branch.
2. Session 34: Audit Pack and Operational Exports
   Status: complete on 2026-03-12 in the lead branch.
3. Session 35: Pilot Controls and Tenant Readiness
   Status: complete on 2026-03-12 in the lead branch.

### Goals

1. Unify operator control around exceptions, owners, and follow-through.
2. Produce audit-friendly packs that explain evidence, decisions, and applied changes.
3. Make the product safer to run for real pilots across tenants, workspaces, and environments.

### Target outcome

`operator command center + audit packs + tenant-safe pilot controls`

### Why this wave comes last

1. It productizes the trust layers built in Waves 7 and 8.
2. It turns the system from a strong alpha into a pilot-grade operating layer.
3. It avoids polishing operator UX before the underlying truth and runtime are strong enough.

## Wave 10: Pilot Feedback and Go-Live Readiness

**Mode:** Lead-first sequencing with selective worker help for isolated read-only readiness and review surfaces after Session 36 lands.

### Sessions

1. Session 36: Pilot Feedback Ledger and Resolution Loop
   Status: complete on 2026-03-12 in the lead branch.
2. Session 37: Tenant Readiness and Cutover Checklist
   Status: complete on 2026-03-12 in the lead branch.
3. Session 38: Pilot Review Scorecards and Governance Export
   Status: complete on 2026-03-12 in the lead branch.

### Goals

1. Turn pilot feedback into durable product truth instead of off-platform chat fragments.
2. Make tenant cutover readiness and live blockers explicit before wider rollout.
3. Produce recurring review artifacts that quantify pilot health across feedback, delivery, freshness, and exceptions.

### Target outcome

`pilot feedback ledger + go-live readiness checklist + weekly review scorecards`

### Why this wave follows Wave 9

1. Pilot controls and audit packs are useful only if real pilot feedback is captured against them.
2. A narrow readiness surface is safer than a broad multi-tenant control plane rewrite.
3. Review scorecards should be built only after runtime, command, audit, and rollout posture are already explicit.

## Wave 11: Governance Automation and Controlled Widening

**Mode:** Lead-first sequencing with selective worker help now allowed only inside isolated follow-up zones because Session 39 and Session 40 fixed the governance cadence and decision boundaries.

### Sessions

1. Session 39: Governance Review Scheduling and Delivery
   Status: complete.
2. Session 40: Cutover Decision Register and Warning Waivers
   Status: complete.
3. Session 41: Tenant Onboarding Runbook and Rollout Templates
   Status: complete.
4. Session 42: Tenant Rollout Packet and Handoff Export
   Status: complete.

### Goals

1. Turn pilot review from an on-demand export into a recurring governed delivery loop.
2. Make cutover approvals, accepted warnings, and reversals durable instead of implicit.
3. Make the next tenant rollout repeatable without reopening a broad tenant-admin rewrite.

### Target outcome

`scheduled governance review + explicit cutover decisions + repeatable tenant widening handoff`

### Why this wave follows Wave 10

1. The scorecard/export from Wave 10 should become a recurring operating artifact before new pilot widening starts.
2. Tenant readiness and pilot review now exist, so the next gap is durable decision capture rather than more read-only surfaces.
3. Repeatable onboarding should come only after governance cadence and cutover acceptance are explicit.

## 6. Technical Tracks

### Track A: Stability and Platform

Includes:
- build;
- test hygiene;
- schema changes;
- auth and policy;
- production mode;
- error handling;
- audit.

### Track B: Fact Layer

Includes:
- imports;
- work reports;
- connectors;
- normalization;
- validation.

### Track C: Agent Layer

Includes:
- proposals;
- apply flow;
- alerts;
- briefs;
- recommendation payloads.

### Track D: Product Surface

Includes:
- routes;
- dashboards;
- operational views;
- integration status views;
- role-based interfaces.

### Track E: Evidence and Runtime Modernization

Includes:
- telemetry reads;
- evidence ledger;
- verification state;
- AI traces;
- provenance;
- eval harnesses.

## 7. Architecture Milestones

### Milestone A

`repo stable + explicit demo mode + testable import service`

### Milestone B

`facts can enter + briefs can be generated + actions can be proposed`

### Milestone C

`field reports + connector framework + new operating UI`

### Milestone D

`workspace-aware platform + plan-vs-fact + financial signals`

### Milestone E

`vertical pilot with one real integration and one daily operating loop`

### Milestone F

`verified telemetry facts + evidence status + traceable agent runs`

### Milestone G

`durable workflow state + explicit sync jobs + auditable outbound execution`

### Milestone H

`deeper telemetry and finance truth + linked reconciliation casefiles`

### Milestone I

`pilot-grade operator control + auditability + tenant-safe rollout posture`

### Milestone J

`durable pilot feedback + explicit tenant readiness + recurring pilot review scorecards`

### Milestone K

`scheduled governance reviews + durable cutover decisions + repeatable tenant widening`

## 8. Rules for Parallel Sessions

1. Never run parallel sessions before Wave 0 is closed.
2. Never let more than one session edit `prisma/schema.prisma` in the same wave.
3. Never let more than one session rewrite the same API subtree.
4. Each session works only inside its allowed file list.
5. Every session must return:
   - changed files;
   - tests run;
   - blockers;
   - assumptions;
   - what the integration session must do next.

## 9. Recommended Working Agreement

### My role

I should remain the coordinating session:
- define wave order;
- adjust prompts when repo reality changes;
- integrate and verify;
- handle cross-cutting refactors;
- decide when parallel work is safe.

### Your role

You decide how much concurrency to fund with attention and time:
- one session if you want low-risk steady progress;
- three sessions if you want faster throughput after Wave 0.

### Worker session role

A worker session should:
- receive exactly one prompt file;
- touch only allowed files;
- avoid opportunistic refactors;
- stop at domain boundary instead of leaking into another track.

## 10. Practical Recommendation

### Best option right now

1. Keep Sessions 01 through 42 as the locked lead-branch baseline.
2. Close Wave 11 canonically now that governance review delivery, cutover decisions, onboarding runbooks, and rollout handoff export all exist on the lead branch.
3. Define Wave 12 only after reviewing where the new rollout packet still leaves real operator friction or truth gaps.

### Why this is best

Because the product already has enough surface area for an alpha. The next meaningful gain is durable operational trust:

- trustworthy evidence;
- trustworthy provenance;
- trustworthy enterprise reads;
- trustworthy operator control;
- trustworthy execution state.

That is more valuable now than broadening the UI or adding another shallow connector.

## 11. Immediate Next Actions

1. Keep Wave 0 closed and stable; it is no longer the active bottleneck.
2. Keep Sessions 01 through 42 as the locked baseline.
3. Mark Wave 11 complete in all planning artifacts because the bounded governance loop is now in place end to end:
   - recurring pilot-review delivery;
   - explicit cutover approvals, waivers, and rollbacks;
   - persisted onboarding runbooks;
   - deterministic rollout packet and handoff export.
4. Define Wave 12 only after deciding which post-Wave 11 bottleneck deserves the next canonical slice.

## 12. Definition of Alpha

Alpha is reached when:
- imports work;
- work reports work;
- executive brief works;
- AI proposals can be approved and applied;
- connector registry exists;
- workspace and policy are real;
- plan-vs-fact exists;
- one vertical pilot scenario can be demonstrated end to end.

Current status:
- this alpha threshold is already met on the lead branch;
- the active target is now post-alpha modernization, not alpha assembly.

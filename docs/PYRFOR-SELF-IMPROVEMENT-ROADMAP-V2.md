# Pyrfor Self-Improvement Roadmap V2

**Status:** governance-aligned implementation roadmap  
**Applies to:** `docs/PYRFOR-SELF-IMPROVEMENT-ARCHITECTURE.md`  
**Baseline:** Pyrfor v0.3.0 Universal Engine, Algorithmic Governance Layer, Memory v2, ApprovalFlow, MetaCritic, CompletionGate

---

## 1. Purpose

This roadmap turns the self-improvement proposal into an implementation plan that preserves Pyrfor's core invariant:

> Self-improvement extends the Universal Engine; it never creates a second planner, memory system, ledger, approval system, or governance plane.

The target is a closed loop:

`postmortem → approved memory/lessons → governed experience retrieval → planner improvement → mined proposals → MetaCritic/ApprovalFlow → verified change → rollback-capable audit trail`.

---

## 2. Canonical Data Flow

```text
Agent run
  → RunPostMortem artifact
  → Historian distillation
  → Memory v2 approval pipeline
       imported → quarantined → approved | rejected
  → ExperienceLibrary read-projection
       approved && !legacy && !quarantined && project-scoped
  → Planner context
       patterns + antipatterns + lessonsConsidered[]
  → PatternMiner / Optimizer
       meta.improvement concept, self_improvement budget scope
  → MetaCritic
       existing ImprovementProposal + eval_proof + rollback_plan
  → ApprovalFlow / CompletionGate
       DecisionRecord + gate result
  → Applied change or escalation
```

No component in this flow may write directly into planner-visible memory or bypass Memory v2 approval state.

---

## 3. Milestones

| # | Milestone | Depends on | Output |
|---|---|---|---|
| SI1 | Historian tag audit | v0.3.0 Memory v2 | Approved lessons carry enough provenance for retrieval/mining |
| SI2 | ExperienceLibrary read-projection | SI1 | FTS5-first, project-scoped library over MemoryStore + ArtifactStore |
| SI3 | Planner injection | SI2 | Patterns/antipatterns injected with `lessonsConsidered[]` DecisionRecord evidence |
| SI4 | Self-improvement budget scope | v0.3.0 budget controller | `BudgetScope='self_improvement'`, caps, cost circuit breaker |
| SI5 | PatternMiner as governed concept | SI3, SI4 | Algorithm 1 success-pattern extraction, holdout eval, MetaCritic proposals |
| SI6 | Optional local embeddings | SI2 | Feature-flagged local backend with non-regression vs FTS5 |
| SI7 | Optimizer specializations | SI5 | Prompt/tool/skill/strategy optimizers as `meta.improvement` concept types |
| SI8 | M15 SelfModificationEngine shell | SI7 | Proposal-only meta-optimization with ApprovalFlow, rollback, circuit breaker |

---

## 4. SI1 — Historian Tag Audit

**Goal:** ensure the existing postmortem → Historian → Memory v2 path emits enough metadata for safe retrieval and mining.

**Required tags on approved lessons:**

- `projectId`
- `domain`
- `toolSignatures[]`
- `verifierScore`
- `acceptanceTestPassRate`
- `sourceRunId`
- `conceptId`
- `parentConceptId?`
- `retryOf?`
- `artifactIds[]`
- `approvalState`
- `legacy`
- `quarantined`
- `provenance`

**Acceptance criteria:**

- Approved lessons contain all required tags.
- Quarantined/rejected/legacy lessons are never planner-visible.
- Contradictions are surfaced as review items, not silently overwritten.
- Existing tests cover imported → quarantined → approved/rejected transitions.
- DecisionRecord and CompletionGate evidence are present for tag-affecting changes.

---

## 5. SI2 — ExperienceLibrary Read-Projection

**Goal:** implement `experience-library.ts` as a rebuildable read-projection over MemoryStore + ArtifactStore.

**Rules:**

- No `ingest(postmortem)` API.
- No direct planner-visible writes.
- Default retrieval backend is FTS5 + keywords + tool signatures.
- Embeddings are not required for v1.
- Every planner query filters:

```sql
project_id = :projectId
AND approval_state = 'approved'
AND legacy = 0
AND quarantined = 0
```

**Acceptance criteria:**

- `queryForPlanner()` cannot return unapproved, legacy, rejected, quarantined, or cross-project entries.
- Projection can be rebuilt from canonical storage.
- Runtime SQLite migration follows the existing `memory-store.ts` path.
- Tests cover domain, tool signature, outcome, project scope, approval state, and FTS5 search.
- API uses explicit `schemaVersion`.

---

## 6. SI3 — Planner Injection

**Goal:** planner uses approved experience without losing auditability.

**Implementation shape:**

- Query ExperienceLibrary before plan generation.
- Inject `patterns`, `antipatterns`, and `similarRuns`.
- Record `lessonsConsidered[]` in DecisionRecord with provenance and decision impact.
- CompletionGate verifies that consequential planner decisions include lesson evidence or an explicit "no relevant lessons" artifact.

**Acceptance criteria:**

- Planner context receives only approved project-scoped entries.
- DecisionRecord includes `lessonsConsidered[]`.
- Post-run report can show which lessons affected planning.
- Regression tests prove no lesson injection happens when all candidates are quarantined/rejected.

---

## 7. SI4 — Self-Improvement Budget Scope

**Goal:** prevent unbounded optimizer/miner cost.

**Required controls:**

- Add `BudgetScope='self_improvement'`.
- Add global cap for self-improvement work.
- Add per-run cap for PatternMiner and each optimizer specialization.
- Add cost-overrun circuit breaker.
- Attribute all LLM calls from SI2-SI8 to this scope.

**Acceptance criteria:**

- PatternMiner cannot start without a declared budget.
- Exhausted `self_improvement` scope blocks new `meta.improvement` concepts.
- Cost overrun freezes the self-improvement loop and emits ApprovalFlow escalation.
- Budget tests cover normal usage, exhaustion, and overrun.

---

## 8. SI5 — PatternMiner as Governed Concept

**Goal:** implement the first mining loop without autonomous mutation.

**Scope for v1:**

- Algorithm 1 only: success pattern extraction.
- No failure-pair correction yet.
- No prompt variant generation yet.
- Output is an existing MetaCritic `ImprovementProposal`.
- Proposal contains evidence, `eval_proof`, and `rollback_plan`.

**Evaluation rules:**

- Time-based holdout split by `created_at`.
- Per-domain stratification.
- `pattern_seed` isolation: holdout-derived patterns are excluded from training.
- Composite score includes verifier score, acceptance tests, rollback risk, and cost.

**Acceptance criteria:**

- Miner extracts patterns from at least three approved similar successful runs.
- Holdout data is never used for pattern extraction.
- `pyrfor optimize --domain <domain> --dry-run --evidence` shows proposal, evidence, budget, and holdout result.
- MetaCritic rejects proposals without evidence, eval proof, or rollback plan.

---

## 9. SI6 — Optional Local Embedding Backend

**Goal:** add semantic retrieval without sacrificing offline-first behavior.

**Rules:**

- Feature flag default: off.
- Local-only backend by default.
- FTS5 remains the baseline and fallback.
- Embedding provider/network access requires explicit operator approval.

**Acceptance criteria:**

- Holdout evaluation proves non-regression vs FTS5 baseline.
- Embedding calls are budgeted under `self_improvement`.
- If embeddings fail, retrieval falls back to FTS5 with an explicit warning/evidence artifact.

---

## 10. SI7 — Optimizer Specializations

**Goal:** add governed optimizer concept types.

**Specializations:**

- `prompt_engineer`
- `tool_smith`
- `skill_architect`
- `strategy_planner`
- `quality_auditor` (report-only)
- `cost_auditor` (report-only)

**NeverEditableByOptimizer:**

- verifier rules
- sandbox tier
- taint scanners
- prompt-injection detectors
- kill switch
- ApprovalFlow thresholds
- policy approval gates
- budget approval gates
- NeverGrandfatheredGate
- MetaCritic auto-apply rules
- EffectGateway allowlists

**Acceptance criteria:**

- Optimizer runs are `meta.improvement` concepts, not daemon tasks.
- All proposals go through MetaCritic.
- Tests prove attempts to edit `NeverEditableByOptimizer` controls are rejected.
- IDE OptimizerPanel shows activity, before/after metrics, rollback status, and human override actions.

---

## 11. SI8 — M15 SelfModificationEngine Shell

**Goal:** enable meta-optimization as governed proposals only.

**Required artifacts per meta-change:**

- `governance_adjustment_proposal`
- `eval_proof`
- `rollback_plan`
- `decision_record`
- `completion_gate_result`

**Circuit breaker:**

- Freeze after consecutive failed meta-changes.
- Freeze on cost overrun.
- Freeze on attempted edit of `NeverEditableByOptimizer`.
- Escalate all freezes to ApprovalFlow.

**Acceptance criteria:**

- `SelfModificationEngine.metaOptimize()` enqueues a governed `system_self_improvement` concept.
- No L4 change auto-applies without MetaCritic + ApprovalFlow + CompletionGate.
- Human can inspect, approve, reject, or rollback every meta-change.
- Audit trail links optimizer metrics → proposal → eval proof → approval → applied diff/rollback.

---

## 12. Shared Acceptance Gates

Every milestone must satisfy:

- DecisionRecord present for consequential choices.
- CompletionGate passed.
- Rollback artifact present for any applied change.
- `lessonsConsidered[]` present where retrieval or historical evidence was used.
- Budget attributed to `self_improvement` where LLM/model calls occur.
- New module tests target high coverage, with explicit negative tests for approval/provenance bypass.
- Documentation explains operator-visible behavior and failure modes.

---

## 13. Risks and Controls

| Risk | Control |
|---|---|
| Memory poisoning | Library is read-projection over approved Memory v2 entries only |
| Shadow governance | Optimizers execute as Universal Engine concepts |
| Reward hacking | Composite metrics; verifier score never optimized alone |
| Train/test leakage | Time-based holdout, domain stratification, pattern seed isolation |
| Cost runaway | `self_improvement` scope, caps, circuit breaker |
| Verifier-rule editing | `NeverEditableByOptimizer` enforced in code |
| Cross-project leakage | Project-scoped retrieval by default |
| Rollback gaps | Rollback plan artifact required before application |

---

## 14. Out of Scope for V1

- Cross-tenant experience sharing.
- Online reinforcement learning.
- Autonomous verifier-rule editing.
- Autonomous policy/budget/sandbox changes.
- Optimizer edits to optimizer-governance without human approval.
- Network embedding providers by default.

---

## 15. First Implementation Target

Start with **SI1 + SI2**. They deliver immediate planner value while preserving the v0.3.0 safety model:

1. Audit Historian tags.
2. Add the read-only ExperienceLibrary projection.
3. Prove unapproved/quarantined/cross-project memory cannot enter planner context.
4. Only then add planner injection in SI3.

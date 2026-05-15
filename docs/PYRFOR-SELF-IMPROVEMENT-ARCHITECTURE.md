# Pyrfor: Architecture of Self-Improvement — The Learning OS

**Date:** 2026-05-15
**Status:** PROPOSAL — governance-aligned revision for review & Copilot implementation
**Dependencies:** PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md (§2.3 P2-1, §1 Self-improving loop principle), Pyrfor v0.3.0 Algorithmic Governance Layer, Memory v2, ApprovalFlow, MetaCritic, NeverGrandfatheredGate

---

## 0. Executive Summary

**Current state:** Pyrfor has the best foundation for self-improvement among 22+ OSS projects — postmortem phase, trajectory recorder, meta-critic, incident packets. But the loop is OPEN: postmortem is written but never used for automatic system improvement.

**Goal:** Make Pyrfor the world's first **self-improving agent operating system** — a closed-loop system where every run can make the next run better, without human intervention for routine optimizations.

**Hard constraint:** self-improvement is not a new control plane. All learning, mining, optimizer, and self-modification work must execute through the same PlanGraph, EventLedger, ArtifactStore, ApprovalFlow, MetaCritic, CompletionGate, and Memory v2 rules that govern normal Pyrfor runs.

**Inspiration:** SiriuS (experience library, +21.88%), Escher-Loop (dual-population coevolution), Self-Improving Coding Agent (code self-modification, +36pp SWE-bench), Hyperagents (meta-meta improvement), ReflexiCoder (internal self-correction).

---

## 1. Architecture Overview

### 1.0 Source of Truth

Pyrfor already has canonical runtime primitives. This architecture extends them; it must not fork them:

| Concern | Canonical primitive | Self-improvement usage |
|---|---|---|
| Execution | `UniversalEngineOrchestrator` + PlanGraph | Optimizer and miner runs are `meta.improvement` / `system_self_improvement` concepts |
| Event history | EventLedger | Every learning/optimization decision emits auditable events |
| Artifacts | ArtifactStore | Postmortems, lessons, proposals, eval proofs, rollback plans |
| Memory | Memory v2 / MemoryFacade | Planner sees only approved, non-legacy, non-quarantined, project-scoped lessons |
| Approval | ApprovalFlow | Human-gated policy, budget, verifier, sandbox, and safety changes |
| Promotion | MetaCritic | Only existing `ImprovementProposal` contract is valid |
| Completion | CompletionGate + DecisionRecord | Consequential changes require decision records and gate artifacts |

```
┌──────────────────────────────────────────────────────────────────┐
│                    PYRFOR SELF-IMPROVEMENT OS                    │
│                                                                  │
│  ┌─────────┐   ┌──────────┐   ┌───────────┐   ┌──────────────┐ │
│  │  AGENT  │──▶│ POSTMORT │──▶│EXPERIENCE │──▶│  OPTIMIZER   │ │
│  │  RUN    │   │  PHASE   │   │  LIBRARY  │   │    AGENT     │ │
│  │         │   │          │   │ (SiriuS)  │   │ (Escher-Loop)│ │
│  └─────────┘   └──────────┘   └───────────┘   └──────────────┘ │
│                     │                │                 │          │
│                     ▼                ▼                 ▼          │
│              ┌──────────┐   ┌───────────┐   ┌──────────────┐    │
│              │INCIDENT  │   │  PATTERN  │   │ SELF-MODIFY  │    │
│              │ PACKETS  │   │  MINING   │   │   ENGINE     │    │
│              └──────────┘   └───────────┘   └──────────────┘    │
│                                                   │              │
│                     ┌─────────────────────────────┘              │
│                     ▼                                            │
│              ┌──────────┐   ┌───────────┐   ┌──────────────┐    │
│              │  SKILL   │   │  PROMPT   │   │  TOOL CONFIG │    │
│              │  UPDATE  │   │  OPTIMIZE │   │    TUNING    │    │
│              └──────────┘   └───────────┘   └──────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              GOVERNANCE LAYER (always ON)                │    │
│  │  PlanGraph → EventLedger → ApprovalFlow → Rollback       │    │
│  │  → CompletionGate → Human Override                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                META-META LAYER (Hyperagents)              │    │
│  │    The optimizer's own strategies are themselves          │    │
│  │    open to optimization. Self-referential improvement.    │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. What Pyrfor Already Has (Foundation)

### 2.1 Postmortem Phase (`postmortem.ts` — 113 lines)

```
RunPostMortem {
  schemaVersion: 'pyrfor.postmortem.v1'
  outcome: completed | failed | cancelled | blocked
  whatWorked: string[]         ← patterns to reinforce
  whatFailed: string[]         ← patterns to avoid
  reusablePatterns: string[]   ← extractable strategies
  memoryWriteRecommendations[] ← what to persist to memory
  verifierFindings: string[]   ← quality gate results
  toolsUsed/toolsForged[]      ← tool usage patterns
}
```

**Current usage:** Written as artifact, logged to ledger. **NOT queried, NOT mined.**

### 2.2 MetaCritic (`meta-critic.ts` — 415 lines)

```
MetaCritic {
  run(input) → { evaluated, promoted, quarantined, escalated }
  // Evaluates DoubleLoopRecords against acceptance tests
  // Promotes: algorithm, heuristic (autonomous)
  // Escalates: policy, budget, verifier_rules (human-required)
}
```

**Current usage:** Reactive — waits for DoubleLoopRecords to be submitted. **NOT proactive, doesn't generate its own proposals.**

### 2.3 Trajectory Recorder (`trajectory.ts` — 467 lines)

Full event-by-event capture of every run. **Currently write-only — not searched or mined for patterns.**

### 2.4 Engine Loop (`engine-loop.ts` — 1419 lines)

Complete lifecycle: plan → research → execute → critique → postmortem → memory_persist. **Postmortem outputs are terminal — no feedback path to next run.**

### 2.5 Memory System (SQLite+FTS5)

Structured memory with wiki/rollup. **Doesn't auto-extract patterns from postmortems.**

### 2.6 Governance Substrate (v0.3.0)

Already available and mandatory for this architecture:

- Memory v2 approval states: imported → quarantined → approved/rejected
- Provenance tags on imported memory
- Contradiction detection without silent overwrite
- ApprovalFlow and MetaCritic promotion contracts
- DecisionRecord + CompletionGate artifacts for consequential choices
- NeverGrandfatheredGate for non-waivable safety controls

Self-improvement must reuse these primitives instead of introducing parallel storage, scheduler, approval, or promotion contracts.

---

## 3. The Gap: Open Loop → Closed Loop

```
CURRENT (open loop):
  Run → PostMortem (write) → END
                              ↑
                         nothing reads it

TARGET (closed loop):
  Run → PostMortem → Mine → Optimize → Next Run is better → ...
```

**Four missing components:**

| # | Component | Inspiration | Function |
|---|---|---|---|
| L1 | **Experience Library** | SiriuS | Governed read-projection over approved lessons and postmortem artifacts, queryable by task similarity |
| L2 | **Pattern Miner** | DSPy | Auto-extracts reusable patterns from successful runs; failure anti-patterns from failed runs |
| L3 | **Optimizer Agent** | Escher-Loop | `meta.improvement` concepts that read library, propose improvements, run acceptance tests |
| L4 | **Self-Modification Engine** | Self-Improving Coding Agent + Hyperagents | Applies approved improvements to skills/prompts/tools/configs |

---

## 4. Level 1: Experience Library (SiriuS-inspired)

### 4.1 Concept

The Experience Library is a **governed read-projection**, not a new write store. It projects already-approved Memory v2 lessons and ArtifactStore postmortems into a retrieval shape that the planner can query. When a new task arrives, the system finds the N most similar past tasks and their outcomes, injecting only approved, non-legacy, non-quarantined, project-scoped strategies into the new run's planning phase.

Direct `ingest(postmortem)` is intentionally forbidden: postmortem output first flows through Historian + Memory v2 approval/quarantine/rejection/provenance, then the library reads the approved projection.

### 4.2 Data Model

```typescript
// packages/engine/src/runtime/universal/experience-library.ts

interface ExperienceEntry {
  id: string;
  runId: string;
  conceptId: string;
  projectId: string;
  schemaVersion: 'pyrfor.experience.v1';

  approvalState: 'approved' | 'quarantined' | 'rejected';
  legacy: boolean;
  quarantined: boolean;
  provenance: {
    sourceRunId: string;
    conceptId: string;
    parentConceptId?: string;
    retryOf?: string;
    memoryEntryIds: string[];
    artifactIds: string[];
  };
  
  // Task fingerprint (FTS5-first; embeddings are optional and local-only by default)
  retrievalKey: {
    fts: string;
    goalKeywords: string[];
    toolSignatures: string[];
    embedding?: number[];          // feature-flagged local embedder only
  };
  domain?: string;                 // 'coding' | 'infra' | 'research' | 'ops'
  
  // Outcomes
  outcome: 'completed' | 'failed' | 'cancelled' | 'blocked';
  whatWorked: string[];
  whatFailed: string[];
  reusablePatterns: string[];
  
  // Metrics
  durationMs: number;
  toolCallCount: number;
  costUsd: number;
  verifierScore?: number;          // 0-1 from quality gates
  
  // Self-improvement signals
  wasPatternApplied: boolean;      // was a previous pattern used?
  patternEffectiveness?: number;   // 0-1 if pattern was used
  
  createdAt: string;
  indexedAt: string;
}

interface ExperienceQuery {
  goal?: string;                   // text → FTS5/keyword/tool search; embedding only if enabled
  projectId: string;
  domain?: string;
  toolSignatures?: string[];
  minVerifierScore?: number;
  outcome?: ExperienceEntry['outcome'];
  limit?: number;                  // default 5
  includeFailed?: boolean;         // whether to include failed runs
  audience: 'planner' | 'audit' | 'operator';
  retrievalBackend?: 'fts' | 'embedding'; // default: 'fts'
}
```

### 4.3 API

```typescript
interface ExperienceLibrary {
  // Read-only projection over MemoryStore + ArtifactStore.
  // No direct writes are allowed.
  query(q: ExperienceQuery): Promise<ExperienceEntry[]>;
  
  // Planner-safe read path: approved && !legacy && !quarantined && project-scoped.
  queryForPlanner(q: Omit<ExperienceQuery, 'audience'>): Promise<ExperienceEntry[]>;
  
  // Analytics
  getPatternEffectiveness(patternKey: string): Promise<number>;   // 0-1
  getTopPatterns(domain: string, limit: number): Promise<PatternStat[]>;
  
  // Similarity
  findSimilar(q: { goal: string; projectId: string; limit: number }): Promise<ExperienceEntry[]>;
}
```

### 4.4 Storage

**SQLite projection table** (inside existing memory database, migrated through the existing `runtime/memory-store.ts` migration path, not Prisma). It is rebuildable from MemoryStore + ArtifactStore and must not be the source of truth:

```sql
CREATE TABLE experience_library (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  approval_state TEXT NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0,
  quarantined INTEGER NOT NULL DEFAULT 0,
  provenance_json TEXT NOT NULL,
  goal_embedding BLOB,           -- float32 array, serialized
  goal_keywords TEXT,            -- JSON array
  tool_signatures TEXT,          -- JSON array
  domain TEXT,
  outcome TEXT NOT NULL,
  what_worked TEXT,              -- JSON array
  what_failed TEXT,              -- JSON array
  reusable_patterns TEXT,        -- JSON array
  duration_ms INTEGER,
  tool_call_count INTEGER,
  cost_usd REAL,
  verifier_score REAL,
  was_pattern_applied INTEGER DEFAULT 0,
  pattern_effectiveness REAL,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL,
  CHECK (approval_state IN ('approved', 'quarantined', 'rejected'))
);

-- FTS5 for keyword search
CREATE VIRTUAL TABLE experience_fts USING fts5(
  goal_keywords,
  what_worked,
  what_failed,
  reusable_patterns,
  content='experience_library',
  content_rowid='rowid'
);

-- Index for similarity queries
CREATE INDEX idx_experience_project_domain_outcome ON experience_library(project_id, domain, outcome);
CREATE INDEX idx_experience_approval ON experience_library(approval_state, legacy, quarantined);
CREATE INDEX idx_experience_verifier ON experience_library(verifier_score);
CREATE INDEX idx_experience_created ON experience_library(created_at);
```

Planner-facing queries must always include:

```sql
WHERE project_id = :projectId
  AND approval_state = 'approved'
  AND legacy = 0
  AND quarantined = 0
```

### 4.5 Integration Point

In `engine-loop.ts`, **before** the `plan` phase:

```typescript
// NEW: Query governed experience projection before planning
const similar = await experienceLibrary.findSimilar({ goal, projectId, limit: 5 });
const patterns = similar
  .filter(e => e.outcome === 'completed')
  .flatMap(e => e.reusablePatterns);
const antipatterns = similar
  .filter(e => e.outcome === 'failed')
  .flatMap(e => e.whatFailed);

// Inject into planner context
plannerContext.experience = { patterns, antipatterns, similarRuns: similar };
plannerContext.lessonsConsidered = similar.map(e => ({
  experienceId: e.id,
  provenance: e.provenance,
  decisionImpact: 'planner_context_injection',
}));
```

**After** postmortem, no direct library write occurs. The flow is:

`postmortem artifact → Historian distillation → Memory v2 quarantine/approval → ExperienceLibrary projection rebuild`.

---

## 5. Level 2: Pattern Miner (DSPy-inspired)

### 5.1 Concept

Runs as a governed `meta.improvement` concept over the Experience Library projection to extract generalizable patterns, optimize prompt templates, and generate existing MetaCritic `ImprovementProposal` artifacts. It is budget-gated, project-scoped, and never executes as an unbounded daemon.

### 5.2 Architecture

```typescript
// packages/engine/src/runtime/universal/pattern-miner.ts

interface PatternMinerConfig {
  minSamplesForPattern: number;    // default 3 — need 3 similar successes
  minEffectivenessForPromotion: number; // default 0.7
  maxPatternsPerRun: number;        // default 5
  projectId: string;
  budgetScope: 'self_improvement';
  maxCostUsd: number;
  holdoutPercent: number;           // time-based holdout, default 20
  runTrigger: 'manual' | 'threshold' | 'scheduled_request'; // trigger only enqueues governed concept
}

interface MinedPattern {
  id: string;
  patternKey: string;              // unique key for dedup
  description: string;             // human-readable
  template: string;                // code/prompt template
  applicabilityScore: number;      // 0-1 how likely this applies to new task
  evidenceEntries: string[];       // experience entry IDs that support this
  holdoutEntries: string[];        // entries used only for evaluation
  patternSeedId: string;           // train/holdout isolation key
  antiPatternOf?: string;          // if this is a correction of a known antipattern
  proposedChange: {
    type: 'prompt_template' | 'tool_config' | 'skill_rule' | 'strategy';
    target: string;                // which prompt/tool/skill
    before: string;
    after: string;
    reasoning: string;
  };
}

interface PatternMiner {
  mine(): Promise<MinedPattern[]>;
  evaluatePattern(pattern: MinedPattern): Promise<{
    verifierScoreDelta: number;
    acceptanceTestPassRate: number;
    rollbackRisk: number;
    costPerCompletedConceptDelta: number;
  }>;
  submitToMetaCritic(pattern: MinedPattern): Promise<ImprovementProposal>;
}
```

### 5.3 Mining Algorithms

**Algorithm 1: Success Pattern Extraction**
```
Input: N most recent successful runs in same domain
Output: Common whatWorked entries → generalized patterns

1. Group approved successful experiences by project + domain + tool signatures
2. Reserve the most recent holdoutPercent entries by created_at as holdout
3. Cluster whatWorked entries by FTS5/keyword/tool-signature similarity
3. For clusters with ≥ minSamplesForPattern:
   - Generate generalized pattern via LLM summarization
   - Create template with placeholders
4. Evaluate only on holdout entries; never train on holdout
5. If composite effectiveness ≥ minEffectivenessForPromotion → submit to MetaCritic with eval_proof + rollback_plan
```

**Algorithm 2: Failure Pattern Correction**
```
Input: Failed runs + their subsequent successful re-runs
Output: Anti-patterns + suggested fixes

1. Find pairs via ledger causality: failed run where later successful run has retryOf/parentConceptId link
2. Extract whatFailed from failed run
3. Find whatWorked from successful run that addresses that failure
4. Generate correction pattern
5. Submit to MetaCritic with higher scrutiny and no auto-apply
```

**Algorithm 3: Prompt Optimization (DSPy-style)**
```
Input: Completed experience entries with verifierScore
Output: Optimized prompt templates

1. For a given prompt template:
2. Collect N approved project-scoped runs using that template with verifierScore + acceptance_test_pass_rate + rollback_rate + cost_per_completed_concept
3. Generate bounded M prompt variants under BudgetScope='self_improvement'
4. Score variants against time-based held-out set
5. Select top variant
6. Submit as existing MetaCritic ImprovementProposal with eval_proof + rollback_plan
```

### 5.4 Execution Modes

```
MODE 1: Threshold request
  └─ After enough new approved entries exist, enqueue a governed meta.improvement concept

MODE 2: Scheduled request
  └─ Schedule may enqueue a request, but execution still passes ApprovalFlow/budget gates

MODE 3: Manual (CLI-triggered)
  └─ pyrfor optimize --domain coding --dry-run --evidence
```

---

## 6. Level 3: Optimizer Agent (Escher-Loop-inspired)

### 6.1 Concept

Optimizer Agents are not a separate runtime population or scheduler. Each optimizer run is a governed `meta.improvement` concept executed by `UniversalEngineOrchestrator`; the specialization is metadata on the concept, not a parallel control plane. Optimizers read the Experience Library projection, run Pattern Miner logic when needed, and generate concrete improvements as existing MetaCritic `ImprovementProposal` artifacts.

### 6.2 Architecture

```typescript
// packages/engine/src/runtime/universal/optimizer-agent.ts

interface OptimizerAgent {
  id: string;
  specialization: OptimizerSpecialization;
  conceptId: string;
  budgetScope: 'self_improvement';
  state: 'idle' | 'observing' | 'analyzing' | 'proposing' | 'verifying';
}

type OptimizerSpecialization = 
  | 'prompt_engineer'     // Optimizes prompt templates
  | 'tool_smith'          // Improves tool configurations
  | 'skill_architect'     // Creates/updates skills
  | 'strategy_planner'    // Improves planning strategies
  | 'quality_auditor'     // Reports verifier coverage gaps; cannot edit thresholds
  | 'cost_auditor';       // Reports cost/performance tradeoffs; cannot bypass budget approval

interface OptimizerRun {
  run(): Promise<OptimizerRunResult>;
}

interface OptimizerRunResult {
  agentId: string;
  specialization: OptimizerSpecialization;
  patternsAnalyzed: number;
  proposalsGenerated: number;
  proposalsAccepted: number;
  estimatedImprovementPercent: number;
  decisionRecordId: string;
  artifactIds: string[];
}
```

### 6.3 Optimizer Types

#### Prompt Engineer
```
Input: Experience library projection (approved, project-scoped)
Action:
  1. Find tasks where composite success metrics are below target
  2. Generate bounded prompt variants under self_improvement budget
  3. Score on time-based holdout data
  4. Submit best variant as existing MetaCritic ImprovementProposal
Output: Updated prompt templates
```

#### Tool Smith
```
Input: Experience library (filtered by tool signature)
Action:
  1. Find tools with high failure rate in postmortems
  2. Analyze failure patterns
  3. Propose tool configuration changes (timeouts, retries, fallbacks)
  4. Submit as ImprovementProposal with eval_proof + rollback_plan
Output: Updated tool configs
```

#### Skill Architect
```
Input: Experience library + current skill registry
Action:
  1. Find whatWorked patterns that aren't yet skills
  2. Generate SKILL.md for new skill
  3. Submit to skill registry via MetaCritic with provenance/evidence
Output: New or updated skills
```

#### Strategy Planner
```
Input: Experience library (outcome comparison)
Action:
  1. Compare runs: with-plan vs without-plan
  2. Measure plan accuracy vs actual execution
  3. Propose planning strategy improvements; never change safety/policy gates
Output: Updated planning heuristics
```

### 6.4 Governance for Optimizer

```
ALL optimizer proposals go through MetaCritic:
  - algorithm/heuristic proposals → autonomous only if eval_proof passes, rollback_plan is verified, and no NeverEditableByOptimizer item is touched
  - policy/budget proposals → always require human approval
  - verifier_rules proposals → draft-only human review + test run; never autonomous
  
Rollback:
  - Every applied change has a rollback plan
  - Rollback triggered if: 
    1. Next governed evaluation window shows regression in composite metrics
    2. Human rejects within rollback window
    3. Cost overrun or circuit breaker threshold is breached
  
Audit:
  - Who changed what, when, why
  - Before/after metrics comparison
  - Full trajectory of the optimizer's own decision process
```

### 6.5 NeverEditableByOptimizer

The following controls are never editable by optimizer agents, including `quality_auditor` and `cost_auditor`. Optimizers may report gaps and draft human-review proposals, but the runtime must reject any autonomous change touching:

```typescript
type NeverEditableByOptimizer =
  | 'verifier_rules'
  | 'sandbox_tier'
  | 'taint_scanners'
  | 'prompt_injection_detectors'
  | 'kill_switch'
  | 'approval_flow_thresholds'
  | 'approval_for_policy_gates'
  | 'approval_for_budget_gates'
  | 'never_grandfathered_gate'
  | 'meta_critic_auto_apply_rules'
  | 'effect_gateway_allowlists';
```

This list is enforced in code by the same tier/approval decision layer that enforces NeverGrandfatheredGate. It is not documentation-only.

### 6.6 Rollback and Circuit Breaker Artifacts

Any applied optimizer change must atomically persist a rollback artifact before application:

```typescript
interface RollbackPlan {
  schemaVersion: 'pyrfor.rollback_plan.v1';
  beforeStateSnapshotId: string;
  afterStateSnapshotId?: string;
  revertProcedure: string[];
  autoTriggerConditions: Array<{
    metric: 'verifierScore' | 'acceptanceTestPassRate' | 'rollbackRate' | 'costOverrun';
    comparator: '<' | '>' | '<=' | '>=';
    threshold: number;
  }>;
  escalationPath: 'approval_flow' | 'operator_console';
}

interface SelfImprovementCircuitBreaker {
  specialization?: OptimizerSpecialization;
  consecutiveFailures: number;
  costOverrunCount: number;
  frozen: boolean;
  lastEscalationArtifactId?: string;
}
```

MetaCritic rejects any proposal that lacks a rollback plan, cannot prove the rollback procedure, or would require editing a `NeverEditableByOptimizer` control.

---

## 7. Level 4: Self-Modification Engine

### 7.1 Concept

The optimizer's own strategies and algorithms are themselves open to governed optimization. This is meta-self-improvement — the system improves how it improves — but verifier thresholds, budget approval gates, sandbox tiers, safety scanners, and other `NeverEditableByOptimizer` controls remain outside autonomous scope.

### 7.2 Architecture

```typescript
interface SelfModificationEngine {
  // Enqueues a governed M15/system_self_improvement concept.
  metaOptimize(): Promise<SelfModificationResult>;
  
  // Track optimizer performance over time
  getOptimizerMetrics(): Promise<OptimizerMetrics[]>;
  
  // Evolve the optimization strategies
  evolveStrategy(strategyKey: string): Promise<StrategyRevision>;
}

interface SelfModificationResult {
  optimizerId: string;
  strategyChanged: string;       // what was modified
  beforeMetrics: OptimizerMetrics;
  afterMetrics: OptimizerMetrics;
  improvementProbability: number; // 0-1
  governanceAdjustmentProposalId: string;
  evalProofArtifactId: string;
  rollbackPlanArtifactId: string;
  approvalFlowDecisionId: string;
}
```

### 7.3 Meta-Optimization Loop

```
┌──────────────────────────────────────────────┐
│  META-LOOP (request may be time/run-count     │
│  triggered; execution is always governed)     │
│                                              │
│  1. Collect optimizer metrics                │
│     - Proposal acceptance rate               │
│     - Actual improvement vs predicted        │
│     - Rollback rate                          │
│     - Time-to-improvement                    │
│                                              │
│  2. Identify weakest optimizer               │
│     - Lowest acceptance rate → strategy issue │
│     - Highest rollback rate → quality issue   │
│     - Lowest predicted accuracy → model issue │
│                                              │
│  3. Generate meta-improvement proposal        │
│     - LLM proposes changes to optimizer      │
│     - Scored against held-out data           │
│     - Submitted as governance_adjustment     │
│       proposal + eval_proof + rollback_plan  │
│                                              │
│  4. Apply only after ApprovalFlow/MetaCritic  │
│     and circuit breaker checks               │
│     - If 3 consecutive meta-changes fail →   │
│       freeze, escalate to human              │
└──────────────────────────────────────────────┘
```

### 7.4 M15 Alignment

Every L4 change is an M15 `system_self_improvement` concept. Required artifacts:

- `governance_adjustment_proposal`
- `eval_proof`
- `rollback_plan`
- `decision_record`
- `completion_gate_result`

Meta-meta changes are proposal-only unless all gates pass and the change touches no `NeverEditableByOptimizer` item. If three consecutive meta-changes fail, or any cost-overrun circuit breaker fires, the self-improvement loop freezes and escalates to ApprovalFlow.

---

## 8. Implementation Phases

### Phase 1: Experience Library (L1)

**Files to create:**
- `packages/engine/src/runtime/universal/experience-library.ts` (~300 lines)
- `packages/engine/src/runtime/universal/__tests__/experience-library.test.ts` (~200 lines)
- Migration through existing runtime SQLite / `memory-store.ts` migration path

**Files to modify:**
- `engine-loop.ts` — integrate governed library query before plan phase
- `memory-store.ts` / Historian wiring — ensure approved lesson tags are projected
- `index.ts` — export new module

**Acceptance criteria:**
- [ ] ExperienceLibrary is read-only; no direct postmortem ingest path exists
- [ ] Planner reads only `approved && !legacy && !quarantined && project_id = currentProject`
- [ ] `findSimilar({ goal, projectId, limit })` returns relevant past runs using FTS5 baseline
- [ ] Planner context receives patterns/antipatterns from library
- [ ] Tests: query by domain, by tool signature, by outcome, similarity search
- [ ] DecisionRecord records `lessonsConsidered[]`
- [ ] CompletionGate passes with query/provenance artifacts present

### Phase 2: Pattern Miner (L2)

**Files to create:**
- `packages/engine/src/runtime/universal/pattern-miner.ts` (~400 lines)
- `packages/engine/src/runtime/universal/__tests__/pattern-miner.test.ts` (~250 lines)
- CLI: `apps/pyrfor-ide/web/src/lib/pattern-miner-api.ts`

**Files to modify:**
- `meta-critic.ts` — reuse existing `ImprovementProposal` contract for miner evidence
- `engine-loop.ts` — enqueue governed `meta.improvement` mining concepts
- `cli/commands/optimize.ts` — new CLI command
- `token-budget-controller.ts` — `BudgetScope='self_improvement'`

**Acceptance criteria:**
- [ ] Miner extracts patterns from ≥3 similar successful runs
- [ ] Patterns scored against time-based, domain-stratified holdout data
- [ ] `pyrfor optimize --domain coding --dry-run --evidence` shows proposed changes and evidence
- [ ] Proposals submitted to MetaCritic with evidence, eval_proof, rollback_plan
- [ ] Self-improvement budget scope is charged and enforced
- [ ] DecisionRecord present; CompletionGate passed; rollback artifact present
- [ ] Test coverage for new modules targets ≥90% statement/branch coverage

### Phase 3: Optimizer Agents (L3)

**Files to create:**
- `packages/engine/src/runtime/universal/optimizer-agent.ts` (~500 lines)
- `packages/engine/src/runtime/universal/optimizers/prompt-engineer.ts`
- `packages/engine/src/runtime/universal/optimizers/tool-smith.ts`
- `packages/engine/src/runtime/universal/optimizers/skill-architect.ts`
- `packages/engine/src/runtime/universal/optimizers/strategy-planner.ts`
- Tests for each

**Files to modify:**
- `meta-critic.ts` — support batch proposal review
- Approval/tier decision layer — enforce `NeverEditableByOptimizer`
- `gateway.ts` — register optimizer routes
- IDE: OptimizerPanel component

**Acceptance criteria:**
- [ ] 4 optimizer specializations running
- [ ] Optimizer runs are `meta.improvement` concepts, not a parallel scheduler
- [ ] Governed improvement flow: propose → test → MetaCritic → apply | escalate
- [ ] Rollback: change auto-reverts if regression detected
- [ ] IDE OptimizerPanel shows activity log, before/after metrics, rollback, and human override actions
- [ ] `NeverEditableByOptimizer` list is enforced by tests
- [ ] DecisionRecord present; CompletionGate passed; budget within `self_improvement`

### Phase 4: Self-Modification Engine (L4)

**Files to create:**
- `packages/engine/src/runtime/universal/self-modification-engine.ts` (~400 lines)
- `packages/engine/src/runtime/universal/__tests__/self-modification-engine.test.ts`

**Acceptance criteria:**
- [ ] Meta-optimizer tracks optimizer performance
- [ ] Optimizer strategies evolve only through M15 `system_self_improvement` concepts
- [ ] Circuit breaker: 3 consecutive failures → freeze
- [ ] Human can inspect & override any meta-change
- [ ] Every meta-change has `governance_adjustment_proposal`, `eval_proof`, `rollback_plan`
- [ ] No meta-change can touch `NeverEditableByOptimizer`
- [ ] DecisionRecord present; CompletionGate passed; rollback artifact present

---

## 9. Integration with P0-P2 Plan

| Plan Task | Phase | Relationship |
|-----------|-------|--------------|
| P0-3 (Sandbox) | Required for L3-L4 | Optimizer proposals tested in sandbox first |
| P0-4 (OTel) | Enhances | Every self-improvement decision traced |
| P0-7 (Lifecycle) | Foundation | Experience library reads from canonical lifecycle |
| P0-9 (Permissions) | Required for L3-L4 | Optimizer has its own capability grants |
| P0-10 (Cost guardrails) | Required for L3-L4 | Optimizer runs have cost budget |
| P1-2 (CheckpointStore) | Enhances | Time-travel to before/after optimization |
| **P2-1 (Eval loop)** | **THIS PLAN** | **This document REPLACES P2-1 with full architecture** |
| Memory v2 quarantine/approval | Required for L1-L4 | Experience projection reads approved, non-legacy, non-quarantined lessons only |
| M15 SystemSelfImprovement | Required for L4 | Self-modification executes as governed `system_self_improvement` concepts |

---

## 10. Key Design Decisions

### 10.1 Governance-First, Not Speed-First

Pyrfor's self-improvement is **governed by default**. Unlike Escher-Loop or Hyperagents that optimize without guardrails:

- Every change has a rollback plan
- Every change is audited
- Human can inspect and override
- Circuit breakers prevent runaway optimization
- Policy/budget changes ALWAYS require human approval
- No component creates a shadow scheduler, private ledger, or parallel memory store

### 10.2 Incremental, Not Revolutionary

We don't need a fully autonomous self-improving system on Day 1. Each phase delivers value:
- **Phase 1:** Better planning via past experience (immediate UX improvement)
- **Phase 2:** Automated pattern discovery (finds things humans miss)
- **Phase 3:** Automatic improvements (reduces human burden)
- **Phase 4:** Self-evolving optimization (stays ahead of changing requirements)

### 10.3 Open Source, Not Black Box

All optimization logic is:
- Inspectable (trace every decision)
- Replayable (checkpoint before/after)
- Overridable (human veto at any level)
- Forkable (any team can customize optimizers)

### 10.4 Offline-First

Experience library and pattern miner work fully offline (SQLite + FTS5). No cloud dependency for self-improvement. Embedding similarity is optional, feature-flagged, local-only by default, and budgeted under `self_improvement`. Cloud sync is optional for team-wide experience sharing and must preserve approval/provenance/project-scope boundaries.

### 10.5 Migration and Extension Discipline

- Schema changes use the existing runtime SQLite / `memory-store.ts` migration path.
- New optimizer types are added as new `OptimizerSpecialization` tags and must declare: capability grants, budget cap, allowed artifact kinds, forbidden `NeverEditableByOptimizer` touches, eval proof shape, rollback plan shape, UI evidence surface.
- Public API objects carry explicit `schemaVersion` fields; migrations must be backward-compatible and projection tables must be rebuildable.

---

## 11. Metrics of Success

| Phase | Metric | Baseline | Target |
|-------|--------|----------|--------|
| L1 | Task relevance of injected patterns | 0% (no injection) | >70% judged relevant |
| L1 | Time saved by reusing patterns | 0 | -15% task completion time |
| L2 | Patterns found per 100 runs | 0 | ≥20 viable patterns |
| L2 | Pattern acceptance rate by MetaCritic | N/A | >60% |
| L3 | Automated improvements accepted/month | 0 | ≥10 |
| L3 | VerifierScore regression after auto-improvement | 0% | <5% |
| L4 | Optimizer strategy improvement YoY | 0% | +10%/quarter |
| ALL | Human intervention rate | 100% | <20% for routine optimizations |
| ALL | Rollback rate after accepted SI proposals | N/A | <5% |
| ALL | Cost overrun in `self_improvement` scope | 0 | 0 |
| ALL | Proposals rejected for missing provenance/evidence | N/A | 100% rejected |

### 11.1 Anti-Goodhart Guard

`verifierScore` is never the sole optimization target. A proposal is valid only when it reports the composite:

- `verifierScoreDelta`
- `acceptance_test_pass_rate`
- `human_override_rate`
- `rollback_rate`
- `cost_per_completed_concept`

MetaCritic rejects proposals that improve one metric by degrading safety, rollback, cost, or human-override indicators.

---

## 12. Rollout Plan (Execution Order for Copilot)

```
SI1: Historian tag audit
     └─ Ensure lessons have domain/toolSignatures/verifierScore/parentConceptId/retryOf

SI2: Experience Library projection
     ├─ Runtime SQLite migration
     ├─ Read-only ExperienceLibrary class + tests
     ├─ FTS5 baseline retrieval
     └─ Planner-safe approval/provenance filters

SI3: Planner injection
     ├─ Inject patterns/antipatterns into planner context
     └─ Record lessonsConsidered[] in DecisionRecord

SI4: Self-improvement budget
     ├─ BudgetScope='self_improvement'
     ├─ Per-run and global caps
     └─ Cost circuit breaker

SI5: Pattern Miner
     ├─ Algorithm 1: success pattern extraction
     ├─ Time-based holdout + domain stratification
     ├─ MetaCritic integration
     └─ CLI: pyrfor optimize --dry-run --evidence

SI6: Optional local embeddings
     └─ Feature-flagged backend, non-regression vs FTS5

SI7: Optimizer specializations
     ├─ Prompt Engineer
     ├─ Tool Smith
     ├─ Skill Architect
     ├─ Strategy Planner
     ├─ IDE: OptimizerPanel
     └─ NeverEditableByOptimizer enforcement

SI8: Self-Modification Engine
     ├─ M15 compliance shell
     ├─ Meta-optimizer proposals
     ├─ Circuit breaker
     └─ Human override UI
```

---

## 13. References

| Paper | Key Idea | Applied In |
|-------|----------|------------|
| [SiriuS](https://arxiv.org/abs/2502.04780) | Experience library + trajectory augmentation | Phase 1 |
| [Self-Improving Coding Agent](https://arxiv.org/abs/2504.15228) | Agent edits own code; +36pp SWE-bench | Phase 3-4 |
| [Escher-Loop](https://arxiv.org/abs/2604.23472) | Dual-population coevolution; optimizer+tasks | Phase 3 |
| [Hyperagents / DGM-H](https://arxiv.org/abs/2603.19461) | Meta-agent edits modification procedure | Phase 4 |
| [ReflexiCoder](https://arxiv.org/abs/2603.05863) | Self-reflection + self-correction via RL | Phase 3 |
| [DSPy](https://github.com/stanfordnlp/dspy) | Prompt compilation from trainset | Phase 2 |

---

## 14. Appendix: API Surface Summary

```typescript
// Public API (exported from @pyrfor/engine)

// Phase 1
export { ExperienceLibrary } from './runtime/universal/experience-library';
export type { ExperienceEntry, ExperienceQuery, ExperienceProjectionVersion } from './runtime/universal/experience-library';

// Phase 2
export { PatternMiner } from './runtime/universal/pattern-miner';
export type { MinedPattern, PatternMinerConfig } from './runtime/universal/pattern-miner';

// Phase 3
export { OptimizerAgent, createOptimizer } from './runtime/universal/optimizer-agent';
export type { OptimizerSpecialization } from './runtime/universal/optimizer-agent';

// Phase 4
export { SelfModificationEngine } from './runtime/universal/self-modification-engine';
export type { SelfModificationResult, RollbackPlan } from './runtime/universal/self-modification-engine';

// Existing (enhanced)
export { MetaCritic } from './runtime/universal/meta-critic';
export type { ImprovementProposal } from './runtime/universal/meta-critic';
export { buildPostMortem, runPostMortem } from './runtime/universal/postmortem';
```

---

**Document ready for Copilot implementation. Start with Phase 1.**

*Author: Клод Гребешок 🐾 | Synthesis of 5 papers + Pyrfor internal inventory | 2026-05-15*

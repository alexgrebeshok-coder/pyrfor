# Pyrfor: Architecture of Self-Improvement — The Learning OS

**Date:** 2026-05-15
**Status:** PROPOSAL — for review & Copilot implementation
**Dependencies:** PYRFOR-IMPROVEMENT-PLAN-2026-05-14.md (§2.3 P2-1, §1 Self-improving loop principle)

---

## 0. Executive Summary

**Current state:** Pyrfor has the best foundation for self-improvement among 22+ OSS projects — postmortem phase, trajectory recorder, meta-critic, incident packets. But the loop is OPEN: postmortem is written but never used for automatic system improvement.

**Goal:** Make Pyrfor the world's first **self-improving agent operating system** — a closed-loop system where every run makes the next run better, without human intervention for routine optimizations.

**Inspiration:** SiriuS (experience library, +21.88%), Escher-Loop (dual-population coevolution), Self-Improving Coding Agent (code self-modification, +36pp SWE-bench), Hyperagents (meta-meta improvement), ReflexiCoder (internal self-correction).

---

## 1. Architecture Overview

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
│  │  Approval Flow → Audit Trail → Rollback → Human Override │    │
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
| L1 | **Experience Library** | SiriuS | Indexed repository of postmortem artifacts, queryable by task similarity |
| L2 | **Pattern Miner** | DSPy | Auto-extracts reusable patterns from successful runs; failure anti-patterns from failed runs |
| L3 | **Optimizer Agent** | Escher-Loop | Separate agent population that reads library, proposes improvements, runs acceptance tests |
| L4 | **Self-Modification Engine** | Self-Improving Coding Agent + Hyperagents | Applies approved improvements to skills/prompts/tools/configs |

---

## 4. Level 1: Experience Library (SiriuS-inspired)

### 4.1 Concept

Every postmortem artifact goes into a queryable library. When a new task arrives, the system finds the N most similar past tasks and their outcomes, injecting the best strategies into the new run's planning phase.

### 4.2 Data Model

```typescript
// packages/engine/src/runtime/universal/experience-library.ts

interface ExperienceEntry {
  id: string;
  runId: string;
  conceptId: string;
  
  // Task fingerprint (for similarity search)
  goalEmbedding?: number[];        // LLM-generated embedding of the goal
  goalKeywords: string[];           // extracted keywords
  toolSignatures: string[];        // which tools were used
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
  goal?: string;                   // text → embedding similarity
  domain?: string;
  toolSignatures?: string[];
  minVerifierScore?: number;
  outcome?: ExperienceEntry['outcome'];
  limit?: number;                  // default 5
  includeFailed?: boolean;         // whether to include failed runs
}
```

### 4.3 API

```typescript
interface ExperienceLibrary {
  // Write
  ingest(postmortem: RunPostMortem, concept: ConceptRecord): Promise<ExperienceEntry>;
  
  // Read
  query(q: ExperienceQuery): Promise<ExperienceEntry[]>;
  
  // Pattern management
  promotePattern(entryId: string, pattern: string): Promise<void>;
  deprecatePattern(entryId: string, pattern: string): Promise<void>;
  
  // Analytics
  getPatternEffectiveness(patternKey: string): Promise<number>;   // 0-1
  getTopPatterns(domain: string, limit: number): Promise<PatternStat[]>;
  
  // Similarity
  findSimilar(goal: string, limit: number): Promise<ExperienceEntry[]>;
}
```

### 4.4 Storage

**SQLite table** (inside existing memory database):

```sql
CREATE TABLE experience_library (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL,
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
  indexed_at TEXT NOT NULL
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
CREATE INDEX idx_experience_domain_outcome ON experience_library(domain, outcome);
CREATE INDEX idx_experience_verifier ON experience_library(verifier_score);
CREATE INDEX idx_experience_created ON experience_library(created_at);
```

### 4.5 Integration Point

In `engine-loop.ts`, **before** the `plan` phase:

```typescript
// NEW: Query experience library before planning
const similar = await experienceLibrary.findSimilar(goal, 5);
const patterns = similar
  .filter(e => e.outcome === 'completed')
  .flatMap(e => e.reusablePatterns);
const antipatterns = similar
  .filter(e => e.outcome === 'failed')
  .flatMap(e => e.whatFailed);

// Inject into planner context
plannerContext.experience = { patterns, antipatterns, similarRuns: similar };
```

**After** postmortem:

```typescript
// NEW: Auto-ingest into experience library
await experienceLibrary.ingest(postmortem, conceptRecord);
```

---

## 5. Level 2: Pattern Miner (DSPy-inspired)

### 5.1 Concept

Runs periodically (or on threshold) over the experience library to extract generalizable patterns, optimize prompt templates, and generate ImprovementProposals for MetaCritic review.

### 5.2 Architecture

```typescript
// packages/engine/src/runtime/universal/pattern-miner.ts

interface PatternMinerConfig {
  minSamplesForPattern: number;    // default 3 — need 3 similar successes
  minEffectivenessForPromotion: number; // default 0.7
  maxPatternsPerRun: number;        // default 5
  runOnPostmortem: boolean;         // whether to run after each postmortem
  scheduledRunCron?: string;        // e.g., '0 */6 * * *' — every 6 hours
}

interface MinedPattern {
  id: string;
  patternKey: string;              // unique key for dedup
  description: string;             // human-readable
  template: string;                // code/prompt template
  applicabilityScore: number;      // 0-1 how likely this applies to new task
  evidenceEntries: string[];       // experience entry IDs that support this
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
  evaluatePattern(pattern: MinedPattern): Promise<number>; // 0-1
  submitToMetaCritic(pattern: MinedPattern): Promise<ImprovementProposal>;
}
```

### 5.3 Mining Algorithms

**Algorithm 1: Success Pattern Extraction**
```
Input: N most recent successful runs in same domain
Output: Common whatWorked entries → generalized patterns

1. Group successful postmortems by domain + tool signatures
2. Cluster whatWorked entries by semantic similarity (embedding)
3. For clusters with ≥ minSamplesForPattern:
   - Generate generalized pattern via LLM summarization
   - Create template with placeholders
4. Evaluate on held-out successful runs
5. If effectiveness ≥ minEffectivenessForPromotion → submit to MetaCritic
```

**Algorithm 2: Failure Pattern Correction**
```
Input: Failed runs + their subsequent successful re-runs
Output: Anti-patterns + suggested fixes

1. Find pairs: (failed run, later successful run with same goal)
2. Extract whatFailed from failed run
3. Find whatWorked from successful run that addresses that failure
4. Generate correction pattern
5. Submit to MetaCritic with higher scrutiny
```

**Algorithm 3: Prompt Optimization (DSPy-style)**
```
Input: Completed experience entries with verifierScore
Output: Optimized prompt templates

1. For a given prompt template:
2. Collect N runs using that template with their verifierScores
3. Generate M prompt variants (LLM as optimizer)
4. Score variants against held-out set
5. Select top variant
6. Submit as ImprovementProposal
```

### 5.4 Execution Modes

```
MODE 1: Realtime (L1-triggered)
  └─ After each postmortem, if new entries in domain ≥ threshold → mine

MODE 2: Periodic (cron-triggered)
  └─ Every 6 hours, run full mining across all domains

MODE 3: Manual (CLI-triggered)
  └─ pyrfor optimize --domain coding --dry-run
```

---

## 6. Level 3: Optimizer Agent (Escher-Loop-inspired)

### 6.1 Concept

A separate agent population whose sole purpose is to observe, analyze, and improve the system. It reads experience library, runs pattern miner, and generates concrete improvements.

### 6.2 Architecture

```typescript
// packages/engine/src/runtime/universal/optimizer-agent.ts

interface OptimizerAgent {
  id: string;
  specialization: OptimizerSpecialization;
  state: 'idle' | 'observing' | 'analyzing' | 'proposing' | 'verifying';
}

type OptimizerSpecialization = 
  | 'prompt_engineer'     // Optimizes prompt templates
  | 'tool_smith'          // Improves tool configurations
  | 'skill_architect'     // Creates/updates skills
  | 'strategy_planner'    // Improves planning strategies
  | 'quality_gate_keeper' // Tunes verifier thresholds
  | 'cost_optimizer';     // Optimizes cost/performance tradeoffs

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
  artifactIds: string[];
}
```

### 6.3 Optimizer Types

#### Prompt Engineer
```
Input: Experience library (domain=*)
Action:
  1. Find tasks where verifierScore < threshold
  2. Generate prompt variants using LLM
  3. Score on historical data
  4. Submit best variant as ImprovementProposal
Output: Updated prompt templates
```

#### Tool Smith
```
Input: Experience library (filtered by tool signature)
Action:
  1. Find tools with high failure rate in postmortems
  2. Analyze failure patterns
  3. Propose tool configuration changes (timeouts, retries, fallbacks)
  4. Submit as ImprovementProposal
Output: Updated tool configs
```

#### Skill Architect
```
Input: Experience library + current skill registry
Action:
  1. Find whatWorked patterns that aren't yet skills
  2. Generate SKILL.md for new skill
  3. Submit to skill registry via MetaCritic
Output: New or updated skills
```

#### Strategy Planner
```
Input: Experience library (outcome comparison)
Action:
  1. Compare runs: with-plan vs without-plan
  2. Measure plan accuracy vs actual execution
  3. Propose planning strategy improvements
Output: Updated planning heuristics
```

### 6.4 Governance for Optimizer

```
ALL optimizer proposals go through MetaCritic:
  - algorithm/heuristic proposals → auto-apply if acceptance tests pass
  - policy/budget proposals → always require human approval
  - verifier_rules proposals → require human approval + test run
  
Rollback:
  - Every applied change has a rollback plan
  - Rollback triggered if: 
    1. Next 3 runs show regressed verifierScore by >10%
    2. Human rejects within rollback window (default 7 days)
  
Audit:
  - Who changed what, when, why
  - Before/after metrics comparison
  - Full trajectory of the optimizer's own decision process
```

---

## 7. Level 4: Self-Modification Engine

### 7.1 Concept

The optimizer's own strategies, thresholds, and algorithms are themselves open to optimization. This is meta-self-improvement — the system improves how it improves.

### 7.2 Architecture

```typescript
interface SelfModificationEngine {
  // The engine that modifies the optimizers
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
  rollbackPlan: string;
}
```

### 7.3 Meta-Optimization Loop

```
┌──────────────────────────────────────────────┐
│  META-LOOP (runs every 7 days or 100 runs)   │
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
│  3. Generate meta-improvement                │
│     - LLM proposes changes to optimizer      │
│     - Scored against historical data         │
│     - Submitted with extra scrutiny          │
│                                              │
│  4. Apply with circuit breaker               │
│     - If 3 consecutive meta-changes fail →   │
│       freeze, escalate to human              │
└──────────────────────────────────────────────┘
```

---

## 8. Implementation Phases

### Phase 1: Experience Library (L1) — 1-2 weeks with Copilot

**Files to create:**
- `packages/engine/src/runtime/universal/experience-library.ts` (~300 lines)
- `packages/engine/src/runtime/universal/__tests__/experience-library.test.ts` (~200 lines)
- Migration: `packages/engine/prisma/migrations/*_experience_library.sql`

**Files to modify:**
- `engine-loop.ts` — integrate library query before plan phase + ingest after postmortem
- `postmortem.ts` — emit `experienceLibrary.ingest()` hook
- `index.ts` — export new module

**Acceptance criteria:**
- [ ] Postmortem → auto-ingested into SQLite experience library
- [ ] `findSimilar(goal, limit)` returns relevant past runs
- [ ] Planner context receives patterns/antipatterns from library
- [ ] Tests: query by domain, by tool signature, by outcome, similarity search

### Phase 2: Pattern Miner (L2) — 2-3 weeks with Copilot

**Files to create:**
- `packages/engine/src/runtime/universal/pattern-miner.ts` (~400 lines)
- `packages/engine/src/runtime/universal/__tests__/pattern-miner.test.ts` (~250 lines)
- CLI: `apps/pyrfor-ide/web/src/lib/pattern-miner-api.ts`

**Files to modify:**
- `meta-critic.ts` — accept miner-generated proposals (currently expects DoubleLoopRecords)
- `engine-loop.ts` — add periodic mining hook
- `cli/commands/optimize.ts` — new CLI command

**Acceptance criteria:**
- [ ] Miner extracts patterns from ≥3 similar successful runs
- [ ] Patterns scored against held-out data
- [ ] `pyrfor optimize --domain coding --dry-run` shows proposed changes
- [ ] Proposals submitted to MetaCritic with evidence

### Phase 3: Optimizer Agents (L3) — 3-4 weeks with Copilot

**Files to create:**
- `packages/engine/src/runtime/universal/optimizer-agent.ts` (~500 lines)
- `packages/engine/src/runtime/universal/optimizers/prompt-engineer.ts`
- `packages/engine/src/runtime/universal/optimizers/tool-smith.ts`
- `packages/engine/src/runtime/universal/optimizers/skill-architect.ts`
- `packages/engine/src/runtime/universal/optimizers/strategy-planner.ts`
- Tests for each

**Files to modify:**
- `meta-critic.ts` — support batch proposal review
- `approval-flow.ts` — add auto-approve pathway for algorithm/heuristic
- `gateway.ts` — register optimizer routes
- IDE: OptimizerPanel component

**Acceptance criteria:**
- [ ] 4 optimizer specializations running
- [ ] Automatic improvements flow: propose → test → apply | escalate
- [ ] Rollback: change auto-reverts if regression detected
- [ ] IDE panel shows optimizer activity log

### Phase 4: Self-Modification Engine (L4) — 4-6 weeks with Copilot

**Files to create:**
- `packages/engine/src/runtime/universal/self-modification-engine.ts` (~400 lines)
- `packages/engine/src/runtime/universal/__tests__/self-modification-engine.test.ts`

**Acceptance criteria:**
- [ ] Meta-optimizer tracks optimizer performance
- [ ] Optimizer strategies evolve over time
- [ ] Circuit breaker: 3 consecutive failures → freeze
- [ ] Human can inspect & override any meta-change

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

---

## 10. Key Design Decisions

### 10.1 Governance-First, Not Speed-First

Pyrfor's self-improvement is **governed by default**. Unlike Escher-Loop or Hyperagents that optimize without guardrails:

- Every change has a rollback plan
- Every change is audited
- Human can inspect and override
- Circuit breakers prevent runaway optimization
- Policy/budget changes ALWAYS require human approval

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

Experience library and pattern miner work fully offline (SQLite). No cloud dependency for self-improvement. Cloud sync optional for team-wide experience sharing.

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

---

## 12. Rollout Plan (Execution Order for Copilot)

```
Week 1-2:  Phase 1 — Experience Library
           ├─ SQLite schema + migration
           ├─ ExperienceLibrary class + tests
           ├─ Integration into engine-loop
           └─ FTS5 search + embedding similarity

Week 3-5:  Phase 2 — Pattern Miner
           ├─ Mining algorithms (success/failure/prompt)
           ├─ MetaCritic integration
           ├─ CLI: pyrfor optimize
           └─ Documentation: how patterns are mined

Week 6-9:  Phase 3 — Optimizer Agents
           ├─ Prompt Engineer (highest impact)
           ├─ Tool Smith
           ├─ Skill Architect
           ├─ IDE: OptimizerPanel
           └─ Auto-apply with rollback

Week 10-15: Phase 4 — Self-Modification Engine
            ├─ Meta-optimizer
            ├─ Circuit breaker
            ├─ Strategy evolution
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
export type { ExperienceEntry, ExperienceQuery } from './runtime/universal/experience-library';

// Phase 2
export { PatternMiner } from './runtime/universal/pattern-miner';
export type { MinedPattern, PatternMinerConfig } from './runtime/universal/pattern-miner';

// Phase 3
export { OptimizerAgent, createOptimizer } from './runtime/universal/optimizer-agent';
export type { OptimizerSpecialization } from './runtime/universal/optimizer-agent';

// Phase 4
export { SelfModificationEngine } from './runtime/universal/self-modification-engine';

// Existing (enhanced)
export { MetaCritic } from './runtime/universal/meta-critic';
export { buildPostMortem, runPostMortem } from './runtime/universal/postmortem';
```

---

**Document ready for Copilot implementation. Start with Phase 1.**

*Author: Клод Гребешок 🐾 | Synthesis of 5 papers + Pyrfor internal inventory | 2026-05-15*

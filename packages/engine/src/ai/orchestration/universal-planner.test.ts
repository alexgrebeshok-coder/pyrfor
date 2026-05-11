/**
 * universal-planner.test.ts — Deterministic tests for buildUniversalPlan.
 *
 * All tests run without real LLM calls or network access.
 * The heuristic path is exercised directly; the LLM adapter path is tested
 * with a synchronous mock that returns a known JSON payload.
 *
 * Coverage:
 *  - M6 model cap enforcement (ModelCapViolationError)
 *  - Heuristic path: phases, researchRequired, researchTopics, missingTools
 *  - Idempotency key stability (same input → same key)
 *  - Idempotency key sensitivity (different input → different key)
 *  - Empty concept throws
 *  - LLM adapter happy path (correct JSON → overrides heuristic)
 *  - LLM adapter parse failure → falls back to heuristic
 *  - LLM adapter network failure → falls back to heuristic
 *  - LLM response with phases out of order and missing required entries
 *  - UniversalPlan extends CollaborationPlan shape
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assertM6ModelCap,
  buildUniversalPlan,
  buildUniversalPlanHeuristic,
  computePlanIdempotencyKey,
  evaluateLookaheadBounds,
  LookaheadBoundsViolationError,
  M6_ALLOWED_MODELS,
  ModelCapViolationError,
  type UniversalPlanContext,
  type UniversalPlanLLMAdapter,
} from './universal-planner';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return '2025-01-01T00:00:00.000Z';
}

function ctx(overrides: Partial<UniversalPlanContext> = {}): UniversalPlanContext {
  return { now, ...overrides };
}

function mockAdapter(response: string): UniversalPlanLLMAdapter {
  return {
    modelId: 'gpt-5.4',
    complete: vi.fn().mockResolvedValue(response),
  };
}

// ─── Model Cap ───────────────────────────────────────────────────────────────

describe('M6 model cap enforcement', () => {
  it('accepts all M6-allowed models', () => {
    for (const model of M6_ALLOWED_MODELS) {
      expect(() => assertM6ModelCap(model)).not.toThrow();
    }
  });

  it('rejects gpt-5.5 (above cap)', () => {
    expect(() => assertM6ModelCap('gpt-5.5')).toThrow(ModelCapViolationError);
  });

  it('rejects claude-opus-4.7 (above cap)', () => {
    expect(() => assertM6ModelCap('claude-opus-4.7')).toThrow(ModelCapViolationError);
  });

  it('includes the violating model in the error message', () => {
    const err = (() => {
      try { assertM6ModelCap('unknown-model-999'); }
      catch (e) { return e as ModelCapViolationError; }
    })()!;
    expect(err.message).toContain('unknown-model-999');
    expect(err.name).toBe('ModelCapViolationError');
  });

  it('rejects a disallowed adapter before any LLM call is made', async () => {
    const adapter: UniversalPlanLLMAdapter = {
      modelId: 'gpt-5.5',
      complete: vi.fn(),
    };
    await expect(buildUniversalPlan('Build a thing', ctx(), adapter)).rejects.toThrow(ModelCapViolationError);
    expect(adapter.complete).not.toHaveBeenCalled();
  });
});

// ─── Heuristic Path ──────────────────────────────────────────────────────────

describe('buildUniversalPlanHeuristic', () => {
  it('always includes plan + execute + critique + done phases', () => {
    const plan = buildUniversalPlanHeuristic('Build a REST API', ctx());
    expect(plan.phases).toContain('plan');
    expect(plan.phases).toContain('execute');
    expect(plan.phases).toContain('critique');
    expect(plan.phases).toContain('done');
  });

  it('adds research phase when concept mentions research keyword', () => {
    const plan = buildUniversalPlanHeuristic('Research the best TypeScript ORM options', ctx());
    expect(plan.researchRequired).toBe(true);
    expect(plan.phases).toContain('research');
    // research must come before execute
    const rIdx = plan.phases.indexOf('research');
    const eIdx = plan.phases.indexOf('execute');
    expect(rIdx).toBeLessThan(eIdx);
  });

  it('does not add research phase for simple construction tasks', () => {
    const plan = buildUniversalPlanHeuristic('Build a button component', ctx());
    expect(plan.researchRequired).toBe(false);
    expect(plan.phases).not.toContain('research');
  });

  it('extracts a research topic from concept when research is required', () => {
    const plan = buildUniversalPlanHeuristic('Research TypeScript generics patterns', ctx());
    expect(plan.planDocument.researchTopics).not.toHaveLength(0);
  });

  it('missingTools is always empty (no ToolForge in M6)', () => {
    const plan = buildUniversalPlanHeuristic('Build an entire platform', ctx());
    expect(plan.missingTools).toEqual([]);
    expect(plan.planDocument.missingTools).toEqual([]);
  });

  it('has correct planDocument schemaVersion', () => {
    const plan = buildUniversalPlanHeuristic('Build something', ctx());
    expect(plan.planDocument.schemaVersion).toBe('pyrfor.plan.v1');
  });

  it('createdAt matches the injectable clock', () => {
    const plan = buildUniversalPlanHeuristic('Build something', ctx());
    expect(plan.planDocument.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('produces a valid UniversalPlan / CollaborationPlan shape', () => {
    const plan = buildUniversalPlanHeuristic('Build a thing', ctx());
    expect(typeof plan.collaborative).toBe('boolean');
    expect(typeof plan.leaderAgentId).toBe('string');
    expect(typeof plan.reason).toBe('string');
    expect(Array.isArray(plan.steps)).toBe(true);
  });

  it('throws on empty concept', () => {
    expect(() => buildUniversalPlanHeuristic('', ctx())).toThrow(/concept must not be empty/);
    expect(() => buildUniversalPlanHeuristic('   ', ctx())).toThrow(/concept must not be empty/);
  });

  it('step dependsOn chains in phase order', () => {
    const plan = buildUniversalPlanHeuristic('Research and build a REST API', ctx());
    const steps = plan.planDocument.steps;
    expect(steps[0].dependsOn).toEqual([]);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].dependsOn).toHaveLength(1);
      expect(steps[i].dependsOn[0]).toBe(steps[i - 1].id);
    }
  });
});

// ─── Idempotency Key ─────────────────────────────────────────────────────────

describe('computePlanIdempotencyKey', () => {
  it('same concept + context → identical key', () => {
    const key1 = computePlanIdempotencyKey('Build a REST API', ctx({ workspaceId: 'ws-1' }));
    const key2 = computePlanIdempotencyKey('Build a REST API', ctx({ workspaceId: 'ws-1' }));
    expect(key1).toBe(key2);
  });

  it('different concept → different key', () => {
    const key1 = computePlanIdempotencyKey('Build a REST API', ctx());
    const key2 = computePlanIdempotencyKey('Build a GraphQL API', ctx());
    expect(key1).not.toBe(key2);
  });

  it('different workspaceId → different key', () => {
    const key1 = computePlanIdempotencyKey('Build a REST API', ctx({ workspaceId: 'ws-1' }));
    const key2 = computePlanIdempotencyKey('Build a REST API', ctx({ workspaceId: 'ws-2' }));
    expect(key1).not.toBe(key2);
  });

  it('different strategies → different key', () => {
    const key1 = computePlanIdempotencyKey('Build', ctx({ strategies: ['keep it simple'] }));
    const key2 = computePlanIdempotencyKey('Build', ctx({ strategies: ['use microservices'] }));
    expect(key1).not.toBe(key2);
  });

  it('strategy order does not affect the key (sorted before hashing)', () => {
    const key1 = computePlanIdempotencyKey('Build', ctx({ strategies: ['a', 'b'] }));
    const key2 = computePlanIdempotencyKey('Build', ctx({ strategies: ['b', 'a'] }));
    expect(key1).toBe(key2);
  });

  it('now() clock does not affect the key (excluded from hash)', () => {
    const key1 = computePlanIdempotencyKey('Build', { now: () => '2025-01-01T00:00:00.000Z' });
    const key2 = computePlanIdempotencyKey('Build', { now: () => '2030-01-01T12:00:00.000Z' });
    expect(key1).toBe(key2);
  });

  it('produces a 64-character hex string (sha256)', () => {
    const key = computePlanIdempotencyKey('Build something', ctx());
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Bounded Lookahead Guards ─────────────────────────────────────────────────

describe('bounded lookahead guards', () => {
  it('allows usage inside branch/depth/backtrack limits', () => {
    const decision = evaluateLookaheadBounds({
      maxBranches: 4,
      maxDepth: 4,
      maxBacktracks: 1,
    }, {
      branches: 2,
      depth: 4,
      backtracks: 0,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasonCodes).toEqual([]);
  });

  it('blocks planning when maxDepth is exceeded', () => {
    expect(() => buildUniversalPlanHeuristic('Research and build a REST API', ctx({
      lookahead: {
        maxBranches: 5,
        maxDepth: 2,
        maxBacktracks: 0,
      },
    }))).toThrow(LookaheadBoundsViolationError);
  });

  it('blocks retry/backtracking without new evidence when required', () => {
    const decision = evaluateLookaheadBounds({
      maxBranches: 5,
      maxDepth: 8,
      maxBacktracks: 1,
      requiresNewEvidence: true,
      evidenceSnapshotHash: 'sha256:same',
      previousEvidenceSnapshotHash: 'sha256:same',
    }, {
      branches: 1,
      depth: 2,
      backtracks: 1,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCodes).toContain('new_evidence_required');
  });

  it('hard-caps excessive policy limits', () => {
    const decision = evaluateLookaheadBounds({
      maxBranches: 999,
      maxDepth: 999,
      maxBacktracks: 999,
    }, {
      branches: 6,
      depth: 9,
      backtracks: 4,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effectiveLimits).toEqual({
      maxBranches: 5,
      maxDepth: 8,
      maxBacktracks: 3,
    });
    expect(decision.reasonCodes).toEqual([
      'max_branches_exceeded',
      'max_depth_exceeded',
      'max_backtracks_exceeded',
    ]);
  });
});

// ─── LLM-Assisted Path ───────────────────────────────────────────────────────

describe('buildUniversalPlan with LLM adapter', () => {
  it('happy path: LLM JSON overrides heuristic phases and rationale', async () => {
    const llmResponse = JSON.stringify({
      phases: ['plan', 'research', 'execute', 'critique', 'done'],
      researchRequired: true,
      researchTopics: ['TypeScript ORM benchmarks'],
      rationale: 'Evidence needed before choosing the ORM.',
    });
    const plan = await buildUniversalPlan('Pick an ORM', ctx(), mockAdapter(llmResponse));
    expect(plan.researchRequired).toBe(true);
    expect(plan.planDocument.researchTopics).toContain('TypeScript ORM benchmarks');
    expect(plan.planDocument.rationale).toBe('Evidence needed before choosing the ORM.');
    expect(plan.phases).toContain('research');
  });

  it('always has plan as first phase', async () => {
    const llmResponse = JSON.stringify({
      phases: ['execute', 'research', 'done'],
      researchRequired: false,
      researchTopics: [],
      rationale: 'Simple.',
    });
    const plan = await buildUniversalPlan('Do a thing', ctx(), mockAdapter(llmResponse));
    expect(plan.phases[0]).toBe('plan');
  });

  it('always has done as last phase', async () => {
    const llmResponse = JSON.stringify({
      phases: ['plan', 'execute'],
      researchRequired: false,
      researchTopics: [],
      rationale: 'Simple.',
    });
    const plan = await buildUniversalPlan('Do a thing', ctx(), mockAdapter(llmResponse));
    expect(plan.phases.at(-1)).toBe('done');
  });

  it('falls back to heuristic when LLM returns invalid JSON', async () => {
    const adapter = mockAdapter('this is not json {{{');
    const plan = await buildUniversalPlan('Build a REST API', ctx(), adapter);
    // Falls back to heuristic — should still be a valid plan
    expect(plan.planDocument.schemaVersion).toBe('pyrfor.plan.v1');
    expect(plan.phases).toContain('plan');
  });

  it('falls back to heuristic when LLM adapter throws', async () => {
    const adapter: UniversalPlanLLMAdapter = {
      modelId: 'claude-sonnet-4.6',
      complete: vi.fn().mockRejectedValue(new Error('network timeout')),
    };
    const plan = await buildUniversalPlan('Build a REST API', ctx(), adapter);
    expect(plan.planDocument.schemaVersion).toBe('pyrfor.plan.v1');
  });

  it('no adapter → heuristic path (synchronous-equivalent)', async () => {
    const plan = await buildUniversalPlan('Build a REST API', ctx());
    expect(plan.planDocument.schemaVersion).toBe('pyrfor.plan.v1');
  });

  it('empty concept throws even when adapter is provided', async () => {
    await expect(buildUniversalPlan('', ctx(), mockAdapter('{}'))).rejects.toThrow(
      /concept must not be empty/,
    );
  });

  it('falls back to the bounded heuristic when LLM phase expansion exceeds lookahead bounds', async () => {
    const adapter = mockAdapter(JSON.stringify({
      phases: ['plan', 'research', 'execute', 'critique', 'done'],
      researchRequired: true,
      researchTopics: ['expanded topic'],
      rationale: 'expanded by model',
    }));

    const plan = await buildUniversalPlan('Build a widget', ctx({
      lookahead: {
        maxBranches: 5,
        maxDepth: 3,
        maxBacktracks: 0,
      },
    }), adapter);

    expect(plan.researchRequired).toBe(false);
    expect(plan.phases).not.toContain('research');
    expect(plan.planDocument.rationale).not.toBe('expanded by model');
  });
});

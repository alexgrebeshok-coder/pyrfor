// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  createCostAwareDAGPlanner,
  type DAGStepSpec,
  type DAGPlanRequest,
} from './cost-aware-dag.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeStep(
  overrides: Partial<DAGStepSpec> & { id: string },
): DAGStepSpec {
  return {
    name: overrides.id,
    estTokens: 1000,
    estDurationMs: 1000,
    ...overrides,
  };
}

function makePlan(
  steps: DAGStepSpec[],
  extra: Partial<Omit<DAGPlanRequest, 'steps'>> = {},
) {
  return createCostAwareDAGPlanner().plan({ goal: 'test', steps, ...extra });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CostAwareDAGPlanner', () => {
  const planner = createCostAwareDAGPlanner();

  // ── 1. Linear chain layers ─────────────────────────────────────────────────
  it('linear chain: layers correct', () => {
    const plan = makePlan([
      makeStep({ id: 'a' }),
      makeStep({ id: 'b', dependsOn: ['a'] }),
      makeStep({ id: 'c', dependsOn: ['b'] }),
    ]);
    expect(plan.layers).toEqual([['a'], ['b'], ['c']]);
    expect(plan.steps.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  // ── 2. Linear chain totals ─────────────────────────────────────────────────
  it('linear chain: totals correct', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estTokens: 100, estDurationMs: 500 }),
        makeStep({ id: 'b', dependsOn: ['a'], estTokens: 200, estDurationMs: 1000 }),
      ],
      { tokenPriceUsd: 0.001 },
    );
    expect(plan.totalExpectedTokens).toBeCloseTo(300);
    expect(plan.totalExpectedUsd).toBeCloseTo(0.3);
    expect(plan.totalExpectedDurationMs).toBeCloseTo(1500);
  });

  // ── 3. Diamond DAG layers ──────────────────────────────────────────────────
  it('diamond DAG: layers correct', () => {
    const plan = makePlan([
      makeStep({ id: 'a' }),
      makeStep({ id: 'b', dependsOn: ['a'] }),
      makeStep({ id: 'c', dependsOn: ['a'] }),
      makeStep({ id: 'd', dependsOn: ['b', 'c'] }),
    ]);
    expect(plan.layers[0]).toEqual(['a']);
    expect(plan.layers[1]).toContain('b');
    expect(plan.layers[1]).toContain('c');
    expect(plan.layers[1]).toHaveLength(2);
    expect(plan.layers[2]).toEqual(['d']);
  });

  // ── 4. Cycle detection ─────────────────────────────────────────────────────
  it('cycle detection throws', () => {
    expect(() =>
      makePlan([
        makeStep({ id: 'a', dependsOn: ['b'] }),
        makeStep({ id: 'b', dependsOn: ['a'] }),
      ]),
    ).toThrow(/cycle detected/);
  });

  // ── 5. Self-loop cycle ─────────────────────────────────────────────────────
  it('self-loop cycle detection', () => {
    expect(() => makePlan([makeStep({ id: 'a', dependsOn: ['a'] })])).toThrow(
      /cycle detected/,
    );
  });

  // ── 6. Unknown dependency ──────────────────────────────────────────────────
  it('unknown dependency throws', () => {
    expect(() =>
      makePlan([makeStep({ id: 'a', dependsOn: ['missing'] })]),
    ).toThrow(/unknown dep/);
  });

  // ── 7. Empty steps ─────────────────────────────────────────────────────────
  it('empty steps → empty feasible plan', () => {
    const plan = planner.plan({ goal: 'x', steps: [] });
    expect(plan.steps).toHaveLength(0);
    expect(plan.layers).toHaveLength(0);
    expect(plan.feasible).toBe(true);
    expect(plan.totalExpectedUsd).toBe(0);
    expect(plan.totalExpectedTokens).toBe(0);
    expect(plan.criticalPath).toHaveLength(0);
  });

  // ── 8. Token cost via tokenPriceUsd ────────────────────────────────────────
  it('token cost via tokenPriceUsd', () => {
    const plan = makePlan([makeStep({ id: 'a', estTokens: 100 })], {
      tokenPriceUsd: 0.01,
    });
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(1.0);
  });

  // ── 9. Explicit estUsd overrides token-derived ─────────────────────────────
  it('explicit estUsd overrides token-derived', () => {
    const plan = makePlan(
      [makeStep({ id: 'a', estTokens: 100, estUsd: 0.5 })],
      { tokenPriceUsd: 0.01 },
    );
    // estUsd 0.5 overrides token-derived 1.0
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.5);
  });

  // ── 10. successProb < 1 inflates via retryFactor ──────────────────────────
  it('successProb<1 inflates expected cost via retryFactor', () => {
    const plan = makePlan(
      [makeStep({ id: 'a', estTokens: 100, estUsd: 0.1, estDurationMs: 1000, successProb: 0.5 })],
      { retryFactor: 1 },
    );
    // retryMultiplier = 1 + 1*(1-0.5) = 1.5
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.15);
    expect(plan.steps[0]!.expectedTokens).toBeCloseTo(150);
    expect(plan.steps[0]!.expectedDurationMs).toBeCloseTo(1500);
  });

  // ── 11. retryFactor=0 disables inflation ──────────────────────────────────
  it('retryFactor=0 disables inflation', () => {
    const plan = makePlan(
      [makeStep({ id: 'a', estTokens: 100, estUsd: 0.1, estDurationMs: 1000, successProb: 0.5 })],
      { retryFactor: 0 },
    );
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.1);
    expect(plan.steps[0]!.expectedTokens).toBeCloseTo(100);
  });

  // ── 12. preferDuration prefers faster alternative ─────────────────────────
  it('preferDuration prefers faster alternative', () => {
    const plan = makePlan(
      [
        {
          id: 'a',
          name: 'A',
          estTokens: 100,
          estDurationMs: 2000,
          estUsd: 0.5,
          alternatives: [
            {
              id: 'a-fast',
              name: 'A-fast',
              estTokens: 200,
              estDurationMs: 500,
              estUsd: 1.0,
            },
          ],
        },
      ],
      { preferDuration: true },
    );
    expect(plan.steps[0]!.alternativeChosen).toBe('a-fast');
    expect(plan.steps[0]!.expectedDurationMs).toBeCloseTo(500);
  });

  // ── 13. Alternative chosen when cheaper ───────────────────────────────────
  it('alternative chosen when cheaper', () => {
    const plan = makePlan([
      {
        id: 'a',
        name: 'A',
        estTokens: 1000,
        estDurationMs: 1000,
        estUsd: 1.0,
        alternatives: [
          {
            id: 'a-cheap',
            name: 'A-cheap',
            estTokens: 100,
            estDurationMs: 1000,
            estUsd: 0.1,
          },
        ],
      },
    ]);
    expect(plan.steps[0]!.alternativeChosen).toBe('a-cheap');
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.1);
  });

  // ── 14. alternativeChosen field reflects substitution ─────────────────────
  it('alternativeChosen field reflects substitution', () => {
    const plan = makePlan([
      {
        id: 'orig',
        name: 'Orig',
        estTokens: 1000,
        estDurationMs: 1000,
        estUsd: 2.0,
        alternatives: [
          { id: 'v2', name: 'V2', estTokens: 50, estDurationMs: 1000, estUsd: 0.05 },
        ],
      },
    ]);
    expect(plan.steps[0]!.alternativeChosen).toBe('v2');
  });

  // ── 15. Alternative with worse cost not chosen ────────────────────────────
  it('alternative with worse cost not chosen', () => {
    const plan = makePlan([
      {
        id: 'a',
        name: 'A',
        estTokens: 100,
        estDurationMs: 1000,
        estUsd: 0.1,
        alternatives: [
          {
            id: 'a-expensive',
            name: 'A-expensive',
            estTokens: 1000,
            estDurationMs: 1000,
            estUsd: 5.0,
          },
        ],
      },
    ]);
    expect(plan.steps[0]!.alternativeChosen).toBeUndefined();
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.1);
  });

  // ── 16. earliestStart/End propagates through deps ─────────────────────────
  it('earliestStart/End correctly propagates through deps', () => {
    const plan = makePlan([
      makeStep({ id: 'a', estDurationMs: 1000 }),
      makeStep({ id: 'b', dependsOn: ['a'], estDurationMs: 2000 }),
    ]);
    const a = plan.steps.find((s) => s.id === 'a')!;
    const b = plan.steps.find((s) => s.id === 'b')!;
    expect(a.earliestStartMs).toBe(0);
    expect(a.earliestEndMs).toBe(1000);
    expect(b.earliestStartMs).toBe(1000);
    expect(b.earliestEndMs).toBe(3000);
  });

  // ── 17. Critical path is longest by duration ──────────────────────────────
  it('critical path is longest by duration', () => {
    // a→b: 1000+3000=4000ms  vs  a→c: 1000+500=1500ms
    const plan = makePlan([
      makeStep({ id: 'a', estDurationMs: 1000 }),
      makeStep({ id: 'b', dependsOn: ['a'], estDurationMs: 3000 }),
      makeStep({ id: 'c', dependsOn: ['a'], estDurationMs: 500 }),
    ]);
    expect(plan.criticalPath).toContain('a');
    expect(plan.criticalPath).toContain('b');
    expect(plan.criticalPath).not.toContain('c');
    expect(plan.totalExpectedDurationMs).toBe(4000);
  });

  // ── 18. Critical path single-node ─────────────────────────────────────────
  it('critical path single-node case', () => {
    const plan = makePlan([makeStep({ id: 'solo', estDurationMs: 5000 })]);
    expect(plan.criticalPath).toEqual(['solo']);
    expect(plan.totalExpectedDurationMs).toBe(5000);
  });

  // ── 19. budgetUsd drops lowest-priority optional first ────────────────────
  it('budgetUsd drops lowest-priority optional first', () => {
    const plan = makePlan(
      [
        // priority 2 (higher = keep) — should survive
        makeStep({ id: 'a', estTokens: 50, estDurationMs: 100, optional: true, priority: 2 }),
        // priority 1 (lower = drop first)
        makeStep({ id: 'b', estTokens: 50, estDurationMs: 100, optional: true, priority: 1 }),
        // not optional — must never be dropped
        makeStep({ id: 'c', estTokens: 50, estDurationMs: 100, optional: false }),
      ],
      { budgetUsd: 0.1, tokenPriceUsd: 0.001 },
    );
    // total = $0.15 → drop b ($0.05) → $0.10 ≤ budget
    expect(plan.droppedSteps).toContain('b');
    expect(plan.droppedSteps).not.toContain('a');
    expect(plan.droppedSteps).not.toContain('c');
    expect(plan.feasible).toBe(true);
  });

  // ── 20. Budget drops continue until under cap ─────────────────────────────
  it('budget drops continue until under cap or no more optional', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({ id: 'b', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({ id: 'c', estTokens: 50, estDurationMs: 100, optional: false }),
      ],
      { budgetUsd: 0.05, tokenPriceUsd: 0.001 },
    );
    expect(plan.droppedSteps).toContain('a');
    expect(plan.droppedSteps).toContain('b');
    expect(plan.droppedSteps).not.toContain('c');
    expect(plan.feasible).toBe(true);
  });

  // ── 21. Non-optional never dropped → feasible=false ──────────────────────
  it('non-optional step never dropped even over budget → feasible=false + warning', () => {
    const plan = makePlan(
      [makeStep({ id: 'req', estTokens: 100, estDurationMs: 100, optional: false })],
      { budgetUsd: 0.0001, tokenPriceUsd: 0.001 },
    );
    expect(plan.droppedSteps).toHaveLength(0);
    expect(plan.feasible).toBe(false);
    expect(plan.warnings.some((w) => /budget/i.test(w))).toBe(true);
  });

  // ── 22. Optional step with non-optional dependent NOT dropped ──────────────
  it('optional step with non-optional dependent NOT dropped', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'opt', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({
          id: 'req',
          dependsOn: ['opt'],
          estTokens: 50,
          estDurationMs: 100,
          optional: false,
        }),
      ],
      { budgetUsd: 0.001, tokenPriceUsd: 0.001 },
    );
    expect(plan.droppedSteps).not.toContain('opt');
    expect(plan.feasible).toBe(false);
  });

  // ── 23. Dropping cascades (recomputes critical path) ──────────────────────
  it('dropping cascades correctly (recompute critical path)', () => {
    // After dropping b, critical path a→c = 1500ms ≤ 1500ms budget
    const plan = makePlan(
      [
        makeStep({ id: 'a', estDurationMs: 1000, optional: false }),
        makeStep({ id: 'b', dependsOn: ['a'], estDurationMs: 2000, optional: true }),
        makeStep({ id: 'c', dependsOn: ['a'], estDurationMs: 500, optional: false }),
      ],
      { budgetDurationMs: 1500 },
    );
    expect(plan.droppedSteps).toContain('b');
    expect(plan.totalExpectedDurationMs).toBeLessThanOrEqual(1500);
    expect(plan.criticalPath).not.toContain('b');
  });

  // ── 24. toSubagentSpecs maps plan steps with goal prefix ──────────────────
  it('toSubagentSpecs maps plan steps with goal prefix', () => {
    const p = makePlan([makeStep({ id: 'a', name: 'Step A' })]);
    const specs = planner.toSubagentSpecs(p, { goalPrefix: 'PREFIX' });
    expect(specs[0]!.goal).toBe('PREFIX :: Step A');
    expect(specs[0]!.id).toBe('a');
  });

  // ── 25. toSubagentSpecs preserves dependsOn ────────────────────────────────
  it('toSubagentSpecs preserves dependsOn', () => {
    const p = makePlan([
      makeStep({ id: 'a' }),
      makeStep({ id: 'b', dependsOn: ['a'] }),
    ]);
    const specs = planner.toSubagentSpecs(p);
    const b = specs.find((s) => s.id === 'b')!;
    expect(b.dependsOn).toContain('a');
    expect(b.dependsOn).toHaveLength(1);
  });

  // ── 26. successProb clamped + warning ─────────────────────────────────────
  it('successProb clamped + warning', () => {
    const plan = makePlan([makeStep({ id: 'a', successProb: 1.5 })]);
    expect(
      plan.warnings.some((w) => /clamp|successProb/i.test(w)),
    ).toBe(true);
  });

  // ── 27. preferDuration tie broken by lower cost ───────────────────────────
  it('preferDuration tie broken by lower cost', () => {
    const plan = makePlan(
      [
        {
          id: 'a',
          name: 'A',
          estTokens: 1000,
          estDurationMs: 1000,
          estUsd: 2.0,
          alternatives: [
            {
              id: 'a-cheap',
              name: 'A-cheap',
              estTokens: 100,
              estDurationMs: 1000, // same duration
              estUsd: 0.5,         // cheaper
            },
          ],
        },
      ],
      { preferDuration: true },
    );
    // Same duration → fall back to lower cost → choose a-cheap
    expect(plan.steps[0]!.alternativeChosen).toBe('a-cheap');
  });

  // ── 28. Two parallel paths: deterministic critical-path tie-breaker ────────
  it('two parallel paths deterministic critical-path tie-breaker', () => {
    // x and z are independent, both end at 1000ms → lex-later id 'z' wins
    const plan = makePlan([
      makeStep({ id: 'x', estDurationMs: 1000 }),
      makeStep({ id: 'z', estDurationMs: 1000 }),
    ]);
    expect(plan.criticalPath).toEqual(['z']);
    expect(plan.totalExpectedDurationMs).toBe(1000);
  });

  // ── 29. budgetTokens cap respected ────────────────────────────────────────
  it('budgetTokens cap respected', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({ id: 'b', estTokens: 100, estDurationMs: 100, optional: false }),
      ],
      { budgetTokens: 100 },
    );
    expect(plan.droppedSteps).toContain('a');
    expect(plan.totalExpectedTokens).toBeLessThanOrEqual(100);
    expect(plan.feasible).toBe(true);
  });

  // ── 30. budgetDurationMs cap respected ────────────────────────────────────
  it('budgetDurationMs cap respected', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estDurationMs: 300, optional: false }),
        makeStep({ id: 'b', dependsOn: ['a'], estDurationMs: 300, optional: true }),
      ],
      { budgetDurationMs: 500 },
    );
    // critical path without b = 300ms ≤ 500ms
    expect(plan.droppedSteps).toContain('b');
    expect(plan.totalExpectedDurationMs).toBeLessThanOrEqual(500);
  });

  // ── 31. warnings always populated as array ────────────────────────────────
  it('warnings always populated as array', () => {
    const plan = planner.plan({ goal: 'x', steps: [] });
    expect(Array.isArray(plan.warnings)).toBe(true);
  });

  // ── 32. droppedSteps reflects removals ────────────────────────────────────
  it('droppedSteps reflects removals', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({ id: 'b', estTokens: 50, estDurationMs: 100, optional: false }),
      ],
      { budgetUsd: 0.0, tokenPriceUsd: 0.001 },
    );
    expect(plan.droppedSteps).toContain('a');
    expect(plan.droppedSteps).not.toContain('b');
    expect(Array.isArray(plan.droppedSteps)).toBe(true);
  });

  // ── 33. All optional + budget=0 → drop all, feasible=true ─────────────────
  it('all optional and budget=0 → drop all, feasible=true', () => {
    const plan = makePlan(
      [
        makeStep({ id: 'a', estTokens: 50, estDurationMs: 100, optional: true }),
        makeStep({ id: 'b', estTokens: 50, estDurationMs: 100, optional: true }),
      ],
      { budgetUsd: 0, tokenPriceUsd: 0.001 },
    );
    expect(plan.steps).toHaveLength(0);
    expect(plan.droppedSteps).toHaveLength(2);
    expect(plan.feasible).toBe(true);
  });

  // ── 34. toSubagentSpecs uses plan.goal when no prefix ─────────────────────
  it('toSubagentSpecs uses plan.goal when no prefix', () => {
    const p = planner.plan({
      goal: 'my-plan-goal',
      steps: [makeStep({ id: 'x', name: 'Do X' })],
    });
    const specs = planner.toSubagentSpecs(p);
    expect(specs[0]!.goal).toBe('my-plan-goal :: Do X');
  });

  // ── 35. toSubagentSpecs role defaults to worker ────────────────────────────
  it('toSubagentSpecs role defaults to worker', () => {
    const p = makePlan([makeStep({ id: 'x' })]); // no role set
    const specs = planner.toSubagentSpecs(p);
    expect(specs[0]!.role).toBe('worker');
  });

  // ── 36. alternative with cycle to parent → ignored (use original) ──────────
  it('alternative with cycle to parent → uses original', () => {
    const plan = makePlan([
      {
        id: 'a',
        name: 'A',
        estTokens: 1000,
        estDurationMs: 1000,
        estUsd: 0.5,
        alternatives: [
          {
            id: 'a-cyclic',
            name: 'A-cyclic',
            estTokens: 10,
            estDurationMs: 100,
            estUsd: 0.001, // cheaper, but depends on parent 'a' → cyclic
            dependsOn: ['a'],
          },
        ],
      },
    ]);
    // Even though a-cyclic is cheaper, it's ignored because it depends on 'a'
    expect(plan.steps[0]!.alternativeChosen).toBeUndefined();
  });

  // ── 37. successProb < 0 clamped to 0 ─────────────────────────────────────
  it('successProb < 0 clamped to 0 with warning', () => {
    const plan = makePlan(
      [makeStep({ id: 'a', estTokens: 100, estUsd: 0.1, estDurationMs: 1000, successProb: -0.5 })],
      { retryFactor: 1 },
    );
    // clamped to 0: retryMultiplier = 1 + 1*(1-0) = 2
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(0.2);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  // ── 38. Diamond DAG: totalExpectedDurationMs is critical-path time ─────────
  it('diamond DAG: totalExpectedDurationMs equals critical-path length', () => {
    const plan = makePlan([
      makeStep({ id: 'a', estDurationMs: 1000 }),
      makeStep({ id: 'b', dependsOn: ['a'], estDurationMs: 2000 }),
      makeStep({ id: 'c', dependsOn: ['a'], estDurationMs: 500 }),
      makeStep({ id: 'd', dependsOn: ['b', 'c'], estDurationMs: 1000 }),
    ]);
    // critical path: a(1000) → b(2000) → d(1000) = 4000ms
    expect(plan.totalExpectedDurationMs).toBe(4000);
    expect(plan.criticalPath).toEqual(['a', 'b', 'd']);
  });

  // ── 39. Steps in topo order (level field) ─────────────────────────────────
  it('step level field matches topological layer', () => {
    const plan = makePlan([
      makeStep({ id: 'root' }),
      makeStep({ id: 'mid', dependsOn: ['root'] }),
      makeStep({ id: 'leaf', dependsOn: ['mid'] }),
    ]);
    const byId = Object.fromEntries(plan.steps.map((s) => [s.id, s]));
    expect(byId['root']!.level).toBe(0);
    expect(byId['mid']!.level).toBe(1);
    expect(byId['leaf']!.level).toBe(2);
  });

  // ── 40. createCostAwareDAGPlanner defaultTokenPriceUsd option ─────────────
  it('createCostAwareDAGPlanner defaultTokenPriceUsd option honoured', () => {
    const p = createCostAwareDAGPlanner({ defaultTokenPriceUsd: 0.01 });
    const plan = p.plan({ goal: 'x', steps: [makeStep({ id: 'a', estTokens: 100 })] });
    expect(plan.steps[0]!.expectedUsd).toBeCloseTo(1.0);
  });
});

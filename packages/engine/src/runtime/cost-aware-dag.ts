/**
 * cost-aware-dag.ts — Pyrfor CostAwareDAGPlanner.
 *
 * Given a task spec and a list of available steps (each with cost estimates +
 * dependencies), produces an execution DAG that minimises expected cost subject
 * to a budget cap, supports critical-path scheduling, and emits a
 * topologically-sorted execution plan ready for SubagentOrchestrator.
 *
 * Pure TS, ESM-only, no native dependencies.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface DAGStepSpec {
  id: string;
  name: string;
  role?: string;
  dependsOn?: string[];
  estTokens: number;
  estDurationMs: number;
  estUsd?: number;
  optional?: boolean;
  /** Higher = keep first when dropping for budget. Default 1. */
  priority?: number;
  alternatives?: DAGStepSpec[];
  /** 0..1. Default 1 (certain success). */
  successProb?: number;
}

export interface DAGPlanRequest {
  goal: string;
  steps: DAGStepSpec[];
  budgetUsd?: number;
  budgetTokens?: number;
  budgetDurationMs?: number;
  /** Default 5e-6 USD/token */
  tokenPriceUsd?: number;
  /** Multiply estCost by 1+retryFactor*(1-successProb). Default 1. */
  retryFactor?: number;
  /** If true, optimise for time over cost. */
  preferDuration?: boolean;
}

export interface DAGPlannedStep {
  id: string;
  name: string;
  role?: string;
  dependsOn: string[];
  expectedTokens: number;
  expectedUsd: number;
  expectedDurationMs: number;
  earliestStartMs: number;
  earliestEndMs: number;
  /** Topological layer index (0-based). */
  level: number;
  /** Alternative id if a substitute was chosen. */
  alternativeChosen?: string;
}

export interface DAGPlan {
  goal: string;
  steps: DAGPlannedStep[];
  /** Step ids grouped by topological layer. */
  layers: string[][];
  criticalPath: string[];
  totalExpectedTokens: number;
  totalExpectedUsd: number;
  /** Critical-path duration (longest path end time). */
  totalExpectedDurationMs: number;
  /** Optional steps excluded to satisfy budget. */
  droppedSteps: string[];
  warnings: string[];
  feasible: boolean;
}

export interface CostAwareDAGPlanner {
  plan(req: DAGPlanRequest): DAGPlan;
  toSubagentSpecs(
    plan: DAGPlan,
    opts?: { goalPrefix?: string },
  ): Array<{ id: string; role: string; goal: string; dependsOn: string[] }>;
}

export interface CreateCostAwareDAGPlannerOptions {
  defaultTokenPriceUsd?: number;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface ComputedVariant {
  spec: DAGStepSpec;
  expectedTokens: number;
  expectedUsd: number;
  expectedDurationMs: number;
}

interface ChosenStep {
  originalId: string;
  originalSpec: DAGStepSpec;
  chosenSpec: DAGStepSpec;
  expectedTokens: number;
  expectedUsd: number;
  expectedDurationMs: number;
  alternativeChosen?: string;
}

interface TimingResult {
  earliestStart: Map<string, number>;
  earliestEnd: Map<string, number>;
}

interface ActivePlanState {
  activeOrder: string[];
  activeDeps: Map<string, string[]>;
  layers: string[][];
  earliestStart: Map<string, number>;
  earliestEnd: Map<string, number>;
  criticalPath: string[];
  criticalPathDuration: number;
  totalTokens: number;
  totalUsd: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 3-colour DFS cycle detection. Throws on first cycle found. */
function detectCycles(steps: DAGStepSpec[]): void {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const s of steps) {
    color.set(s.id, WHITE);
    adj.set(s.id, s.dependsOn ?? []);
  }

  const dfs = (id: string, path: string[]): void => {
    color.set(id, GRAY);
    for (const dep of adj.get(id) ?? []) {
      const c = color.get(dep);
      if (c === GRAY) {
        // Build the cycle string from where dep first appears in path
        const idx = path.indexOf(dep);
        const cycle = idx >= 0 ? [...path.slice(idx), dep] : [id, dep];
        throw new Error(`cycle detected: ${cycle.join('->')}`);
      }
      if (c === WHITE) {
        dfs(dep, [...path, dep]);
      }
    }
    color.set(id, BLACK);
  };

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      dfs(s.id, [s.id]);
    }
  }
}

/** Kahn topological sort returning both the flat order and BFS layers. */
function kahnSortWithLayers(
  ids: string[],
  deps: Map<string, string[]>,
): { order: string[]; layers: string[][] } {
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const id of ids) {
    inDegree.set(id, 0);
    children.set(id, []);
  }

  for (const id of ids) {
    for (const dep of deps.get(id) ?? []) {
      inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      const ch = children.get(dep);
      if (ch) ch.push(id);
    }
  }

  const order: string[] = [];
  const layers: string[][] = [];
  let queue = ids.filter((id) => inDegree.get(id) === 0).sort();

  while (queue.length > 0) {
    layers.push([...queue]);
    order.push(...queue);
    const next: string[] = [];
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        const deg = (inDegree.get(child) ?? 0) - 1;
        inDegree.set(child, deg);
        if (deg === 0) next.push(child);
      }
    }
    queue = next.sort();
  }

  return { order, layers };
}

/** Compute earliest start / end times in topological order. */
function computeEarliestTimes(
  order: string[],
  deps: Map<string, string[]>,
  chosenById: Map<string, ChosenStep>,
): TimingResult {
  const earliestStart = new Map<string, number>();
  const earliestEnd = new Map<string, number>();

  for (const id of order) {
    const stepDeps = deps.get(id) ?? [];
    const start = stepDeps.reduce((max, dep) => Math.max(max, earliestEnd.get(dep) ?? 0), 0);
    const duration = chosenById.get(id)?.expectedDurationMs ?? 0;
    earliestStart.set(id, start);
    earliestEnd.set(id, start + duration);
  }

  return { earliestStart, earliestEnd };
}

/**
 * Compute the critical path (longest path by end time).
 * Tie-break: lexicographically later id wins at both end-node selection
 * and predecessor selection — gives deterministic results for parallel paths.
 */
function computeCriticalPath(
  order: string[],
  deps: Map<string, string[]>,
  earliestEnd: Map<string, number>,
): string[] {
  if (order.length === 0) return [];

  // Find end node: max earliestEnd, tie-break by lex-later id
  let endNode = order[0]!;
  let maxEnd = earliestEnd.get(endNode) ?? 0;
  for (const id of order) {
    const end = earliestEnd.get(id) ?? 0;
    if (end > maxEnd || (end === maxEnd && id > endNode)) {
      maxEnd = end;
      endNode = id;
    }
  }

  // Walk back through predecessors
  const path: string[] = [endNode];
  let current = endNode;

  for (;;) {
    const preds = deps.get(current) ?? [];
    if (preds.length === 0) break;

    let bestPred = preds[0]!;
    let bestPredEnd = earliestEnd.get(bestPred) ?? 0;
    for (const p of preds) {
      const e = earliestEnd.get(p) ?? 0;
      if (e > bestPredEnd || (e === bestPredEnd && p > bestPred)) {
        bestPredEnd = e;
        bestPred = p;
      }
    }

    path.unshift(bestPred);
    current = bestPred;
  }

  return path;
}

/**
 * Compute expected cost metrics for one step spec, clamping successProb
 * and accumulating any warnings into the supplied array.
 */
function computeVariantCost(
  s: DAGStepSpec,
  tokenPriceUsd: number,
  retryFactor: number,
  warnings: string[],
  log: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void,
): ComputedVariant {
  let prob = s.successProb;

  if (prob === undefined) {
    log('info', `[cost-aware-dag] step "${s.id}" has no successProb; assuming 1.0`);
    prob = 1;
  } else if (prob < 0 || prob > 1) {
    const clamped = Math.min(1, Math.max(0, prob));
    warnings.push(
      `successProb ${prob} for step "${s.id}" clamped to ${clamped}`,
    );
    prob = clamped;
  }

  const tokenUsd = s.estTokens * tokenPriceUsd;
  const estUsd = s.estUsd ?? tokenUsd;
  const retryMultiplier = 1 + retryFactor * (1 - prob);

  return {
    spec: s,
    expectedTokens: s.estTokens * retryMultiplier,
    expectedUsd: estUsd * retryMultiplier,
    expectedDurationMs: s.estDurationMs * retryMultiplier,
  };
}

/** True if `candidate` is better than `current` given the optimisation mode. */
function isBetter(
  candidate: ComputedVariant,
  current: ComputedVariant,
  preferDuration: boolean,
): boolean {
  if (preferDuration) {
    if (candidate.expectedDurationMs < current.expectedDurationMs) return true;
    if (
      candidate.expectedDurationMs === current.expectedDurationMs &&
      candidate.expectedUsd < current.expectedUsd
    ) return true;
    return false;
  }
  if (candidate.expectedUsd < current.expectedUsd) return true;
  if (
    candidate.expectedUsd === current.expectedUsd &&
    candidate.expectedDurationMs < current.expectedDurationMs
  ) return true;
  return false;
}

/**
 * Pick the best variant (original + alternatives) for a step.
 * Alternatives that depend on the original step's id are silently ignored
 * (they would create a cycle to their parent).
 * Warnings are accumulated only for the chosen variant.
 */
function chooseBestVariant(
  original: DAGStepSpec,
  tokenPriceUsd: number,
  retryFactor: number,
  preferDuration: boolean,
  warnings: string[],
  log: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void,
): ChosenStep {
  const validAlts = (original.alternatives ?? []).filter(
    (alt) => !(alt.dependsOn ?? []).includes(original.id) && alt.id !== original.id,
  );

  const candidates = [original, ...validAlts];

  // Compute costs per candidate, collecting warnings per candidate separately
  const costed = candidates.map((c) => {
    const localWarnings: string[] = [];
    const variant = computeVariantCost(c, tokenPriceUsd, retryFactor, localWarnings, log);
    return { variant, localWarnings };
  });

  let bestIdx = 0;
  for (let i = 1; i < costed.length; i++) {
    if (isBetter(costed[i]!.variant, costed[bestIdx]!.variant, preferDuration)) {
      bestIdx = i;
    }
  }

  // Only surface warnings from the chosen variant
  warnings.push(...costed[bestIdx]!.localWarnings);

  const best = costed[bestIdx]!.variant;
  return {
    originalId: original.id,
    originalSpec: original,
    chosenSpec: best.spec,
    expectedTokens: best.expectedTokens,
    expectedUsd: best.expectedUsd,
    expectedDurationMs: best.expectedDurationMs,
    alternativeChosen: best.spec.id !== original.id ? best.spec.id : undefined,
  };
}

/**
 * Given a set of active step ids, (re)compute all plan state:
 * topo order, layers, timing, critical path, totals.
 */
function computeActivePlanState(
  activeIds: Set<string>,
  allDeps: Map<string, string[]>,
  fullOrder: string[],
  chosenById: Map<string, ChosenStep>,
): ActivePlanState {
  const activeOrder = fullOrder.filter((id) => activeIds.has(id));

  // Filter deps to only include active steps
  const activeDeps = new Map<string, string[]>();
  for (const id of activeIds) {
    activeDeps.set(id, (allDeps.get(id) ?? []).filter((d) => activeIds.has(d)));
  }

  // Re-derive layers from active order + active deps
  const { layers } = kahnSortWithLayers(activeOrder, activeDeps);

  const { earliestStart, earliestEnd } = computeEarliestTimes(
    activeOrder,
    activeDeps,
    chosenById,
  );

  const criticalPath = computeCriticalPath(activeOrder, activeDeps, earliestEnd);
  const criticalPathDuration =
    criticalPath.length > 0 ? (earliestEnd.get(criticalPath[criticalPath.length - 1]!) ?? 0) : 0;

  let totalTokens = 0;
  let totalUsd = 0;
  for (const id of activeIds) {
    const c = chosenById.get(id)!;
    totalTokens += c.expectedTokens;
    totalUsd += c.expectedUsd;
  }

  return {
    activeOrder,
    activeDeps,
    layers,
    earliestStart,
    earliestEnd,
    criticalPath,
    criticalPathDuration,
    totalTokens,
    totalUsd,
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCostAwareDAGPlanner(
  plannerOpts?: CreateCostAwareDAGPlannerOptions,
): CostAwareDAGPlanner {
  const defaultTokenPriceUsd = plannerOpts?.defaultTokenPriceUsd ?? 5e-6;
  const log = plannerOpts?.logger ?? ((): void => undefined);

  // ── plan ────────────────────────────────────────────────────────────────────

  function plan(req: DAGPlanRequest): DAGPlan {
    const warnings: string[] = [];
    const tokenPriceUsd = req.tokenPriceUsd ?? defaultTokenPriceUsd;
    const retryFactor = req.retryFactor ?? 1;
    const preferDuration = req.preferDuration ?? false;

    // Fast path: no steps
    if (req.steps.length === 0) {
      return {
        goal: req.goal,
        steps: [],
        layers: [],
        criticalPath: [],
        totalExpectedTokens: 0,
        totalExpectedUsd: 0,
        totalExpectedDurationMs: 0,
        droppedSteps: [],
        warnings: [],
        feasible: true,
      };
    }

    // ── Validate ─────────────────────────────────────────────────────────────

    const specById = new Map<string, DAGStepSpec>();
    for (const s of req.steps) specById.set(s.id, s);

    for (const s of req.steps) {
      for (const dep of s.dependsOn ?? []) {
        if (!specById.has(dep)) throw new Error(`unknown dep: ${dep}`);
      }
    }

    detectCycles(req.steps);

    // ── Choose best variant per step ─────────────────────────────────────────

    const chosenSteps: ChosenStep[] = req.steps.map((s) =>
      chooseBestVariant(s, tokenPriceUsd, retryFactor, preferDuration, warnings, log),
    );

    const chosenById = new Map<string, ChosenStep>();
    for (const c of chosenSteps) chosenById.set(c.originalId, c);

    // ── Topo sort (full graph) ────────────────────────────────────────────────

    const allDeps = new Map<string, string[]>();
    for (const s of req.steps) allDeps.set(s.id, s.dependsOn ?? []);

    const { order: fullOrder } = kahnSortWithLayers(
      req.steps.map((s) => s.id),
      allDeps,
    );

    // ── Initial plan state ────────────────────────────────────────────────────

    let activeIds = new Set(req.steps.map((s) => s.id));
    let state = computeActivePlanState(activeIds, allDeps, fullOrder, chosenById);

    // ── Budget enforcement ────────────────────────────────────────────────────

    const droppedSteps: string[] = [];

    const isOverBudget = (s: ActivePlanState): boolean =>
      (req.budgetUsd !== undefined && s.totalUsd > req.budgetUsd) ||
      (req.budgetTokens !== undefined && s.totalTokens > req.budgetTokens) ||
      (req.budgetDurationMs !== undefined && s.criticalPathDuration > req.budgetDurationMs);

    while (isOverBudget(state)) {
      // Find optional steps with no non-optional active dependent
      const droppable = [...activeIds].filter((id) => {
        if (!specById.get(id)!.optional) return false;
        for (const otherId of activeIds) {
          if (otherId === id) continue;
          const other = specById.get(otherId)!;
          // Never drop an optional step if a non-optional step depends on it
          if (!other.optional && (allDeps.get(otherId) ?? []).includes(id)) return false;
        }
        return true;
      });

      if (droppable.length === 0) break;

      // Sort: lowest priority first, then lex id for determinism
      droppable.sort((a, b) => {
        const pa = specById.get(a)!.priority ?? 1;
        const pb = specById.get(b)!.priority ?? 1;
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
      });

      const toDrop = droppable[0]!;
      activeIds = new Set(activeIds);
      activeIds.delete(toDrop);
      droppedSteps.push(toDrop);

      state = computeActivePlanState(activeIds, allDeps, fullOrder, chosenById);
    }

    // ── Feasibility & summary warnings ───────────────────────────────────────

    const feasible = !isOverBudget(state);
    if (!feasible) {
      warnings.push(
        'Budget infeasible after dropping all eligible optional steps',
      );
    }
    if (droppedSteps.length > 0) {
      warnings.push(`Dropped optional steps: ${droppedSteps.join(', ')}`);
    }

    // ── Build final planned steps (topological order) ─────────────────────────

    // Build level map from final layers
    const levelOf = new Map<string, number>();
    for (let l = 0; l < state.layers.length; l++) {
      for (const id of state.layers[l]!) levelOf.set(id, l);
    }

    const finalSteps: DAGPlannedStep[] = state.activeOrder.map((id) => {
      const c = chosenById.get(id)!;
      return {
        id,
        name: c.chosenSpec.name,
        role: c.chosenSpec.role,
        dependsOn: state.activeDeps.get(id) ?? [],
        expectedTokens: c.expectedTokens,
        expectedUsd: c.expectedUsd,
        expectedDurationMs: c.expectedDurationMs,
        earliestStartMs: state.earliestStart.get(id) ?? 0,
        earliestEndMs: state.earliestEnd.get(id) ?? 0,
        level: levelOf.get(id) ?? 0,
        alternativeChosen: c.alternativeChosen,
      };
    });

    return {
      goal: req.goal,
      steps: finalSteps,
      layers: state.layers,
      criticalPath: state.criticalPath,
      totalExpectedTokens: state.totalTokens,
      totalExpectedUsd: state.totalUsd,
      totalExpectedDurationMs: state.criticalPathDuration,
      droppedSteps,
      warnings,
      feasible,
    };
  }

  // ── toSubagentSpecs ─────────────────────────────────────────────────────────

  function toSubagentSpecs(
    planArg: DAGPlan,
    specOpts?: { goalPrefix?: string },
  ): Array<{ id: string; role: string; goal: string; dependsOn: string[] }> {
    const prefix = specOpts?.goalPrefix ?? planArg.goal;
    return planArg.steps.map((s) => ({
      id: s.id,
      role: s.role ?? 'worker',
      goal: `${prefix} :: ${s.name}`,
      dependsOn: s.dependsOn,
    }));
  }

  return { plan, toSubagentSpecs };
}

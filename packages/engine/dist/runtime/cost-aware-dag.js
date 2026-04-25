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
// ── Helpers ───────────────────────────────────────────────────────────────────
/** 3-colour DFS cycle detection. Throws on first cycle found. */
function detectCycles(steps) {
    var _a;
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const adj = new Map();
    for (const s of steps) {
        color.set(s.id, WHITE);
        adj.set(s.id, (_a = s.dependsOn) !== null && _a !== void 0 ? _a : []);
    }
    const dfs = (id, path) => {
        var _a;
        color.set(id, GRAY);
        for (const dep of (_a = adj.get(id)) !== null && _a !== void 0 ? _a : []) {
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
function kahnSortWithLayers(ids, deps) {
    var _a, _b, _c, _d;
    const inDegree = new Map();
    const children = new Map();
    for (const id of ids) {
        inDegree.set(id, 0);
        children.set(id, []);
    }
    for (const id of ids) {
        for (const dep of (_a = deps.get(id)) !== null && _a !== void 0 ? _a : []) {
            inDegree.set(id, ((_b = inDegree.get(id)) !== null && _b !== void 0 ? _b : 0) + 1);
            const ch = children.get(dep);
            if (ch)
                ch.push(id);
        }
    }
    const order = [];
    const layers = [];
    let queue = ids.filter((id) => inDegree.get(id) === 0).sort();
    while (queue.length > 0) {
        layers.push([...queue]);
        order.push(...queue);
        const next = [];
        for (const id of queue) {
            for (const child of (_c = children.get(id)) !== null && _c !== void 0 ? _c : []) {
                const deg = ((_d = inDegree.get(child)) !== null && _d !== void 0 ? _d : 0) - 1;
                inDegree.set(child, deg);
                if (deg === 0)
                    next.push(child);
            }
        }
        queue = next.sort();
    }
    return { order, layers };
}
/** Compute earliest start / end times in topological order. */
function computeEarliestTimes(order, deps, chosenById) {
    var _a, _b, _c;
    const earliestStart = new Map();
    const earliestEnd = new Map();
    for (const id of order) {
        const stepDeps = (_a = deps.get(id)) !== null && _a !== void 0 ? _a : [];
        const start = stepDeps.reduce((max, dep) => { var _a; return Math.max(max, (_a = earliestEnd.get(dep)) !== null && _a !== void 0 ? _a : 0); }, 0);
        const duration = (_c = (_b = chosenById.get(id)) === null || _b === void 0 ? void 0 : _b.expectedDurationMs) !== null && _c !== void 0 ? _c : 0;
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
function computeCriticalPath(order, deps, earliestEnd) {
    var _a, _b, _c, _d, _e;
    if (order.length === 0)
        return [];
    // Find end node: max earliestEnd, tie-break by lex-later id
    let endNode = order[0];
    let maxEnd = (_a = earliestEnd.get(endNode)) !== null && _a !== void 0 ? _a : 0;
    for (const id of order) {
        const end = (_b = earliestEnd.get(id)) !== null && _b !== void 0 ? _b : 0;
        if (end > maxEnd || (end === maxEnd && id > endNode)) {
            maxEnd = end;
            endNode = id;
        }
    }
    // Walk back through predecessors
    const path = [endNode];
    let current = endNode;
    for (;;) {
        const preds = (_c = deps.get(current)) !== null && _c !== void 0 ? _c : [];
        if (preds.length === 0)
            break;
        let bestPred = preds[0];
        let bestPredEnd = (_d = earliestEnd.get(bestPred)) !== null && _d !== void 0 ? _d : 0;
        for (const p of preds) {
            const e = (_e = earliestEnd.get(p)) !== null && _e !== void 0 ? _e : 0;
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
function computeVariantCost(s, tokenPriceUsd, retryFactor, warnings, log) {
    var _a;
    let prob = s.successProb;
    if (prob === undefined) {
        log('info', `[cost-aware-dag] step "${s.id}" has no successProb; assuming 1.0`);
        prob = 1;
    }
    else if (prob < 0 || prob > 1) {
        const clamped = Math.min(1, Math.max(0, prob));
        warnings.push(`successProb ${prob} for step "${s.id}" clamped to ${clamped}`);
        prob = clamped;
    }
    const tokenUsd = s.estTokens * tokenPriceUsd;
    const estUsd = (_a = s.estUsd) !== null && _a !== void 0 ? _a : tokenUsd;
    const retryMultiplier = 1 + retryFactor * (1 - prob);
    return {
        spec: s,
        expectedTokens: s.estTokens * retryMultiplier,
        expectedUsd: estUsd * retryMultiplier,
        expectedDurationMs: s.estDurationMs * retryMultiplier,
    };
}
/** True if `candidate` is better than `current` given the optimisation mode. */
function isBetter(candidate, current, preferDuration) {
    if (preferDuration) {
        if (candidate.expectedDurationMs < current.expectedDurationMs)
            return true;
        if (candidate.expectedDurationMs === current.expectedDurationMs &&
            candidate.expectedUsd < current.expectedUsd)
            return true;
        return false;
    }
    if (candidate.expectedUsd < current.expectedUsd)
        return true;
    if (candidate.expectedUsd === current.expectedUsd &&
        candidate.expectedDurationMs < current.expectedDurationMs)
        return true;
    return false;
}
/**
 * Pick the best variant (original + alternatives) for a step.
 * Alternatives that depend on the original step's id are silently ignored
 * (they would create a cycle to their parent).
 * Warnings are accumulated only for the chosen variant.
 */
function chooseBestVariant(original, tokenPriceUsd, retryFactor, preferDuration, warnings, log) {
    var _a;
    const validAlts = ((_a = original.alternatives) !== null && _a !== void 0 ? _a : []).filter((alt) => { var _a; return !((_a = alt.dependsOn) !== null && _a !== void 0 ? _a : []).includes(original.id) && alt.id !== original.id; });
    const candidates = [original, ...validAlts];
    // Compute costs per candidate, collecting warnings per candidate separately
    const costed = candidates.map((c) => {
        const localWarnings = [];
        const variant = computeVariantCost(c, tokenPriceUsd, retryFactor, localWarnings, log);
        return { variant, localWarnings };
    });
    let bestIdx = 0;
    for (let i = 1; i < costed.length; i++) {
        if (isBetter(costed[i].variant, costed[bestIdx].variant, preferDuration)) {
            bestIdx = i;
        }
    }
    // Only surface warnings from the chosen variant
    warnings.push(...costed[bestIdx].localWarnings);
    const best = costed[bestIdx].variant;
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
function computeActivePlanState(activeIds, allDeps, fullOrder, chosenById) {
    var _a, _b;
    const activeOrder = fullOrder.filter((id) => activeIds.has(id));
    // Filter deps to only include active steps
    const activeDeps = new Map();
    for (const id of activeIds) {
        activeDeps.set(id, ((_a = allDeps.get(id)) !== null && _a !== void 0 ? _a : []).filter((d) => activeIds.has(d)));
    }
    // Re-derive layers from active order + active deps
    const { layers } = kahnSortWithLayers(activeOrder, activeDeps);
    const { earliestStart, earliestEnd } = computeEarliestTimes(activeOrder, activeDeps, chosenById);
    const criticalPath = computeCriticalPath(activeOrder, activeDeps, earliestEnd);
    const criticalPathDuration = criticalPath.length > 0 ? ((_b = earliestEnd.get(criticalPath[criticalPath.length - 1])) !== null && _b !== void 0 ? _b : 0) : 0;
    let totalTokens = 0;
    let totalUsd = 0;
    for (const id of activeIds) {
        const c = chosenById.get(id);
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
export function createCostAwareDAGPlanner(plannerOpts) {
    var _a, _b;
    const defaultTokenPriceUsd = (_a = plannerOpts === null || plannerOpts === void 0 ? void 0 : plannerOpts.defaultTokenPriceUsd) !== null && _a !== void 0 ? _a : 5e-6;
    const log = (_b = plannerOpts === null || plannerOpts === void 0 ? void 0 : plannerOpts.logger) !== null && _b !== void 0 ? _b : (() => undefined);
    // ── plan ────────────────────────────────────────────────────────────────────
    function plan(req) {
        var _a, _b, _c, _d, _e;
        const warnings = [];
        const tokenPriceUsd = (_a = req.tokenPriceUsd) !== null && _a !== void 0 ? _a : defaultTokenPriceUsd;
        const retryFactor = (_b = req.retryFactor) !== null && _b !== void 0 ? _b : 1;
        const preferDuration = (_c = req.preferDuration) !== null && _c !== void 0 ? _c : false;
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
        const specById = new Map();
        for (const s of req.steps)
            specById.set(s.id, s);
        for (const s of req.steps) {
            for (const dep of (_d = s.dependsOn) !== null && _d !== void 0 ? _d : []) {
                if (!specById.has(dep))
                    throw new Error(`unknown dep: ${dep}`);
            }
        }
        detectCycles(req.steps);
        // ── Choose best variant per step ─────────────────────────────────────────
        const chosenSteps = req.steps.map((s) => chooseBestVariant(s, tokenPriceUsd, retryFactor, preferDuration, warnings, log));
        const chosenById = new Map();
        for (const c of chosenSteps)
            chosenById.set(c.originalId, c);
        // ── Topo sort (full graph) ────────────────────────────────────────────────
        const allDeps = new Map();
        for (const s of req.steps)
            allDeps.set(s.id, (_e = s.dependsOn) !== null && _e !== void 0 ? _e : []);
        const { order: fullOrder } = kahnSortWithLayers(req.steps.map((s) => s.id), allDeps);
        // ── Initial plan state ────────────────────────────────────────────────────
        let activeIds = new Set(req.steps.map((s) => s.id));
        let state = computeActivePlanState(activeIds, allDeps, fullOrder, chosenById);
        // ── Budget enforcement ────────────────────────────────────────────────────
        const droppedSteps = [];
        const isOverBudget = (s) => (req.budgetUsd !== undefined && s.totalUsd > req.budgetUsd) ||
            (req.budgetTokens !== undefined && s.totalTokens > req.budgetTokens) ||
            (req.budgetDurationMs !== undefined && s.criticalPathDuration > req.budgetDurationMs);
        while (isOverBudget(state)) {
            // Find optional steps with no non-optional active dependent
            const droppable = [...activeIds].filter((id) => {
                var _a;
                if (!specById.get(id).optional)
                    return false;
                for (const otherId of activeIds) {
                    if (otherId === id)
                        continue;
                    const other = specById.get(otherId);
                    // Never drop an optional step if a non-optional step depends on it
                    if (!other.optional && ((_a = allDeps.get(otherId)) !== null && _a !== void 0 ? _a : []).includes(id))
                        return false;
                }
                return true;
            });
            if (droppable.length === 0)
                break;
            // Sort: lowest priority first, then lex id for determinism
            droppable.sort((a, b) => {
                var _a, _b;
                const pa = (_a = specById.get(a).priority) !== null && _a !== void 0 ? _a : 1;
                const pb = (_b = specById.get(b).priority) !== null && _b !== void 0 ? _b : 1;
                if (pa !== pb)
                    return pa - pb;
                return a.localeCompare(b);
            });
            const toDrop = droppable[0];
            activeIds = new Set(activeIds);
            activeIds.delete(toDrop);
            droppedSteps.push(toDrop);
            state = computeActivePlanState(activeIds, allDeps, fullOrder, chosenById);
        }
        // ── Feasibility & summary warnings ───────────────────────────────────────
        const feasible = !isOverBudget(state);
        if (!feasible) {
            warnings.push('Budget infeasible after dropping all eligible optional steps');
        }
        if (droppedSteps.length > 0) {
            warnings.push(`Dropped optional steps: ${droppedSteps.join(', ')}`);
        }
        // ── Build final planned steps (topological order) ─────────────────────────
        // Build level map from final layers
        const levelOf = new Map();
        for (let l = 0; l < state.layers.length; l++) {
            for (const id of state.layers[l])
                levelOf.set(id, l);
        }
        const finalSteps = state.activeOrder.map((id) => {
            var _a, _b, _c, _d;
            const c = chosenById.get(id);
            return {
                id,
                name: c.chosenSpec.name,
                role: c.chosenSpec.role,
                dependsOn: (_a = state.activeDeps.get(id)) !== null && _a !== void 0 ? _a : [],
                expectedTokens: c.expectedTokens,
                expectedUsd: c.expectedUsd,
                expectedDurationMs: c.expectedDurationMs,
                earliestStartMs: (_b = state.earliestStart.get(id)) !== null && _b !== void 0 ? _b : 0,
                earliestEndMs: (_c = state.earliestEnd.get(id)) !== null && _c !== void 0 ? _c : 0,
                level: (_d = levelOf.get(id)) !== null && _d !== void 0 ? _d : 0,
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
    function toSubagentSpecs(planArg, specOpts) {
        var _a;
        const prefix = (_a = specOpts === null || specOpts === void 0 ? void 0 : specOpts.goalPrefix) !== null && _a !== void 0 ? _a : planArg.goal;
        return planArg.steps.map((s) => {
            var _a;
            return ({
                id: s.id,
                role: (_a = s.role) !== null && _a !== void 0 ? _a : 'worker',
                goal: `${prefix} :: ${s.name}`,
                dependsOn: s.dependsOn,
            });
        });
    }
    return { plan, toSubagentSpecs };
}

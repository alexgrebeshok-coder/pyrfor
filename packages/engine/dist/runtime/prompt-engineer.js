/**
 * prompt-engineer.ts — Pyrfor G+10: automated A/B testing harness for system-prompt variants.
 *
 * Captures per-session metrics (success, latency, tokens), assigns variants via
 * weighted random sampling, declares winners, and persists per-project experiment
 * profiles atomically.
 *
 * PERSISTENCE MODEL:
 *   Experiments stored in a single JSON file (default ~/.pyrfor/prompt-experiments.json).
 *   load() reads the file; save() uses an atomic tmp-then-rename pattern.
 *   Both are synchronous to keep the interface simple.
 *
 * VARIANT SAMPLING:
 *   Weighted random sampling via rng (default Math.random).
 *   Weight=0 variants are excluded from sampling.
 *   If all weights are 0, falls back to uniform distribution (treat each as weight=1).
 *
 * EVALUATION CRITERIA:
 *   success_rate : highest successes/sessions wins if delta >= significanceDelta
 *   latency      : lowest avg latency wins if (worst−best)/worst >= significanceDelta
 *   cost         : same as latency on totalCostUsd/sessions
 *   composite    : score = 0.6·successRate − 0.2·latencyNorm − 0.2·costNorm;
 *                  latencyNorm and costNorm are min-max normalised across variants;
 *                  highest score wins if delta >= significanceDelta
 *
 * STATUS SEMANTICS:
 *   won          = a non-control variant beat the control
 *   lost         = control beat every challenger
 *   inconclusive = no variant reached the significance threshold
 *   archived     = soft-deleted; excluded from default list() results
 *
 * NO-OP RULES:
 *   recordOutcome on archived / won / lost experiment returns current state unchanged.
 */
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
// ── ULID-like ID generation ───────────────────────────────────────────────────
function generateId() {
    return Date.now().toString(36) + randomBytes(10).toString('hex');
}
// ── Default metrics ───────────────────────────────────────────────────────────
function emptyMetrics() {
    return {
        sessions: 0,
        successes: 0,
        failures: 0,
        totalLatencyMs: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUsd: 0,
    };
}
// ── Atomic synchronous write (tmp + rename) ───────────────────────────────────
function atomicWriteSync(filePath, content) {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomBytes(4).toString('hex')}`);
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(tmp, content, 'utf8');
        renameSync(tmp, filePath);
    }
    catch (err) {
        try {
            unlinkSync(tmp);
        }
        catch (_a) {
            // best-effort cleanup
        }
        throw err;
    }
}
// ── createPromptEngineer ──────────────────────────────────────────────────────
export function createPromptEngineer(opts) {
    var _a;
    const filePath = (_a = opts === null || opts === void 0 ? void 0 : opts.filePath) !== null && _a !== void 0 ? _a : path.join(homedir(), '.pyrfor', 'prompt-experiments.json');
    const _experiments = new Map();
    // ── createExperiment ────────────────────────────────────────────────────────
    function createExperiment(input) {
        var _a, _b, _c;
        const id = generateId();
        const now = new Date().toISOString();
        const variants = input.variants.map((v) => {
            var _a;
            return ({
                id: generateId(),
                label: v.label,
                prompt: v.prompt,
                weight: (_a = v.weight) !== null && _a !== void 0 ? _a : 1,
                createdAt: now,
            });
        });
        const metrics = {};
        for (const v of variants) {
            metrics[v.id] = emptyMetrics();
        }
        const exp = {
            id,
            project: input.project,
            agent: input.agent,
            hypothesis: input.hypothesis,
            status: 'draft',
            variants,
            metrics,
            minSamplesPerVariant: (_a = input.minSamplesPerVariant) !== null && _a !== void 0 ? _a : 10,
            successCriterion: (_b = input.successCriterion) !== null && _b !== void 0 ? _b : 'success_rate',
            significanceDelta: (_c = input.significanceDelta) !== null && _c !== void 0 ? _c : 0.05,
            createdAt: now,
        };
        _experiments.set(id, exp);
        return exp;
    }
    // ── start ───────────────────────────────────────────────────────────────────
    function start(experimentId) {
        const exp = _experiments.get(experimentId);
        if (!exp || exp.status !== 'draft')
            return null;
        const updated = Object.assign(Object.assign({}, exp), { status: 'running' });
        _experiments.set(experimentId, updated);
        return updated;
    }
    // ── archive ─────────────────────────────────────────────────────────────────
    function archive(experimentId) {
        const exp = _experiments.get(experimentId);
        if (!exp)
            return null;
        const updated = Object.assign(Object.assign({}, exp), { status: 'archived' });
        _experiments.set(experimentId, updated);
        return updated;
    }
    // ── pickVariant ─────────────────────────────────────────────────────────────
    function pickVariant(opts) {
        var _a;
        const rng = (_a = opts.rng) !== null && _a !== void 0 ? _a : Math.random;
        // Find running experiments matching project.
        // If the experiment has an agent, the caller must provide the same agent.
        // Experiments without an agent match any caller (global experiments).
        const candidates = Array.from(_experiments.values()).filter((exp) => {
            if (exp.status !== 'running')
                return false;
            if (exp.project !== opts.project)
                return false;
            if (exp.agent !== undefined && exp.agent !== opts.agent)
                return false;
            return true;
        });
        if (candidates.length === 0)
            return null;
        // Pick the oldest (by createdAt ISO string — lexicographic sort is stable for ISO dates).
        candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const exp = candidates[0];
        // Weighted sampling: exclude weight=0 variants; fall back to uniform if all are 0.
        const nonZero = exp.variants.filter((v) => v.weight > 0);
        const pool = nonZero.length > 0 ? nonZero : exp.variants;
        if (pool.length === 0)
            return null;
        // When using uniform fallback (all weights were 0), treat each variant as weight=1.
        const getWeight = nonZero.length > 0 ? (v) => v.weight : () => 1;
        const totalWeight = pool.reduce((s, v) => s + getWeight(v), 0);
        const r = rng() * totalWeight;
        let cumulative = 0;
        let selected = pool[pool.length - 1]; // safety default (always overridden since r < totalWeight)
        for (const v of pool) {
            cumulative += getWeight(v);
            if (r < cumulative) {
                selected = v;
                break;
            }
        }
        return { experimentId: exp.id, variantId: selected.id, prompt: selected.prompt };
    }
    // ── recordOutcome ───────────────────────────────────────────────────────────
    function recordOutcome(experimentId, variantId, outcome) {
        var _a, _b, _c, _d;
        const exp = _experiments.get(experimentId);
        if (!exp)
            return null;
        // No-op for terminal states (per spec).
        if (exp.status === 'archived' || exp.status === 'won' || exp.status === 'lost') {
            return exp;
        }
        // Increment metrics for the target variant.
        const metrics = Object.assign({}, exp.metrics);
        const vm = Object.assign({}, ((_a = metrics[variantId]) !== null && _a !== void 0 ? _a : emptyMetrics()));
        vm.sessions++;
        if (outcome.success)
            vm.successes++;
        else
            vm.failures++;
        vm.totalLatencyMs += outcome.latencyMs;
        vm.totalTokensIn += (_b = outcome.tokensIn) !== null && _b !== void 0 ? _b : 0;
        vm.totalTokensOut += (_c = outcome.tokensOut) !== null && _c !== void 0 ? _c : 0;
        vm.totalCostUsd += (_d = outcome.costUsd) !== null && _d !== void 0 ? _d : 0;
        metrics[variantId] = vm;
        const updated = Object.assign(Object.assign({}, exp), { metrics });
        _experiments.set(experimentId, updated);
        // Auto-evaluate once all variants have reached the minimum sample threshold.
        // Only trigger when still 'running' to avoid re-running on inconclusive experiments.
        if (updated.status === 'running') {
            const allReached = updated.variants.every((v) => { var _a, _b; return ((_b = (_a = metrics[v.id]) === null || _a === void 0 ? void 0 : _a.sessions) !== null && _b !== void 0 ? _b : 0) >= updated.minSamplesPerVariant; });
            if (allReached) {
                evaluate(experimentId);
            }
        }
        return _experiments.get(experimentId);
    }
    // ── evaluate ────────────────────────────────────────────────────────────────
    function evaluate(experimentId) {
        var _a;
        const exp = _experiments.get(experimentId);
        if (!exp) {
            return { decided: false, status: 'draft', reason: 'Experiment not found' };
        }
        const { variants } = exp;
        if (variants.length === 0) {
            return { decided: false, status: exp.status, reason: 'No variants defined' };
        }
        // Require minimum samples for every variant before deciding.
        const allReached = variants.every((v) => { var _a, _b; return ((_b = (_a = exp.metrics[v.id]) === null || _a === void 0 ? void 0 : _a.sessions) !== null && _b !== void 0 ? _b : 0) >= exp.minSamplesPerVariant; });
        if (!allReached) {
            return {
                decided: false,
                status: exp.status,
                reason: 'Insufficient samples for all variants',
            };
        }
        // A single variant can never produce a comparison.
        if (variants.length === 1) {
            const result = Object.assign(Object.assign({}, exp), { status: 'inconclusive', decidedAt: new Date().toISOString() });
            _experiments.set(experimentId, result);
            return {
                decided: true,
                status: 'inconclusive',
                reason: 'Only one variant — no comparison possible',
            };
        }
        // Control = variant labelled 'control', falling back to first variant.
        const controlVariant = (_a = variants.find((v) => v.label === 'control')) !== null && _a !== void 0 ? _a : variants[0];
        // Defaults overwritten by each criterion branch.
        let winner = undefined;
        let newStatus = 'inconclusive';
        let reason = '';
        switch (exp.successCriterion) {
            case 'success_rate': {
                const rated = variants.map((v) => {
                    const m = exp.metrics[v.id];
                    return { id: v.id, rate: m.sessions > 0 ? m.successes / m.sessions : 0 };
                });
                rated.sort((a, b) => b.rate - a.rate);
                const best = rated[0];
                const second = rated[1];
                const delta = best.rate - second.rate;
                if (delta >= exp.significanceDelta) {
                    winner = best.id;
                    newStatus = winner === controlVariant.id ? 'lost' : 'won';
                    reason =
                        `Best: ${best.id} rate=${best.rate.toFixed(3)}, ` +
                            `delta=${delta.toFixed(3)} ≥ significanceDelta=${exp.significanceDelta}`;
                }
                else {
                    newStatus = 'inconclusive';
                    reason =
                        `delta=${delta.toFixed(3)} < significanceDelta=${exp.significanceDelta}`;
                }
                break;
            }
            case 'latency': {
                // Lower is better.
                const lats = variants.map((v) => {
                    const m = exp.metrics[v.id];
                    return { id: v.id, avg: m.sessions > 0 ? m.totalLatencyMs / m.sessions : 0 };
                });
                lats.sort((a, b) => a.avg - b.avg);
                const bestLat = lats[0];
                const worstLat = lats[lats.length - 1];
                const relLat = worstLat.avg > 0 ? (worstLat.avg - bestLat.avg) / worstLat.avg : 0;
                if (relLat >= exp.significanceDelta) {
                    winner = bestLat.id;
                    newStatus = winner === controlVariant.id ? 'lost' : 'won';
                    reason =
                        `Best: ${bestLat.id} avgLatency=${bestLat.avg.toFixed(0)}ms, ` +
                            `relImprovement=${(relLat * 100).toFixed(1)}% ≥ ${(exp.significanceDelta * 100).toFixed(1)}%`;
                }
                else {
                    newStatus = 'inconclusive';
                    reason =
                        `Latency relImprovement=${(relLat * 100).toFixed(1)}% ` +
                            `< ${(exp.significanceDelta * 100).toFixed(1)}% threshold`;
                }
                break;
            }
            case 'cost': {
                // Lower is better.
                const costs = variants.map((v) => {
                    const m = exp.metrics[v.id];
                    return { id: v.id, avg: m.sessions > 0 ? m.totalCostUsd / m.sessions : 0 };
                });
                costs.sort((a, b) => a.avg - b.avg);
                const bestCost = costs[0];
                const worstCost = costs[costs.length - 1];
                const relCost = worstCost.avg > 0 ? (worstCost.avg - bestCost.avg) / worstCost.avg : 0;
                if (relCost >= exp.significanceDelta) {
                    winner = bestCost.id;
                    newStatus = winner === controlVariant.id ? 'lost' : 'won';
                    reason =
                        `Best: ${bestCost.id} avgCost=${bestCost.avg.toFixed(5)}, ` +
                            `relImprovement=${(relCost * 100).toFixed(1)}% ≥ ${(exp.significanceDelta * 100).toFixed(1)}%`;
                }
                else {
                    newStatus = 'inconclusive';
                    reason =
                        `Cost relImprovement=${(relCost * 100).toFixed(1)}% ` +
                            `< ${(exp.significanceDelta * 100).toFixed(1)}% threshold`;
                }
                break;
            }
            case 'composite': {
                // Score = 0.6·successRate − 0.2·latencyNorm − 0.2·costNorm
                // latencyNorm and costNorm are min-max normalised across variants (range [0,1]).
                // When all variants share the same value, norm = 0 (no differentiation).
                const avgLats = variants.map((v) => {
                    const m = exp.metrics[v.id];
                    return m.sessions > 0 ? m.totalLatencyMs / m.sessions : 0;
                });
                const avgCosts = variants.map((v) => {
                    const m = exp.metrics[v.id];
                    return m.sessions > 0 ? m.totalCostUsd / m.sessions : 0;
                });
                const minLat = Math.min(...avgLats);
                const maxLat = Math.max(...avgLats);
                const minCost = Math.min(...avgCosts);
                const maxCost = Math.max(...avgCosts);
                const scored = variants.map((v, i) => {
                    const m = exp.metrics[v.id];
                    const sr = m.sessions > 0 ? m.successes / m.sessions : 0;
                    const latNorm = maxLat > minLat ? (avgLats[i] - minLat) / (maxLat - minLat) : 0;
                    const costNorm = maxCost > minCost ? (avgCosts[i] - minCost) / (maxCost - minCost) : 0;
                    const score = 0.6 * sr - 0.2 * latNorm - 0.2 * costNorm;
                    return { id: v.id, score };
                });
                scored.sort((a, b) => b.score - a.score);
                const bestComp = scored[0];
                const secondComp = scored[1];
                const deltaComp = bestComp.score - secondComp.score;
                if (deltaComp >= exp.significanceDelta) {
                    winner = bestComp.id;
                    newStatus = winner === controlVariant.id ? 'lost' : 'won';
                    reason =
                        `Best: ${bestComp.id} composite=${bestComp.score.toFixed(3)}, ` +
                            `delta=${deltaComp.toFixed(3)} ≥ significanceDelta=${exp.significanceDelta}`;
                }
                else {
                    newStatus = 'inconclusive';
                    reason =
                        `Composite delta=${deltaComp.toFixed(3)} ` +
                            `< significanceDelta=${exp.significanceDelta}`;
                }
                break;
            }
            default: {
                newStatus = 'inconclusive';
                reason = `Unknown criterion: ${String(exp.successCriterion)}`;
                break;
            }
        }
        const finalExp = Object.assign(Object.assign({}, exp), { status: newStatus, decidedAt: new Date().toISOString(), winner });
        _experiments.set(experimentId, finalExp);
        return {
            decided: newStatus !== 'inconclusive',
            status: newStatus,
            winner,
            reason,
        };
    }
    // ── list ────────────────────────────────────────────────────────────────────
    function list(filter) {
        let items = Array.from(_experiments.values());
        if ((filter === null || filter === void 0 ? void 0 : filter.status) !== undefined) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            items = items.filter((e) => statuses.includes(e.status));
        }
        else {
            // Default behaviour: exclude archived (soft-deleted) experiments.
            items = items.filter((e) => e.status !== 'archived');
        }
        if ((filter === null || filter === void 0 ? void 0 : filter.project) !== undefined) {
            items = items.filter((e) => e.project === filter.project);
        }
        return items;
    }
    // ── get ─────────────────────────────────────────────────────────────────────
    function get(experimentId) {
        var _a;
        return (_a = _experiments.get(experimentId)) !== null && _a !== void 0 ? _a : null;
    }
    // ── persistence ─────────────────────────────────────────────────────────────
    function load() {
        _experiments.clear();
        try {
            const raw = readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const exp of parsed) {
                    _experiments.set(exp.id, exp);
                }
            }
        }
        catch (err) {
            if (err instanceof SyntaxError) {
                console.warn('[PromptEngineer] Corrupt JSON store, starting empty:', filePath);
            }
            // Missing file or parse error → silently start empty; never throw.
        }
    }
    function save() {
        const items = Array.from(_experiments.values());
        atomicWriteSync(filePath, JSON.stringify(items, null, 2));
    }
    return {
        createExperiment,
        start,
        archive,
        pickVariant,
        recordOutcome,
        evaluate,
        list,
        get,
        load,
        save,
    };
}

/**
 * integration-harness.ts — Pyrfor integration-test composition harness.
 *
 * Wires runtime modules together with deterministic fakes (FakeLlm,
 * FakeClock) so integration tests can run without external services.
 *
 * DO NOT modify cli.ts or index.ts — this module only composes existing ones.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export function createFakeLlm() {
    const queue = [];
    const calls = [];
    return {
        calls,
        enqueue(call) {
            queue.push(call);
        },
        complete(prompt) {
            return __awaiter(this, void 0, void 0, function* () {
                if (queue.length === 0) {
                    throw new Error(`FakeLlm: complete() called with empty queue (prompt="${prompt.slice(0, 80)}")`);
                }
                const entry = queue.shift();
                const recorded = Object.assign(Object.assign({}, entry), { prompt });
                calls.push(recorded);
                return { text: entry.response, toolCalls: entry.toolCalls };
            });
        },
        stats() {
            return { totalCalls: calls.length, pending: queue.length };
        },
    };
}
export function createFakeClock(start = 0) {
    let current = start;
    let nextId = 1;
    const timers = [];
    function fireExpired() {
        // Sort so timers fire in deadline order; re-evaluate after each fire
        // because a fired callback could advance or add timers (not supported
        // here, but keeps semantics clean).
        let fired = true;
        while (fired) {
            fired = false;
            const sorted = timers
                .filter(t => !t.cancelled && t.deadline <= current)
                .sort((a, b) => a.deadline - b.deadline);
            for (const t of sorted) {
                if (!t.cancelled) {
                    t.cancelled = true; // mark before calling so clearTimeout inside cb is safe
                    fired = true;
                    t.cb();
                }
            }
        }
    }
    return {
        now() {
            return current;
        },
        advance(ms) {
            if (ms < 0)
                throw new Error('FakeClock.advance: ms must be non-negative');
            current += ms;
            fireExpired();
        },
        setTimeout(cb, ms) {
            const id = nextId++;
            timers.push({ id, deadline: current + ms, cb, cancelled: false });
            return id;
        },
        clearTimeout(id) {
            const t = timers.find(e => e.id === id);
            if (t)
                t.cancelled = true;
        },
    };
}
/**
 * Instantiate a single named module using a string-literal dynamic import
 * so bundlers can statically analyse the import graph.
 */
function loadModule(name, tmpDir, clock) {
    return __awaiter(this, void 0, void 0, function* () {
        const logger = (l, m, meta) => {
            // silenced during tests — swap for console if you need verbose output
            void l;
            void m;
            void meta;
        };
        switch (name) {
            case 'memory-wiki': {
                const mod = yield import('./memory-wiki.js');
                return mod.createMemoryWiki({
                    storePath: join(tmpDir, 'memory-wiki.json'),
                    clock: () => clock.now(),
                    logger,
                });
            }
            case 'skill-effectiveness': {
                const mod = yield import('./skill-effectiveness.js');
                return mod.createSkillEffectivenessTracker({
                    storePath: join(tmpDir, 'skill-effectiveness.json'),
                    clock: () => clock.now(),
                });
            }
            case 'runtime-profiler': {
                const mod = yield import('./runtime-profiler.js');
                return mod.createRuntimeProfiler({
                    tracePath: join(tmpDir, 'profiler-trace.jsonl'),
                    clock: () => clock.now(),
                });
            }
            case 'cron-persistence': {
                const mod = yield import('./cron-persistence.js');
                return mod.createCronPersistenceStore({
                    storePath: join(tmpDir, 'cron-persistence.json'),
                    clock: () => clock.now(),
                    logger,
                });
            }
            case 'guardrails': {
                const mod = yield import('./guardrails.js');
                return mod.createGuardrails({
                    auditPath: join(tmpDir, 'guardrails-audit.jsonl'),
                    clock: () => clock.now(),
                    logger,
                });
            }
            case 'cost-aware-dag': {
                const mod = yield import('./cost-aware-dag.js');
                return mod.createCostAwareDAGPlanner({ logger });
            }
            default: {
                const _exhaustive = name;
                throw new Error(`Unknown module: ${String(_exhaustive)}`);
            }
        }
    });
}
export function createIntegrationHarness() {
    return __awaiter(this, arguments, void 0, function* (opts = {}) {
        const { modules: requestedModules = [], tmpRoot } = opts;
        const root = tmpRoot !== null && tmpRoot !== void 0 ? tmpRoot : tmpdir();
        const tmpDir = mkdtempSync(join(root, 'pyrfor-harness-'));
        const llm = createFakeLlm();
        const clock = createFakeClock(0);
        const moduleMap = {};
        for (const name of requestedModules) {
            try {
                moduleMap[name] = yield loadModule(name, tmpDir, clock);
            }
            catch (err) {
                console.warn(`[integration-harness] skipping module "${name}": ${err.message}`);
            }
        }
        let cleaned = false;
        function cleanup() {
            return __awaiter(this, void 0, void 0, function* () {
                if (cleaned)
                    return;
                cleaned = true;
                // Flush any pending writes for modules that support it
                for (const inst of Object.values(moduleMap)) {
                    if (inst && typeof inst.flush === 'function') {
                        try {
                            yield inst.flush();
                        }
                        catch ( /* best-effort */_a) { /* best-effort */ }
                    }
                }
                if (existsSync(tmpDir)) {
                    rmSync(tmpDir, { recursive: true, force: true });
                }
            });
        }
        return { llm, clock, tmpDir, modules: moduleMap, cleanup };
    });
}
// ─── Snapshot helper ──────────────────────────────────────────────────────────
export function snapshotHarness(h) {
    return {
        llmStats: h.llm.stats(),
        moduleNames: Object.keys(h.modules),
        tmpDir: h.tmpDir,
    };
}

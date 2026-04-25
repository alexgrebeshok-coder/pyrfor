/**
 * pyrfor-fc-best-of-n.ts
 *
 * Orchestration strategy: spawn N parallel FreeClaude branches and pick the
 * winner by score.
 *
 * Each branch runs in its own workdir (default `${workdir}/.bestofn/branch-${i}`).
 * Parallelism is capped via a simple semaphore (default = n).
 * Failed branches receive score 0 and do not block the others.
 * Ties are broken by earliest index.
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
// ── Implementation ────────────────────────────────────────────────────────────
function runBranch(i, opts, branchDir) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const start = Date.now();
        const runOpts = {
            prompt: opts.prompt,
            workdir: branchDir,
        };
        if ((_a = opts.models) === null || _a === void 0 ? void 0 : _a[i]) {
            runOpts.model = opts.models[i];
        }
        try {
            const handle = opts.fcRunner(runOpts);
            const result = yield handle.complete();
            const envelope = result.envelope;
            const durationMs = Date.now() - start;
            if (envelope.status === 'error') {
                const score = { total: 0, breakdown: {} };
                return { i, envelope, score, workdir: branchDir, durationMs, error: (_b = envelope.error) !== null && _b !== void 0 ? _b : 'error status' };
            }
            const score = yield opts.scoreFn(envelope, branchDir);
            return { i, envelope, score, workdir: branchDir, durationMs };
        }
        catch (err) {
            const durationMs = Date.now() - start;
            const errorMsg = err instanceof Error ? err.message : String(err);
            const fakeEnvelope = {
                status: 'error',
                error: errorMsg,
                exitCode: -1,
                filesTouched: [],
                commandsRun: [],
                raw: {},
            };
            return {
                i,
                envelope: fakeEnvelope,
                score: { total: 0, breakdown: {} },
                workdir: branchDir,
                durationMs,
                error: errorMsg,
            };
        }
    });
}
export function runBestOfN(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const n = opts.n;
        const parallelism = (_a = opts.parallelism) !== null && _a !== void 0 ? _a : n;
        const getBranchDir = (_b = opts.branchWorkdir) !== null && _b !== void 0 ? _b : ((i) => `${opts.workdir}/.bestofn/branch-${i}`);
        const branches = new Array(n);
        // Queue-based semaphore to support multiple concurrent waiters
        let running = 0;
        const waitQueue = [];
        const release = () => {
            running--;
            const next = waitQueue.shift();
            if (next)
                next();
        };
        const acquire = () => {
            if (running < parallelism) {
                running++;
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                waitQueue.push(() => { running++; resolve(); });
            });
        };
        const tasks = Array.from({ length: n }, (_, i) => i).map((i) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            yield acquire();
            try {
                const branchDir = getBranchDir(i);
                const result = yield runBranch(i, opts, branchDir);
                branches[i] = result;
                (_a = opts.onBranchComplete) === null || _a === void 0 ? void 0 : _a.call(opts, i, result);
                return result;
            }
            finally {
                release();
            }
        }));
        yield Promise.all(tasks);
        // Pick winner: highest score, tie → earliest index
        let winner = branches[0];
        for (let i = 1; i < n; i++) {
            if (branches[i].score.total > winner.score.total) {
                winner = branches[i];
            }
        }
        const totalCostUsd = branches.reduce((sum, b) => { var _a; return sum + ((_a = b.envelope.costUsd) !== null && _a !== void 0 ? _a : 0); }, 0);
        return { winner, branches, totalCostUsd };
    });
}

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { spawn } from 'node:child_process';
export const VERDICT_RANK = {
    pass: 0,
    warn: 1,
    correct: 2,
    block: 3,
};
export function strongestVerdict(verdicts) {
    if (verdicts.length === 0)
        return 'pass';
    return verdicts.reduce((best, v) => (VERDICT_RANK[v] > VERDICT_RANK[best] ? v : best), 'pass');
}
export function runValidators(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const { validators, event, ctx, parallel = true } = opts;
        const applicable = validators.filter((v) => v.appliesTo(event));
        if (applicable.length === 0) {
            return { verdict: 'pass', results: [] };
        }
        if ((_a = ctx.abortSignal) === null || _a === void 0 ? void 0 : _a.aborted) {
            return {
                verdict: 'block',
                results: [{ validator: 'runValidators', verdict: 'block', message: 'aborted', durationMs: 0 }],
            };
        }
        const runOne = (v) => __awaiter(this, void 0, void 0, function* () {
            const start = Date.now();
            try {
                return yield v.validate(event, ctx);
            }
            catch (err) {
                const durationMs = Date.now() - start;
                const message = err instanceof Error ? err.message : String(err);
                return {
                    validator: v.name,
                    verdict: 'warn',
                    message: `validator threw: ${message}`,
                    durationMs,
                };
            }
        });
        let results;
        try {
            if (parallel) {
                const allPromise = Promise.all(applicable.map((v) => runOne(v)));
                if (ctx.abortSignal) {
                    const abortPromise = new Promise((_, reject) => {
                        const handler = () => reject(new Error('aborted'));
                        ctx.abortSignal.addEventListener('abort', handler, { once: true });
                        if (ctx.abortSignal.aborted)
                            handler();
                    });
                    results = yield Promise.race([allPromise, abortPromise]);
                }
                else {
                    results = yield allPromise;
                }
            }
            else {
                results = [];
                for (const v of applicable) {
                    if ((_b = ctx.abortSignal) === null || _b === void 0 ? void 0 : _b.aborted)
                        throw new Error('aborted');
                    results.push(yield runOne(v));
                }
            }
        }
        catch (err) {
            if (((_c = ctx.abortSignal) === null || _c === void 0 ? void 0 : _c.aborted) || (err instanceof Error && err.message === 'aborted')) {
                return {
                    verdict: 'block',
                    results: [{ validator: 'runValidators', verdict: 'block', message: 'aborted', durationMs: 0 }],
                };
            }
            throw err;
        }
        const verdict = strongestVerdict(results.map((r) => r.verdict));
        return { verdict, results };
    });
}
export function runShell(cmd, opts = {}) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const { cwd = process.cwd(), timeoutMs = 60000, abortSignal } = opts;
        const proc = spawn(cmd, [], {
            cwd,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        const timer = setTimeout(() => {
            proc.kill();
            reject(new Error(`Shell command timed out after ${timeoutMs}ms: ${cmd}`));
        }, timeoutMs);
        const abortHandler = () => {
            clearTimeout(timer);
            proc.kill();
            reject(new Error('aborted'));
        };
        abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.addEventListener('abort', abortHandler, { once: true });
        proc.on('close', (code) => {
            clearTimeout(timer);
            abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.removeEventListener('abort', abortHandler);
            resolve({
                stdout,
                stderr,
                exitCode: code !== null && code !== void 0 ? code : -1,
                durationMs: Date.now() - start,
            });
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            abortSignal === null || abortSignal === void 0 ? void 0 : abortSignal.removeEventListener('abort', abortHandler);
            reject(err);
        });
    });
}
// ── Path extraction helper ───────────────────────────────────────────────────
export function extractTouchedPaths(event) {
    const data = event.data;
    if (!data || typeof data !== 'object')
        return [];
    const paths = [];
    if (typeof data['path'] === 'string')
        paths.push(data['path']);
    if (typeof data['file'] === 'string')
        paths.push(data['file']);
    if (typeof data['from'] === 'string')
        paths.push(data['from']);
    if (typeof data['to'] === 'string')
        paths.push(data['to']);
    if (Array.isArray(data['paths'])) {
        for (const p of data['paths']) {
            if (typeof p === 'string')
                paths.push(p);
        }
    }
    if (Array.isArray(data['files'])) {
        for (const f of data['files']) {
            if (typeof f === 'string')
                paths.push(f);
        }
    }
    return paths;
}

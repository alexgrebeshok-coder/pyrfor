var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { renderPrompt } from './ralph-spec.js';
import { runVerify } from './verify-engine.js';
import { promises as fsp } from 'fs';
import path from 'path';
function appendProgress(file, p) {
    return __awaiter(this, void 0, void 0, function* () {
        const dir = path.dirname(file);
        yield fsp.mkdir(dir, { recursive: true });
        yield fsp.appendFile(file, JSON.stringify(p) + '\n', 'utf8');
    });
}
export function runRalph(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const { spec, agent, checks } = opts;
        const iterations = [];
        let lastVerify;
        let lastScore;
        let iteration = 1;
        while (true) {
            if ((_a = opts.abortSignal) === null || _a === void 0 ? void 0 : _a.aborted) {
                return {
                    status: 'aborted',
                    iterations,
                    finalScore: lastScore !== null && lastScore !== void 0 ? lastScore : 0,
                    reason: 'aborted before iteration',
                };
            }
            let progressStr = '';
            if (iterations.length > 0) {
                const lastOut = iterations[iterations.length - 1].output;
                progressStr = lastOut.length > 1500 ? lastOut.slice(-1500) : lastOut;
            }
            const renderCtx = {
                iteration,
                progress: progressStr,
                lessons: (_b = opts.lessons) !== null && _b !== void 0 ? _b : '',
            };
            if (lastScore !== undefined)
                renderCtx.lastScore = lastScore;
            if (lastVerify)
                renderCtx.lastVerify = lastVerify;
            const prompt = renderPrompt(spec, renderCtx);
            let agentOutput;
            try {
                const runOpts = {
                    iteration,
                };
                if (opts.abortSignal)
                    runOpts.abortSignal = opts.abortSignal;
                const result = yield agent.run(prompt, runOpts);
                agentOutput = result.output;
            }
            catch (err) {
                const verify = {
                    total: 0,
                    threshold: spec.scoreThreshold,
                    passed: false,
                    checks: [],
                    ts: Date.now(),
                };
                const progress = {
                    iteration,
                    score: 0,
                    passed: false,
                    output: err instanceof Error ? err.message : String(err),
                    verify,
                    ts: Date.now(),
                };
                iterations.push(progress);
                try {
                    (_c = opts.onProgress) === null || _c === void 0 ? void 0 : _c.call(opts, progress);
                }
                catch (_h) {
                    // ignore
                }
                if (opts.progressFile) {
                    try {
                        yield appendProgress(opts.progressFile, progress);
                    }
                    catch (_j) {
                        // ignore
                    }
                }
                lastVerify = verify;
                lastScore = 0;
                iteration++;
                if (iteration > spec.maxIterations) {
                    return {
                        status: 'max_iterations',
                        iterations,
                        finalScore: lastScore !== null && lastScore !== void 0 ? lastScore : 0,
                    };
                }
                continue;
            }
            if ((_d = opts.abortSignal) === null || _d === void 0 ? void 0 : _d.aborted) {
                return {
                    status: 'aborted',
                    iterations,
                    finalScore: lastScore !== null && lastScore !== void 0 ? lastScore : 0,
                    reason: 'aborted after agent.run',
                };
            }
            if (agentOutput.includes(spec.exitToken)) {
                const verify = {
                    total: 100,
                    threshold: spec.scoreThreshold,
                    passed: true,
                    checks: [],
                    ts: Date.now(),
                };
                const progress = {
                    iteration,
                    score: 100,
                    passed: true,
                    output: agentOutput,
                    verify,
                    ts: Date.now(),
                };
                iterations.push(progress);
                try {
                    (_e = opts.onProgress) === null || _e === void 0 ? void 0 : _e.call(opts, progress);
                }
                catch (_k) {
                    // ignore
                }
                if (opts.progressFile) {
                    try {
                        yield appendProgress(opts.progressFile, progress);
                    }
                    catch (_l) {
                        // ignore
                    }
                }
                return {
                    status: 'completed',
                    iterations,
                    finalScore: 100,
                    reason: 'exitToken detected',
                };
            }
            const verifyOpts = { threshold: spec.scoreThreshold };
            if (opts.cwd)
                verifyOpts.cwd = opts.cwd;
            if (opts.abortSignal)
                verifyOpts.abortSignal = opts.abortSignal;
            const verify = yield runVerify(checks, verifyOpts);
            if ((_f = opts.abortSignal) === null || _f === void 0 ? void 0 : _f.aborted) {
                return {
                    status: 'aborted',
                    iterations,
                    finalScore: verify.total,
                    reason: 'aborted after verify',
                };
            }
            const progress = {
                iteration,
                score: verify.total,
                passed: verify.passed,
                output: agentOutput,
                verify,
                ts: Date.now(),
            };
            iterations.push(progress);
            try {
                (_g = opts.onProgress) === null || _g === void 0 ? void 0 : _g.call(opts, progress);
            }
            catch (_m) {
                // ignore
            }
            if (opts.progressFile) {
                try {
                    yield appendProgress(opts.progressFile, progress);
                }
                catch (_o) {
                    // ignore
                }
            }
            lastVerify = verify;
            lastScore = verify.total;
            if (verify.passed) {
                return {
                    status: 'completed',
                    iterations,
                    finalScore: verify.total,
                    reason: 'verify passed',
                };
            }
            iteration++;
            if (iteration > spec.maxIterations) {
                return {
                    status: 'max_iterations',
                    iterations,
                    finalScore: verify.total,
                };
            }
        }
    });
}

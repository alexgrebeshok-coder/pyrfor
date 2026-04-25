var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ─── Orchestrator ─────────────────────────────────────────────────────────────
export function runRalphFc(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const history = [];
        let bestIter = null;
        let stoppedReason = 'max-iter';
        let finalIter = 0;
        let totalCostUsd = 0;
        for (let iter = 1; iter <= opts.maxIterations; iter++) {
            finalIter = iter;
            // ── Build context ──────────────────────────────────────────────────────
            let appendSystemPrompt;
            let resumeSessionId;
            if (opts.buildContextForIteration) {
                const ctx = yield opts.buildContextForIteration(iter, [...history]);
                appendSystemPrompt = ctx.appendSystemPrompt;
                resumeSessionId = ctx.resumeSessionId;
            }
            else if (iter > 1 && history.length > 0) {
                // Default: continue in previous session when no custom builder provided
                resumeSessionId =
                    (_a = history[history.length - 1].envelope.sessionId) !== null && _a !== void 0 ? _a : undefined;
            }
            const runOpts = {
                prompt: opts.prompt,
                workdir: opts.workdir,
                model: opts.fcModel,
                appendSystemPrompt,
                resume: resumeSessionId,
            };
            // ── Run FC ─────────────────────────────────────────────────────────────
            const t0 = Date.now();
            let envelope;
            try {
                const handle = opts.fcRunner(runOpts);
                const result = yield handle.complete();
                envelope = result.envelope;
            }
            catch (err) {
                envelope = {
                    status: 'error',
                    exitCode: 1,
                    filesTouched: [],
                    commandsRun: [],
                    error: String(err),
                    raw: {},
                };
            }
            const durationMs = Date.now() - t0;
            // ── Fatal check ────────────────────────────────────────────────────────
            if (envelope.status === 'error') {
                const iterResult = {
                    iter,
                    envelope,
                    score: { total: 0, breakdown: {} },
                    durationMs,
                    filesTouched: (_b = envelope.filesTouched) !== null && _b !== void 0 ? _b : [],
                    costUsd: (_c = envelope.costUsd) !== null && _c !== void 0 ? _c : 0,
                    abortReason: 'fatal',
                };
                totalCostUsd += iterResult.costUsd;
                if (!bestIter)
                    bestIter = iterResult;
                history.push(iterResult);
                (_d = opts.onIteration) === null || _d === void 0 ? void 0 : _d.call(opts, iterResult);
                (_e = opts.trajectory) === null || _e === void 0 ? void 0 : _e.append({
                    type: 'iteration',
                    iter,
                    score: 0,
                    durationMs,
                    abortReason: 'fatal',
                });
                stoppedReason = 'fatal';
                break;
            }
            // ── Score ──────────────────────────────────────────────────────────────
            const score = yield opts.scoreFn(envelope, opts.workdir);
            const costUsd = (_f = envelope.costUsd) !== null && _f !== void 0 ? _f : 0;
            totalCostUsd += costUsd;
            const iterResult = {
                iter,
                envelope,
                score,
                durationMs,
                filesTouched: (_g = envelope.filesTouched) !== null && _g !== void 0 ? _g : [],
                costUsd,
            };
            // Track best (strictly greater → ties keep earliest)
            if (!bestIter || score.total > bestIter.score.total) {
                bestIter = iterResult;
            }
            history.push(iterResult);
            (_h = opts.onIteration) === null || _h === void 0 ? void 0 : _h.call(opts, iterResult);
            (_j = opts.trajectory) === null || _j === void 0 ? void 0 : _j.append({
                type: 'iteration',
                iter,
                score: score.total,
                durationMs,
            });
            // ── Early-stop: score threshold ────────────────────────────────────────
            if (score.total >= opts.scoreThreshold) {
                iterResult.abortReason = 'threshold-reached';
                stoppedReason = 'threshold-reached';
                break;
            }
            // ── Early-stop: pluggable predicate ────────────────────────────────────
            if (opts.earlyStop) {
                const stopResult = opts.earlyStop.shouldStop({
                    history: [...history],
                    current: iterResult,
                });
                if (stopResult.stop) {
                    iterResult.abortReason = 'struggle';
                    stoppedReason = 'struggle';
                    break;
                }
            }
            // ── Early-stop: struggle detector ──────────────────────────────────────
            if (opts.struggleDetector) {
                const detectResult = opts.struggleDetector.detect([...history]);
                if (detectResult.stuck) {
                    iterResult.abortReason = 'struggle';
                    stoppedReason = 'struggle';
                    break;
                }
            }
            // ── Max iterations ─────────────────────────────────────────────────────
            if (iter === opts.maxIterations) {
                iterResult.abortReason = 'max-iter';
                stoppedReason = 'max-iter';
            }
        }
        return {
            finalIter,
            bestIter: bestIter,
            history,
            stoppedReason,
            totalCostUsd,
        };
    });
}

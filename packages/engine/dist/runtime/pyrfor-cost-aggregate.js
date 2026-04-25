/**
 * pyrfor-cost-aggregate.ts — Task-level cost aggregation for FC sessions.
 *
 * A Pyrfor task (e.g., one user request) spawns N FC sessions (Ralph loop, Best-of-N, Plan/Act).
 * This module tracks per-session cost and provides task-level totals.
 */
/**
 * Stateless helper: extract per-session cost from an envelope.
 */
export function envelopeToSessionCost(env, now) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    const clock = now !== null && now !== void 0 ? now : (() => Date.now());
    const ts = clock();
    // Extract usage with tolerant fallbacks
    const usage = (_a = env.usage) !== null && _a !== void 0 ? _a : {};
    const promptTokens = (_c = (_b = usage.input_tokens) !== null && _b !== void 0 ? _b : usage.prompt_tokens) !== null && _c !== void 0 ? _c : 0;
    const completionTokens = (_e = (_d = usage.output_tokens) !== null && _d !== void 0 ? _d : usage.completion_tokens) !== null && _e !== void 0 ? _e : 0;
    const cacheReadTokens = (_g = (_f = usage.cache_read_input_tokens) !== null && _f !== void 0 ? _f : usage.cache_read_tokens) !== null && _g !== void 0 ? _g : 0;
    const cacheCreationTokens = (_j = (_h = usage.cache_creation_input_tokens) !== null && _h !== void 0 ? _h : usage.cache_creation_tokens) !== null && _j !== void 0 ? _j : 0;
    const costUsd = (_k = env.costUsd) !== null && _k !== void 0 ? _k : 0;
    return {
        sessionId: env.sessionId,
        model: env.model,
        costUsd,
        promptTokens,
        completionTokens,
        cacheReadTokens,
        cacheCreationTokens,
        durationMs: env.durationMs,
        filesTouched: (_m = (_l = env.filesTouched) === null || _l === void 0 ? void 0 : _l.length) !== null && _m !== void 0 ? _m : 0,
        commandsRun: (_p = (_o = env.commandsRun) === null || _o === void 0 ? void 0 : _o.length) !== null && _p !== void 0 ? _p : 0,
        status: env.status,
        startedAt: ts,
        finishedAt: ts,
    };
}
export function createCostAggregator(opts) {
    var _a;
    const clock = (_a = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _a !== void 0 ? _a : (() => Date.now());
    const costTracker = opts === null || opts === void 0 ? void 0 : opts.costTracker;
    const tasks = new Map();
    let nextTaskId = 0;
    function buildSummary(state) {
        var _a, _b, _c, _d;
        const sessions = state.sessions;
        const totals = {
            sessions: sessions.length,
            costUsd: 0,
            promptTokens: 0,
            completionTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            filesTouched: 0,
            commandsRun: 0,
            durationMs: 0,
        };
        const byModel = {};
        for (const s of sessions) {
            totals.costUsd += s.costUsd;
            totals.promptTokens += s.promptTokens;
            totals.completionTokens += s.completionTokens;
            totals.cacheReadTokens += (_a = s.cacheReadTokens) !== null && _a !== void 0 ? _a : 0;
            totals.cacheCreationTokens += (_b = s.cacheCreationTokens) !== null && _b !== void 0 ? _b : 0;
            totals.filesTouched += s.filesTouched;
            totals.commandsRun += s.commandsRun;
            totals.durationMs += (_c = s.durationMs) !== null && _c !== void 0 ? _c : 0;
            const model = (_d = s.model) !== null && _d !== void 0 ? _d : 'unknown';
            if (!byModel[model]) {
                byModel[model] = { costUsd: 0, promptTokens: 0, completionTokens: 0, sessions: 0 };
            }
            byModel[model].costUsd += s.costUsd;
            byModel[model].promptTokens += s.promptTokens;
            byModel[model].completionTokens += s.completionTokens;
            byModel[model].sessions += 1;
        }
        return {
            taskId: state.taskId,
            startedAt: state.startedAt,
            finishedAt: state.finishedAt,
            sessions: [...sessions],
            totals,
            byModel,
        };
    }
    return {
        startTask(taskId) {
            const id = taskId !== null && taskId !== void 0 ? taskId : `task-${nextTaskId++}`;
            const ts = clock();
            tasks.set(id, {
                taskId: id,
                startedAt: ts,
                sessions: [],
            });
            return id;
        },
        recordFcRun(taskId, envelope) {
            var _a;
            const state = tasks.get(taskId);
            if (!state) {
                throw new Error(`Task not found: ${taskId}`);
            }
            const sessionCost = envelopeToSessionCost(envelope, clock);
            state.sessions.push(sessionCost);
            // Record to costTracker if provided
            if (costTracker) {
                const model = (_a = envelope.model) !== null && _a !== void 0 ? _a : 'unknown';
                costTracker.record(model, sessionCost.promptTokens, sessionCost.completionTokens, { sessionId: sessionCost.sessionId, taskId, source: 'fc' });
            }
            return sessionCost;
        },
        finishTask(taskId) {
            const state = tasks.get(taskId);
            if (!state) {
                throw new Error(`Task not found: ${taskId}`);
            }
            const ts = clock();
            state.finishedAt = ts;
            return buildSummary(state);
        },
        getSummary(taskId) {
            const state = tasks.get(taskId);
            if (!state) {
                return null;
            }
            return buildSummary(state);
        },
        listTasks() {
            return Array.from(tasks.values()).map(buildSummary);
        },
    };
}

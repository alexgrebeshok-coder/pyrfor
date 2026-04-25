var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { buildGatewayPrompt, parseGatewayResult } from './openclaw-gateway.js';
import { applyAIProposal } from './action-engine.js';
import { attachRunGrounding } from './grounding.js';
import { runDesktopLocalGatewayPrompt } from '../desktop/local-gateway.js';
import { logger } from '../observability/logger.js';
const runStore = new Map();
function createRunId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return `ai-run-${crypto.randomUUID()}`;
    }
    return `ai-run-${Math.random().toString(36).slice(2, 10)}`;
}
function cloneRun(run) {
    return JSON.parse(JSON.stringify(run));
}
function createQueuedRun(input, runId) {
    var _a;
    const now = new Date().toISOString();
    return {
        id: runId,
        sessionId: input.sessionId,
        agentId: input.agent.id,
        title: "AI Workspace Run",
        prompt: input.prompt,
        quickActionId: (_a = input.quickAction) === null || _a === void 0 ? void 0 : _a.id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        context: input.context.activeContext,
    };
}
function createFailedRun(run, error) {
    const message = error instanceof Error ? error.message : String(error);
    return Object.assign(Object.assign({}, run), { status: "failed", updatedAt: new Date().toISOString(), errorMessage: message, result: {
            title: "Local AI gateway failed",
            summary: message,
            highlights: [message],
            nextSteps: [],
            proposal: null,
        } });
}
function buildSessionKey(runId) {
    return `pm-dashboard:${runId}`;
}
export function createDesktopLocalGatewayAdapter() {
    return {
        mode: "gateway",
        runAgent(input) {
            return __awaiter(this, void 0, void 0, function* () {
                const { signal } = input, restInput = __rest(input, ["signal"]);
                const runId = createRunId();
                const run = createQueuedRun(restInput, runId);
                runStore.set(runId, { input: restInput, run });
                if (signal === null || signal === void 0 ? void 0 : signal.aborted) {
                    throw new Error("Request aborted");
                }
                try {
                    const prompt = buildGatewayPrompt(restInput, runId);
                    const response = yield runDesktopLocalGatewayPrompt({
                        prompt,
                        runId,
                        sessionKey: buildSessionKey(runId),
                        model: "openclaw:main",
                    });
                    const result = attachRunGrounding(parseGatewayResult(response.content, runId), restInput);
                    const finalRun = Object.assign(Object.assign({}, run), { title: result.title || run.title, status: "done", updatedAt: new Date().toISOString(), result });
                    runStore.set(runId, {
                        input: restInput,
                        run,
                        finalRun,
                    });
                    return cloneRun(finalRun);
                }
                catch (error) {
                    logger.warn("Local desktop gateway failed", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    const failedRun = createFailedRun(run, error);
                    runStore.set(runId, {
                        input: restInput,
                        run,
                        finalRun: failedRun,
                    });
                    return cloneRun(failedRun);
                }
            });
        },
        getRun(runId) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a;
                const entry = runStore.get(runId);
                if (!entry) {
                    throw new Error(`Unknown local gateway run: ${runId}`);
                }
                return cloneRun((_a = entry.finalRun) !== null && _a !== void 0 ? _a : entry.run);
            });
        },
        applyProposal(input) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c;
                const entry = runStore.get(input.runId);
                const run = (_a = entry === null || entry === void 0 ? void 0 : entry.finalRun) !== null && _a !== void 0 ? _a : entry === null || entry === void 0 ? void 0 : entry.run;
                if (!run) {
                    throw new Error(`Unknown local gateway run: ${input.runId}`);
                }
                const nextRun = applyAIProposal(run, input.proposalId);
                const nextEntry = entry !== null && entry !== void 0 ? entry : {
                    input: (_c = (_b = runStore.get(input.runId)) === null || _b === void 0 ? void 0 : _b.input) !== null && _c !== void 0 ? _c : {},
                    run,
                };
                runStore.set(input.runId, Object.assign(Object.assign({}, nextEntry), { finalRun: nextRun }));
                return cloneRun(nextRun);
            });
        },
    };
}

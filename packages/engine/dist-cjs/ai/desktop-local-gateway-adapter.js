"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDesktopLocalGatewayAdapter = createDesktopLocalGatewayAdapter;
const openclaw_gateway_1 = require("./openclaw-gateway");
const action_engine_1 = require("./action-engine");
const grounding_1 = require("./grounding");
const local_gateway_1 = require("../desktop/local-gateway");
const logger_1 = require("../observability/logger");
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
    const now = new Date().toISOString();
    return {
        id: runId,
        sessionId: input.sessionId,
        agentId: input.agent.id,
        title: "AI Workspace Run",
        prompt: input.prompt,
        quickActionId: input.quickAction?.id,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        context: input.context.activeContext,
    };
}
function createFailedRun(run, error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        ...run,
        status: "failed",
        updatedAt: new Date().toISOString(),
        errorMessage: message,
        result: {
            title: "Local AI gateway failed",
            summary: message,
            highlights: [message],
            nextSteps: [],
            proposal: null,
        },
    };
}
function buildSessionKey(runId) {
    return `pm-dashboard:${runId}`;
}
function createDesktopLocalGatewayAdapter() {
    return {
        mode: "gateway",
        async runAgent(input) {
            const { signal, ...restInput } = input;
            const runId = createRunId();
            const run = createQueuedRun(restInput, runId);
            runStore.set(runId, { input: restInput, run });
            if (signal?.aborted) {
                throw new Error("Request aborted");
            }
            try {
                const prompt = (0, openclaw_gateway_1.buildGatewayPrompt)(restInput, runId);
                const response = await (0, local_gateway_1.runDesktopLocalGatewayPrompt)({
                    prompt,
                    runId,
                    sessionKey: buildSessionKey(runId),
                    model: "openclaw:main",
                });
                const result = (0, grounding_1.attachRunGrounding)((0, openclaw_gateway_1.parseGatewayResult)(response.content, runId), restInput);
                const finalRun = {
                    ...run,
                    title: result.title || run.title,
                    status: "done",
                    updatedAt: new Date().toISOString(),
                    result,
                };
                runStore.set(runId, {
                    input: restInput,
                    run,
                    finalRun,
                });
                return cloneRun(finalRun);
            }
            catch (error) {
                logger_1.logger.warn("Local desktop gateway failed", {
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
        },
        async getRun(runId) {
            const entry = runStore.get(runId);
            if (!entry) {
                throw new Error(`Unknown local gateway run: ${runId}`);
            }
            return cloneRun(entry.finalRun ?? entry.run);
        },
        async applyProposal(input) {
            const entry = runStore.get(input.runId);
            const run = entry?.finalRun ?? entry?.run;
            if (!run) {
                throw new Error(`Unknown local gateway run: ${input.runId}`);
            }
            const nextRun = (0, action_engine_1.applyAIProposal)(run, input.proposalId);
            const nextEntry = entry ?? {
                input: runStore.get(input.runId)?.input ?? {},
                run,
            };
            runStore.set(input.runId, {
                ...nextEntry,
                finalRun: nextRun,
            });
            return cloneRun(nextRun);
        },
    };
}

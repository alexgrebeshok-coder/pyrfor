var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var _a;
import "server-only";
import { getAgentById } from './agents';
import { runAgentExecution } from './agent-executor';
import { agentBus } from './messaging/agent-bus';
import { buildMemoryContext, storeMemory } from './memory/agent-memory-store';
import { buildGatewayPrompt, invokeOpenClawGateway, parseGatewayResult, } from './openclaw-gateway';
import { getEnrichedAgentById } from './server-agent-config';
import { attachRunGrounding } from './grounding';
import { runWithReflection, shouldReflect } from './orchestration/reflection';
import { getRouter } from './providers';
import { buildDynamicPlan } from './orchestration/planner';
import { buildRAGContext } from './rag/document-indexer';
import { logger } from '../observability/logger';
const DEFAULT_SUPPORT_CONCURRENCY = Math.max(1, Number.parseInt((_a = process.env.MULTI_AGENT_SUPPORT_CONCURRENCY) !== null && _a !== void 0 ? _a : "3", 10) || 3);
function runWithConcurrency(items, limit, worker) {
    return __awaiter(this, void 0, void 0, function* () {
        const results = new Array(items.length);
        const safeLimit = Math.max(1, Math.min(limit, items.length || 1));
        let cursor = 0;
        const run = () => __awaiter(this, void 0, void 0, function* () {
            while (true) {
                const currentIndex = cursor;
                cursor += 1;
                if (currentIndex >= items.length)
                    return;
                results[currentIndex] = yield worker(items[currentIndex], currentIndex);
            }
        });
        const workers = Array.from({ length: safeLimit }, () => run());
        yield Promise.all(workers);
        return results;
    });
}
function humanizeAgentId(agentId) {
    return agentId
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (match) => match.toUpperCase());
}
function getAgentLabel(agentId) {
    return humanizeAgentId(agentId);
}
function dedupeStrings(values) {
    const seen = new Set();
    return values.filter((value) => {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed.toLowerCase())) {
            return false;
        }
        seen.add(trimmed.toLowerCase());
        return true;
    });
}
function buildFocusPrompt(agentId, focus, prompt) {
    return [
        prompt.trim(),
        "",
        `Specialist focus for ${humanizeAgentId(agentId)}:`,
        focus,
        "",
        "Keep the answer executive, specific, and grounded in the current context.",
        "Return the strongest facts, risks, and next steps from your specialist perspective only.",
    ].join("\n");
}
export function shouldUseCollaborativeRun(input) {
    // Delegate to dynamic planner — replaces hardcoded COLLABORATIVE_KEYS set
    const plan = buildDynamicPlan(input);
    return plan.collaborative;
}
export function buildCollaborativePlan(input) {
    // Delegate to the dynamic planner (replaces hardcoded BLUEPRINTS lookup)
    const dynamicPlan = buildDynamicPlan(input);
    const leaderAgentName = getAgentLabel(dynamicPlan.leaderAgentId);
    // Convert dynamic plan steps → legacy CollaborationFocus format
    const support = dynamicPlan.steps.map((s) => ({
        agentId: s.agentId,
        focus: s.focus,
    }));
    return {
        collaborative: dynamicPlan.collaborative,
        leaderAgentId: dynamicPlan.leaderAgentId,
        leaderAgentName,
        support,
        reason: dynamicPlan.reason,
    };
}
function chooseProviderRuntime(router, leader) {
    var _a, _b, _c;
    const provider = (_a = router.getAvailableProviders()[0]) !== null && _a !== void 0 ? _a : "openrouter";
    const modelMatrix = {
        gateway: {
            leader: ((_b = process.env.OPENCLAW_GATEWAY_MODEL) === null || _b === void 0 ? void 0 : _b.trim()) || "openclaw:main",
            support: ((_c = process.env.OPENCLAW_GATEWAY_MODEL) === null || _c === void 0 ? void 0 : _c.trim()) || "openclaw:main",
        },
        gigachat: { leader: "GigaChat-Pro", support: "GigaChat" },
        yandexgpt: { leader: "yandexgpt", support: "yandexgpt-lite" },
        aijora: { leader: "gpt-4o", support: "gpt-4o-mini" },
        polza: { leader: "openai/gpt-4o-mini", support: "openai/gpt-4o-mini" },
        openrouter: { leader: "google/gemma-3-27b-it:free", support: "google/gemma-3-12b-it:free" },
        bothub: { leader: "gpt-4o", support: "gpt-4o-mini" },
        zai: { leader: "glm-5", support: "glm-4.7-flash" },
        openai: { leader: "gpt-5.2", support: "gpt-4o-mini" },
    };
    const matrix = modelMatrix[provider] || modelMatrix.openrouter;
    return {
        provider,
        model: leader ? matrix.leader : matrix.support,
    };
}
function resolveProjectId(input) {
    var _a, _b;
    return (_b = (_a = input.source) === null || _a === void 0 ? void 0 : _a.projectId) !== null && _b !== void 0 ? _b : input.context.activeContext.projectId;
}
function buildAugmentedPrompt(input, basePrompt) {
    return __awaiter(this, void 0, void 0, function* () {
        const projectId = resolveProjectId(input);
        const query = basePrompt.trim();
        if (!query) {
            return basePrompt;
        }
        const [memoryContext, ragContext] = yield Promise.all([
            buildMemoryContext(input.agent.id, query, {
                projectId,
                limit: 5,
            }),
            projectId
                ? buildRAGContext(query, {
                    projectId,
                    limit: 5,
                })
                : Promise.resolve(""),
        ]);
        return [query, memoryContext, ragContext]
            .filter((section) => section.trim().length > 0)
            .join("\n\n");
    });
}
function rememberResult(input, result) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const summary = ((_a = result.summary) === null || _a === void 0 ? void 0 : _a.trim()) || ((_b = result.title) === null || _b === void 0 ? void 0 : _b.trim());
        if (!summary)
            return;
        try {
            yield storeMemory({
                agentId: input.agent.id,
                projectId: resolveProjectId(input),
                memoryType: "episodic",
                content: summary,
                summary: ((_c = result.title) === null || _c === void 0 ? void 0 : _c.trim()) || summary.slice(0, 160),
                importance: result.proposal ? 0.8 : 0.6,
                metadata: {
                    runSource: (_e = (_d = input.source) === null || _d === void 0 ? void 0 : _d.workflow) !== null && _e !== void 0 ? _e : "collaborative_runtime",
                    quickActionId: (_g = (_f = input.quickAction) === null || _f === void 0 ? void 0 : _f.id) !== null && _g !== void 0 ? _g : null,
                },
            });
        }
        catch (error) {
            logger.warn("multi-agent-runtime: failed to persist agent memory", {
                agentId: input.agent.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
function runStructuredPrompt(input_1, runId_1, strategy_1, promptOverride_1, router_1) {
    return __awaiter(this, arguments, void 0, function* (input, runId, strategy, promptOverride, router, runtimeRole = "leader") {
        var _a, _b, _c, _d;
        const promptText = yield buildAugmentedPrompt(input, promptOverride);
        if (strategy === "gateway") {
            return invokeOpenClawGateway(input, runId, { promptOverride: promptText });
        }
        const runtime = chooseProviderRuntime(router, runtimeRole === "leader");
        const enrichedAgent = yield getEnrichedAgentById(input.agent.id);
        const messages = [{ role: "user", content: promptText }];
        yield agentBus.publish("agent.started", {
            runId,
            role: runtimeRole,
            prompt: promptText.slice(0, 200),
        }, {
            source: input.agent.id,
            runId,
        });
        let rawText = "";
        try {
            if (runtimeRole === "leader" &&
                shouldReflect(promptText, input.agent.id) &&
                !((_b = (_a = enrichedAgent === null || enrichedAgent === void 0 ? void 0 : enrichedAgent.config.capabilities) === null || _a === void 0 ? void 0 : _a.canCallTools) !== null && _b !== void 0 ? _b : false)) {
                const reflected = yield runWithReflection(messages, {
                    provider: runtime.provider,
                    model: runtime.model,
                    agentId: input.agent.id,
                    runId,
                });
                rawText = reflected.finalResponse;
            }
            else {
                const execution = yield runAgentExecution(messages, {
                    agentId: input.agent.id,
                    runId,
                    router,
                    provider: runtime.provider,
                    model: runtime.model,
                    maxToolRounds: 5,
                    signal: input.signal,
                    enableTools: (_d = (_c = enrichedAgent === null || enrichedAgent === void 0 ? void 0 : enrichedAgent.config.capabilities) === null || _c === void 0 ? void 0 : _c.canCallTools) !== null && _d !== void 0 ? _d : false,
                    safetyLevel: "strict",
                });
                rawText = execution.finalContent;
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            yield agentBus.publish("agent.failed", {
                runId,
                role: runtimeRole,
                error: message,
            }, {
                source: input.agent.id,
                runId,
            });
            throw error;
        }
        try {
            const grounded = attachRunGrounding(parseGatewayResult(rawText, runId), input);
            yield rememberResult(input, grounded);
            yield agentBus.publish("agent.completed", {
                runId,
                role: runtimeRole,
                status: "success",
            }, {
                source: input.agent.id,
                runId,
            });
            return grounded;
        }
        catch (error) {
            const fallback = rawText.trim();
            logger.warn("Provider collaborative output was not JSON, using fallback summary", {
                agentId: input.agent.id,
                error: error instanceof Error ? error.message : String(error),
            });
            const grounded = attachRunGrounding({
                title: `${humanizeAgentId(input.agent.id)} synthesis`,
                summary: fallback || "No structured output returned.",
                highlights: fallback ? [fallback.slice(0, 240)] : ["No highlights returned."],
                nextSteps: [],
                proposal: null,
            }, input);
            yield rememberResult(input, grounded);
            yield agentBus.publish("agent.completed", {
                runId,
                role: runtimeRole,
                status: "success",
                fallback: true,
            }, {
                source: input.agent.id,
                runId,
            });
            return grounded;
        }
    });
}
function buildSupportResultPrompt(input, runId) {
    return buildGatewayPrompt(input, runId);
}
function buildSynthesisPrompt(input, plan, supportOutputs) {
    const supportSummary = supportOutputs
        .map((step, index) => {
        const highlights = step.highlights.length
            ? step.highlights.map((item) => `- ${item}`).join("\n")
            : "- No highlights returned.";
        const nextSteps = step.nextSteps.length
            ? step.nextSteps.map((item) => `- ${item}`).join("\n")
            : "- No next steps returned.";
        const proposalLine = step.proposalType ? `Proposal signal: ${step.proposalType}` : "Proposal signal: none";
        return [
            `${index + 1}. ${humanizeAgentId(step.agentId)} (${step.role})`,
            `Summary: ${step.summary}`,
            proposalLine,
            "Highlights:",
            highlights,
            "Next steps:",
            nextSteps,
        ].join("\n");
    })
        .join("\n\n");
    return [
        input.prompt.trim(),
        "",
        "You are now the final synthesizer in a multi-agent CEOClaw council.",
        `Lead perspective: ${humanizeAgentId(plan.leaderAgentId)}.`,
        `Council reason: ${plan.reason}`,
        "",
        "Supporting specialist outputs:",
        supportSummary,
        "",
        "Synthesize the council into one decisive executive answer.",
        "Keep the best evidence, resolve conflicts, and if the request implies execution, produce the cleanest approval-ready proposal.",
    ].join("\n");
}
function buildConsensusPoints(result, supportOutputs) {
    var _a;
    const candidatePoints = [
        ...((_a = result.highlights) !== null && _a !== void 0 ? _a : []),
        ...supportOutputs.flatMap((step) => step.highlights.slice(0, 1)),
        ...supportOutputs.flatMap((step) => step.nextSteps.slice(0, 1)),
    ];
    return dedupeStrings(candidatePoints).slice(0, 5);
}
function buildCollaborativeStep(agentId, focus, result, runtime, status, error) {
    var _a, _b, _c, _d;
    return Object.assign({ agentId, agentName: humanizeAgentId(agentId), role: getAgentLabel(agentId), focus,
        status,
        runtime, title: result.title || `${humanizeAgentId(agentId)} response`, summary: result.summary || (status === "failed" ? error !== null && error !== void 0 ? error : "Execution failed." : "No summary returned."), highlights: (_a = result.highlights) !== null && _a !== void 0 ? _a : [], nextSteps: (_b = result.nextSteps) !== null && _b !== void 0 ? _b : [], proposalType: (_d = (_c = result.proposal) === null || _c === void 0 ? void 0 : _c.type) !== null && _d !== void 0 ? _d : null }, (error ? { error } : {}));
}
function executeCollaborativeFallback(input, runId, strategy, router, plan, supportConcurrency, onStep) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const supportResults = yield runWithConcurrency(plan.support, supportConcurrency, (_a) => __awaiter(this, [_a], void 0, function* ({ agentId, focus }) {
            var _b, _c, _d;
            try {
                const agent = (_b = getAgentById(agentId)) !== null && _b !== void 0 ? _b : input.agent;
                const stepInput = Object.assign(Object.assign({}, input), { agent, prompt: buildFocusPrompt(agentId, focus, input.prompt) });
                const stepRunId = `${runId}-${agentId}`;
                const stepPrompt = buildSupportResultPrompt(stepInput, stepRunId);
                const result = yield runStructuredPrompt(stepInput, stepRunId, strategy, stepPrompt, router, "support");
                const runtime = chooseProviderRuntime(router, false);
                const stepRecord = {
                    agentId,
                    agentName: humanizeAgentId(agentId),
                    role: getAgentLabel(agentId),
                    focus,
                    status: "done",
                    runtime,
                    title: result.title,
                    summary: result.summary,
                    highlights: result.highlights,
                    nextSteps: result.nextSteps,
                    proposalType: (_d = (_c = result.proposal) === null || _c === void 0 ? void 0 : _c.type) !== null && _d !== void 0 ? _d : null,
                };
                try {
                    onStep === null || onStep === void 0 ? void 0 : onStep(stepRecord);
                }
                catch (cbError) {
                    logger.warn("multi-agent-runtime: onStep callback failed", {
                        error: cbError instanceof Error ? cbError.message : String(cbError),
                    });
                }
                yield agentBus.publish("collaboration.step", { runId, stepAgentId: agentId, status: "done", focus }, { source: input.agent.id, runId });
                return stepRecord;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                const runtime = chooseProviderRuntime(router, false);
                logger.warn("Collaborative support step failed", {
                    runId,
                    agentId,
                    error: message,
                });
                const stepRecord = {
                    agentId,
                    agentName: humanizeAgentId(agentId),
                    role: getAgentLabel(agentId),
                    focus,
                    status: "failed",
                    runtime,
                    title: `${humanizeAgentId(agentId)} failed`,
                    summary: message,
                    highlights: [],
                    nextSteps: [],
                    proposalType: null,
                    error: message,
                };
                try {
                    onStep === null || onStep === void 0 ? void 0 : onStep(stepRecord);
                }
                catch (_e) {
                    /* non-fatal */
                }
                yield agentBus.publish("collaboration.step", { runId, stepAgentId: agentId, status: "failed", focus, error: message }, { source: input.agent.id, runId });
                return stepRecord;
            }
        }));
        const leaderAgent = (_a = getAgentById(plan.leaderAgentId)) !== null && _a !== void 0 ? _a : input.agent;
        const synthesisInput = Object.assign(Object.assign({}, input), { agent: leaderAgent, prompt: buildSynthesisPrompt(input, plan, supportResults) });
        const leaderRunId = `${runId}-leader`;
        const leaderRuntime = chooseProviderRuntime(router, true);
        // The gateway prompt builder wraps the synthesis prompt exactly once.
        const leaderPromptText = buildGatewayPrompt(synthesisInput, leaderRunId);
        try {
            const leaderResult = yield runStructuredPrompt(synthesisInput, leaderRunId, strategy, leaderPromptText, router, "leader");
            return {
                leaderResult,
                leaderRuntime,
                supportOutputs: supportResults,
                leaderStatus: "done",
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn("multi-agent-runtime: leader synthesis failed — building fallback from support outputs", {
                runId,
                error: message,
            });
            // Graceful fallback: synthesise from support outputs so the caller still
            // receives a usable (non-structured) answer instead of a hard 5xx.
            const successfulSupport = supportResults.filter((step) => step.status === "done");
            const fallbackHighlights = dedupeStrings(successfulSupport.flatMap((step) => step.highlights.slice(0, 2))).slice(0, 6);
            const fallbackNextSteps = dedupeStrings(successfulSupport.flatMap((step) => step.nextSteps.slice(0, 2))).slice(0, 6);
            const fallbackSummary = successfulSupport.length > 0
                ? successfulSupport.map((s) => `• ${humanizeAgentId(s.agentId)}: ${s.summary}`).join("\n")
                : `Leader synthesis unavailable: ${message}`;
            const fallbackResult = {
                title: `Council synthesis (leader fallback)`,
                summary: fallbackSummary,
                highlights: fallbackHighlights.length
                    ? fallbackHighlights
                    : ["Leader synthesis unavailable; using support outputs as-is."],
                nextSteps: fallbackNextSteps,
                proposal: null,
            };
            return {
                leaderResult: fallbackResult,
                leaderRuntime,
                supportOutputs: supportResults,
                leaderStatus: "failed",
                leaderError: message,
            };
        }
    });
}
export function executeCollaborativeRun(input_1, runId_1, strategy_1) {
    return __awaiter(this, arguments, void 0, function* (input, runId, strategy, options = {}) {
        var _a, _b, _c, _d;
        const plan = buildCollaborativePlan(input);
        // Use the singleton router unless the caller injects one explicitly.
        const router = (_a = options.router) !== null && _a !== void 0 ? _a : getRouter();
        const supportConcurrency = (_b = options.supportConcurrency) !== null && _b !== void 0 ? _b : DEFAULT_SUPPORT_CONCURRENCY;
        if (!plan.collaborative && !options.forceCollaborative) {
            const prompt = buildGatewayPrompt(input, runId);
            return runStructuredPrompt(input, runId, strategy, prompt, router, "leader");
        }
        yield agentBus.publish("collaboration.started", {
            runId,
            leaderAgentId: plan.leaderAgentId,
            supportAgentIds: plan.support.map((s) => s.agentId),
            reason: plan.reason,
            supportConcurrency,
        }, { source: input.agent.id, runId });
        const { leaderResult, leaderRuntime, supportOutputs, leaderStatus, leaderError, } = yield executeCollaborativeFallback(input, runId, strategy, router, plan, supportConcurrency, options.onStep);
        const leaderStep = buildCollaborativeStep(plan.leaderAgentId, plan.reason, leaderResult, leaderRuntime, leaderStatus, leaderError);
        try {
            (_c = options.onStep) === null || _c === void 0 ? void 0 : _c.call(options, leaderStep);
        }
        catch (_e) {
            /* non-fatal */
        }
        yield agentBus.publish(leaderStatus === "done" ? "collaboration.completed" : "collaboration.failed", {
            runId,
            leaderAgentId: plan.leaderAgentId,
            leaderStatus,
            leaderError,
            supportAgentIds: plan.support.map((s) => s.agentId),
            reason: plan.reason,
        }, { source: input.agent.id, runId });
        const collaboration = {
            mode: "collaborative",
            leaderAgentId: plan.leaderAgentId,
            leaderRuntime,
            supportAgentIds: plan.support.map((item) => item.agentId),
            reason: plan.reason,
            consensus: buildConsensusPoints(leaderResult, supportOutputs),
            steps: [...supportOutputs.map((step) => step), leaderStep],
        };
        return Object.assign(Object.assign({}, leaderResult), { proposal: (_d = leaderResult.proposal) !== null && _d !== void 0 ? _d : null, collaboration });
    });
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseCollaborativeRun = shouldUseCollaborativeRun;
exports.buildCollaborativePlan = buildCollaborativePlan;
exports.executeCollaborativeRun = executeCollaborativeRun;
require("server-only");
const agents_1 = require("./agents");
const agent_executor_1 = require("./agent-executor");
const agent_bus_1 = require("./messaging/agent-bus");
const agent_memory_store_1 = require("./memory/agent-memory-store");
const openclaw_gateway_1 = require("./openclaw-gateway");
const server_agent_config_1 = require("./server-agent-config");
const grounding_1 = require("./grounding");
const reflection_1 = require("./orchestration/reflection");
const providers_1 = require("./providers");
const planner_1 = require("./orchestration/planner");
const document_indexer_1 = require("./rag/document-indexer");
const logger_1 = require("../observability/logger");
const DEFAULT_SUPPORT_CONCURRENCY = Math.max(1, Number.parseInt(process.env.MULTI_AGENT_SUPPORT_CONCURRENCY ?? "3", 10) || 3);
async function runWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    const safeLimit = Math.max(1, Math.min(limit, items.length || 1));
    let cursor = 0;
    const run = async () => {
        while (true) {
            const currentIndex = cursor;
            cursor += 1;
            if (currentIndex >= items.length)
                return;
            results[currentIndex] = await worker(items[currentIndex], currentIndex);
        }
    };
    const workers = Array.from({ length: safeLimit }, () => run());
    await Promise.all(workers);
    return results;
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
function shouldUseCollaborativeRun(input) {
    // Delegate to dynamic planner — replaces hardcoded COLLABORATIVE_KEYS set
    const plan = (0, planner_1.buildDynamicPlan)(input);
    return plan.collaborative;
}
function buildCollaborativePlan(input) {
    // Delegate to the dynamic planner (replaces hardcoded BLUEPRINTS lookup)
    const dynamicPlan = (0, planner_1.buildDynamicPlan)(input);
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
    const provider = router.getAvailableProviders()[0] ?? "openrouter";
    const modelMatrix = {
        gateway: {
            leader: process.env.OPENCLAW_GATEWAY_MODEL?.trim() || "openclaw:main",
            support: process.env.OPENCLAW_GATEWAY_MODEL?.trim() || "openclaw:main",
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
    return input.source?.projectId ?? input.context.activeContext.projectId;
}
async function buildAugmentedPrompt(input, basePrompt) {
    const projectId = resolveProjectId(input);
    const query = basePrompt.trim();
    if (!query) {
        return basePrompt;
    }
    const [memoryContext, ragContext] = await Promise.all([
        (0, agent_memory_store_1.buildMemoryContext)(input.agent.id, query, {
            projectId,
            limit: 5,
        }),
        projectId
            ? (0, document_indexer_1.buildRAGContext)(query, {
                projectId,
                limit: 5,
            })
            : Promise.resolve(""),
    ]);
    return [query, memoryContext, ragContext]
        .filter((section) => section.trim().length > 0)
        .join("\n\n");
}
async function rememberResult(input, result) {
    const summary = result.summary?.trim() || result.title?.trim();
    if (!summary)
        return;
    try {
        await (0, agent_memory_store_1.storeMemory)({
            agentId: input.agent.id,
            projectId: resolveProjectId(input),
            memoryType: "episodic",
            content: summary,
            summary: result.title?.trim() || summary.slice(0, 160),
            importance: result.proposal ? 0.8 : 0.6,
            metadata: {
                runSource: input.source?.workflow ?? "collaborative_runtime",
                quickActionId: input.quickAction?.id ?? null,
            },
        });
    }
    catch (error) {
        logger_1.logger.warn("multi-agent-runtime: failed to persist agent memory", {
            agentId: input.agent.id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
async function runStructuredPrompt(input, runId, strategy, promptOverride, router, runtimeRole = "leader") {
    const promptText = await buildAugmentedPrompt(input, promptOverride);
    if (strategy === "gateway") {
        return (0, openclaw_gateway_1.invokeOpenClawGateway)(input, runId, { promptOverride: promptText });
    }
    const runtime = chooseProviderRuntime(router, runtimeRole === "leader");
    const enrichedAgent = await (0, server_agent_config_1.getEnrichedAgentById)(input.agent.id);
    const messages = [{ role: "user", content: promptText }];
    await agent_bus_1.agentBus.publish("agent.started", {
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
            (0, reflection_1.shouldReflect)(promptText, input.agent.id) &&
            !(enrichedAgent?.config.capabilities?.canCallTools ?? false)) {
            const reflected = await (0, reflection_1.runWithReflection)(messages, {
                provider: runtime.provider,
                model: runtime.model,
                agentId: input.agent.id,
                runId,
            });
            rawText = reflected.finalResponse;
        }
        else {
            const execution = await (0, agent_executor_1.runAgentExecution)(messages, {
                agentId: input.agent.id,
                runId,
                router,
                provider: runtime.provider,
                model: runtime.model,
                maxToolRounds: 5,
                signal: input.signal,
                enableTools: enrichedAgent?.config.capabilities?.canCallTools ?? false,
                safetyLevel: "strict",
            });
            rawText = execution.finalContent;
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await agent_bus_1.agentBus.publish("agent.failed", {
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
        const grounded = (0, grounding_1.attachRunGrounding)((0, openclaw_gateway_1.parseGatewayResult)(rawText, runId), input);
        await rememberResult(input, grounded);
        await agent_bus_1.agentBus.publish("agent.completed", {
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
        logger_1.logger.warn("Provider collaborative output was not JSON, using fallback summary", {
            agentId: input.agent.id,
            error: error instanceof Error ? error.message : String(error),
        });
        const grounded = (0, grounding_1.attachRunGrounding)({
            title: `${humanizeAgentId(input.agent.id)} synthesis`,
            summary: fallback || "No structured output returned.",
            highlights: fallback ? [fallback.slice(0, 240)] : ["No highlights returned."],
            nextSteps: [],
            proposal: null,
        }, input);
        await rememberResult(input, grounded);
        await agent_bus_1.agentBus.publish("agent.completed", {
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
}
function buildSupportResultPrompt(input, runId) {
    return (0, openclaw_gateway_1.buildGatewayPrompt)(input, runId);
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
    const candidatePoints = [
        ...(result.highlights ?? []),
        ...supportOutputs.flatMap((step) => step.highlights.slice(0, 1)),
        ...supportOutputs.flatMap((step) => step.nextSteps.slice(0, 1)),
    ];
    return dedupeStrings(candidatePoints).slice(0, 5);
}
function buildCollaborativeStep(agentId, focus, result, runtime, status, error) {
    return {
        agentId,
        agentName: humanizeAgentId(agentId),
        role: getAgentLabel(agentId),
        focus,
        status,
        runtime,
        title: result.title || `${humanizeAgentId(agentId)} response`,
        summary: result.summary || (status === "failed" ? error ?? "Execution failed." : "No summary returned."),
        highlights: result.highlights ?? [],
        nextSteps: result.nextSteps ?? [],
        proposalType: result.proposal?.type ?? null,
        ...(error ? { error } : {}),
    };
}
async function executeCollaborativeFallback(input, runId, strategy, router, plan, supportConcurrency, onStep) {
    const supportResults = await runWithConcurrency(plan.support, supportConcurrency, async ({ agentId, focus }) => {
        try {
            const agent = (0, agents_1.getAgentById)(agentId) ?? input.agent;
            const stepInput = {
                ...input,
                agent,
                prompt: buildFocusPrompt(agentId, focus, input.prompt),
            };
            const stepRunId = `${runId}-${agentId}`;
            const stepPrompt = buildSupportResultPrompt(stepInput, stepRunId);
            const result = await runStructuredPrompt(stepInput, stepRunId, strategy, stepPrompt, router, "support");
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
                proposalType: result.proposal?.type ?? null,
            };
            try {
                onStep?.(stepRecord);
            }
            catch (cbError) {
                logger_1.logger.warn("multi-agent-runtime: onStep callback failed", {
                    error: cbError instanceof Error ? cbError.message : String(cbError),
                });
            }
            await agent_bus_1.agentBus.publish("collaboration.step", { runId, stepAgentId: agentId, status: "done", focus }, { source: input.agent.id, runId });
            return stepRecord;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const runtime = chooseProviderRuntime(router, false);
            logger_1.logger.warn("Collaborative support step failed", {
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
                onStep?.(stepRecord);
            }
            catch {
                /* non-fatal */
            }
            await agent_bus_1.agentBus.publish("collaboration.step", { runId, stepAgentId: agentId, status: "failed", focus, error: message }, { source: input.agent.id, runId });
            return stepRecord;
        }
    });
    const leaderAgent = (0, agents_1.getAgentById)(plan.leaderAgentId) ?? input.agent;
    const synthesisInput = {
        ...input,
        agent: leaderAgent,
        prompt: buildSynthesisPrompt(input, plan, supportResults),
    };
    const leaderRunId = `${runId}-leader`;
    const leaderRuntime = chooseProviderRuntime(router, true);
    // The gateway prompt builder wraps the synthesis prompt exactly once.
    const leaderPromptText = (0, openclaw_gateway_1.buildGatewayPrompt)(synthesisInput, leaderRunId);
    try {
        const leaderResult = await runStructuredPrompt(synthesisInput, leaderRunId, strategy, leaderPromptText, router, "leader");
        return {
            leaderResult,
            leaderRuntime,
            supportOutputs: supportResults,
            leaderStatus: "done",
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger_1.logger.warn("multi-agent-runtime: leader synthesis failed — building fallback from support outputs", {
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
}
async function executeCollaborativeRun(input, runId, strategy, options = {}) {
    const plan = buildCollaborativePlan(input);
    // Use the singleton router unless the caller injects one explicitly.
    const router = options.router ?? (0, providers_1.getRouter)();
    const supportConcurrency = options.supportConcurrency ?? DEFAULT_SUPPORT_CONCURRENCY;
    if (!plan.collaborative && !options.forceCollaborative) {
        const prompt = (0, openclaw_gateway_1.buildGatewayPrompt)(input, runId);
        return runStructuredPrompt(input, runId, strategy, prompt, router, "leader");
    }
    await agent_bus_1.agentBus.publish("collaboration.started", {
        runId,
        leaderAgentId: plan.leaderAgentId,
        supportAgentIds: plan.support.map((s) => s.agentId),
        reason: plan.reason,
        supportConcurrency,
    }, { source: input.agent.id, runId });
    const { leaderResult, leaderRuntime, supportOutputs, leaderStatus, leaderError, } = await executeCollaborativeFallback(input, runId, strategy, router, plan, supportConcurrency, options.onStep);
    const leaderStep = buildCollaborativeStep(plan.leaderAgentId, plan.reason, leaderResult, leaderRuntime, leaderStatus, leaderError);
    try {
        options.onStep?.(leaderStep);
    }
    catch {
        /* non-fatal */
    }
    await agent_bus_1.agentBus.publish(leaderStatus === "done" ? "collaboration.completed" : "collaboration.failed", {
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
    return {
        ...leaderResult,
        proposal: leaderResult.proposal ?? null,
        collaboration,
    };
}

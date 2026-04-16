import "server-only";

import { getAgentById } from "@/lib/ai/agents";
import { runAgentExecution } from "@/lib/ai/agent-executor";
import { agentBus } from "@/lib/ai/messaging/agent-bus";
import { buildMemoryContext, storeMemory } from "@/lib/ai/memory/agent-memory-store";
import {
  buildGatewayPrompt,
  invokeOpenClawGateway,
  parseGatewayResult,
} from "@/lib/ai/openclaw-gateway";
import { getEnrichedAgentById } from "@/lib/ai/server-agent-config";
import { attachRunGrounding } from "@/lib/ai/grounding";
import { runWithReflection, shouldReflect } from "@/lib/ai/orchestration/reflection";
import { AIRouter } from "@/lib/ai/providers";
import { buildDynamicPlan } from "@/lib/ai/orchestration/planner";
import { buildRAGContext } from "@/lib/ai/rag/document-indexer";
import type {
  AIRunInput,
  AIRunResult,
  AIMultiAgentCollaboration,
  AIMultiAgentRuntime,
  AIMultiAgentStep,
} from "@/lib/ai/types";
import { logger } from "@/lib/logger";
import type { Message } from "@/lib/ai/providers";

export type CollaborationStrategy = "gateway" | "provider";

export interface CollaborativeCallOutcome {
  result: AIRunResult;
  runtime: AIMultiAgentRuntime;
}

export interface CollaborativeExecutionOptions {
  router?: AIRouter;
  onStep?: (step: AIMultiAgentStep) => void;
  forceCollaborative?: boolean;
}

type CollaborativeStepResult = AIMultiAgentStep;

interface CollaborationFocus {
  agentId: string;
  focus: string;
}

interface CollaborationPlan {
  collaborative: boolean;
  leaderAgentId: string;
  leaderAgentName: string;
  support: CollaborationFocus[];
  reason: string;
}

function humanizeAgentId(agentId: string) {
  return agentId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getAgentLabel(agentId: string) {
  return humanizeAgentId(agentId);
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) {
      return false;
    }
    seen.add(trimmed.toLowerCase());
    return true;
  });
}

function buildFocusPrompt(agentId: string, focus: string, prompt: string) {
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

export function shouldUseCollaborativeRun(input: AIRunInput) {
  // Delegate to dynamic planner — replaces hardcoded COLLABORATIVE_KEYS set
  const plan = buildDynamicPlan(input);
  return plan.collaborative;
}

export function buildCollaborativePlan(input: AIRunInput) {
  // Delegate to the dynamic planner (replaces hardcoded BLUEPRINTS lookup)
  const dynamicPlan = buildDynamicPlan(input);
  const leaderAgentName = getAgentLabel(dynamicPlan.leaderAgentId);

  // Convert dynamic plan steps → legacy CollaborationFocus format
  const support: CollaborationFocus[] = dynamicPlan.steps.map((s) => ({
    agentId: s.agentId,
    focus: s.focus,
  }));

  return {
    collaborative: dynamicPlan.collaborative,
    leaderAgentId: dynamicPlan.leaderAgentId,
    leaderAgentName,
    support,
    reason: dynamicPlan.reason,
  } satisfies CollaborationPlan;
}

function chooseProviderRuntime(router: AIRouter, leader: boolean): AIMultiAgentRuntime {
  const provider = router.getAvailableProviders()[0] ?? "openrouter";
  const modelMatrix: Record<string, { leader: string; support: string }> = {
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

function resolveProjectId(input: AIRunInput): string | undefined {
  return input.source?.projectId ?? input.context.activeContext.projectId;
}

async function buildAugmentedPrompt(input: AIRunInput, basePrompt: string): Promise<string> {
  const projectId = resolveProjectId(input);
  const query = basePrompt.trim();

  if (!query) {
    return basePrompt;
  }

  const [memoryContext, ragContext] = await Promise.all([
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
}

async function rememberResult(input: AIRunInput, result: AIRunResult): Promise<void> {
  const summary = result.summary?.trim() || result.title?.trim();
  if (!summary) return;

  try {
    await storeMemory({
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
  } catch (error) {
    logger.warn("multi-agent-runtime: failed to persist agent memory", {
      agentId: input.agent.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runStructuredPrompt(
  input: AIRunInput,
  runId: string,
  strategy: CollaborationStrategy,
  promptOverride: string,
  router: AIRouter,
  runtimeRole: "leader" | "support" = "leader"
): Promise<AIRunResult> {
  const promptText = await buildAugmentedPrompt(input, promptOverride);

  if (strategy === "gateway") {
    return invokeOpenClawGateway(input, runId, { promptOverride: promptText });
  }

  const runtime = chooseProviderRuntime(router, runtimeRole === "leader");
  const enrichedAgent = await getEnrichedAgentById(input.agent.id);
  const messages: Message[] = [{ role: "user", content: promptText }];

  await agentBus.publish("agent.started", {
    runId,
    role: runtimeRole,
    prompt: promptText.slice(0, 200),
  }, {
    source: input.agent.id,
    runId,
  });

  let rawText = "";

  try {
    if (
      runtimeRole === "leader" &&
      shouldReflect(promptText, input.agent.id) &&
      !(enrichedAgent?.config.capabilities?.canCallTools ?? false)
    ) {
      const reflected = await runWithReflection(messages, {
        provider: runtime.provider,
        model: runtime.model,
      });
      rawText = reflected.finalResponse;
    } else {
      const execution = await runAgentExecution(messages, {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await agentBus.publish("agent.failed", {
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
    await rememberResult(input, grounded);
    await agentBus.publish("agent.completed", {
      runId,
      role: runtimeRole,
      status: "success",
    }, {
      source: input.agent.id,
      runId,
    });
    return grounded;
  } catch (error) {
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
    await rememberResult(input, grounded);
    await agentBus.publish("agent.completed", {
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

function buildSupportResultPrompt(input: AIRunInput, runId: string) {
  return buildGatewayPrompt(input, runId);
}

function buildSynthesisPrompt(
  input: AIRunInput,
  plan: CollaborationPlan,
  supportOutputs: CollaborativeStepResult[]
) {
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

function buildConsensusPoints(result: AIRunResult, supportOutputs: CollaborativeStepResult[]) {
  const candidatePoints = [
    ...(result.highlights ?? []),
    ...supportOutputs.flatMap((step) => step.highlights.slice(0, 1)),
    ...supportOutputs.flatMap((step) => step.nextSteps.slice(0, 1)),
  ];

  return dedupeStrings(candidatePoints).slice(0, 5);
}

function buildCollaborativeStep(
  agentId: string,
  focus: string,
  result: AIRunResult,
  runtime: AIMultiAgentRuntime,
  status: "done" | "failed",
  error?: string
): AIMultiAgentStep {
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

async function executeCollaborativeFallback(
  input: AIRunInput,
  runId: string,
  strategy: CollaborationStrategy,
  router: AIRouter,
  plan: CollaborationPlan
): Promise<{
  leaderResult: AIRunResult;
  leaderRuntime: AIMultiAgentRuntime;
  supportOutputs: CollaborativeStepResult[];
}> {
  const supportResults = await Promise.all(
    plan.support.map(async ({ agentId, focus }) => {
      try {
        const agent = getAgentById(agentId) ?? input.agent;
        const stepInput: AIRunInput = {
          ...input,
          agent,
          prompt: buildFocusPrompt(agentId, focus, input.prompt),
        };
        const stepRunId = `${runId}-${agentId}`;
        const stepPrompt = buildSupportResultPrompt(stepInput, stepRunId);
        const result = await runStructuredPrompt(
          stepInput,
          stepRunId,
          strategy,
          stepPrompt,
          router,
          "support"
        );
        const runtime = chooseProviderRuntime(router, false);
        return {
          agentId,
          agentName: humanizeAgentId(agentId),
          role: getAgentLabel(agentId),
          focus,
          status: "done" as const,
          runtime,
          title: result.title,
          summary: result.summary,
          highlights: result.highlights,
          nextSteps: result.nextSteps,
          proposalType: result.proposal?.type ?? null,
        } satisfies CollaborativeStepResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const runtime = chooseProviderRuntime(router, false);
        logger.warn("Collaborative support step failed", {
          runId,
          agentId,
          error: message,
        });
        return {
          agentId,
          agentName: humanizeAgentId(agentId),
          role: getAgentLabel(agentId),
          focus,
          status: "failed" as const,
          runtime,
          title: `${humanizeAgentId(agentId)} failed`,
          summary: message,
          highlights: [],
          nextSteps: [],
          proposalType: null,
          error: message,
        } satisfies CollaborativeStepResult;
      }
    })
  );

  const leaderAgent = getAgentById(plan.leaderAgentId) ?? input.agent;
  const synthesisInput: AIRunInput = {
    ...input,
    agent: leaderAgent,
    prompt: buildSynthesisPrompt(input, plan, supportResults),
  };

  const leaderRunId = `${runId}-leader`;
  const leaderPromptText = buildGatewayPrompt(synthesisInput, leaderRunId);
  const leaderResult = await runStructuredPrompt(
    synthesisInput,
    leaderRunId,
    strategy,
    leaderPromptText,
    router,
    "leader"
  );
  const leaderRuntime = chooseProviderRuntime(router, true);

  return {
    leaderResult,
    leaderRuntime,
    supportOutputs: supportResults,
  };
}

export async function executeCollaborativeRun(
  input: AIRunInput,
  runId: string,
  strategy: CollaborationStrategy,
  options: CollaborativeExecutionOptions = {}
): Promise<AIRunResult> {
  const plan = buildCollaborativePlan(input);
  const router = options.router ?? new AIRouter();

  if (!plan.collaborative && !options.forceCollaborative) {
    const prompt = buildGatewayPrompt(input, runId);
    return runStructuredPrompt(input, runId, strategy, prompt, router, "leader");
  }

  const { leaderResult, leaderRuntime, supportOutputs } = await executeCollaborativeFallback(
    input,
    runId,
    strategy,
    router,
    plan
  );

  const collaboration: AIMultiAgentCollaboration = {
    mode: "collaborative",
    leaderAgentId: plan.leaderAgentId,
    leaderRuntime,
    supportAgentIds: plan.support.map((item) => item.agentId),
    reason: plan.reason,
    consensus: buildConsensusPoints(leaderResult, supportOutputs),
    steps: [
      ...supportOutputs.map((step) => step as AIMultiAgentStep),
      buildCollaborativeStep(plan.leaderAgentId, plan.reason, leaderResult, leaderRuntime, "done"),
    ],
  };

  return {
    ...leaderResult,
    proposal: leaderResult.proposal ?? null,
    collaboration,
  };
}

import { getAgentById } from "@/lib/ai/agents";
import {
  buildGatewayPrompt,
  invokeOpenClawGateway,
  parseGatewayResult,
} from "@/lib/ai/openclaw-gateway";
import { attachRunGrounding } from "@/lib/ai/grounding";
import { AIRouter } from "@/lib/ai/providers";
import { buildDynamicPlan } from "@/lib/ai/orchestration/planner";
import type {
  AIRunInput,
  AIRunResult,
  AIMultiAgentCollaboration,
  AIMultiAgentRuntime,
  AIMultiAgentStep,
} from "@/lib/ai/types";
import { logger } from "@/lib/logger";

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

interface CollaborationBlueprint {
  reason: string;
  support: CollaborationFocus[];
}

interface CollaborationPlan {
  collaborative: boolean;
  leaderAgentId: string;
  leaderAgentName: string;
  support: CollaborationFocus[];
  reason: string;
}

const COLLABORATIVE_KEYS = new Set([
  "pmo-director",
  "portfolio-analyst",
  "strategy-advisor",
  "execution-planner",
  "resource-allocator",
  "timeline-optimizer",
  "status-reporter",
  "risk-researcher",
  "budget-controller",
  "evm-analyst",
  "cost-predictor",
  "triage_tasks",
  "suggest_tasks",
  "analyze_project",
  "summarize_portfolio",
  "draft_status_report",
]);

const BLUEPRINTS: Record<string, CollaborationBlueprint> = {
  summarize_portfolio: {
    reason:
      "Portfolio decisions improve when strategic, risk, and executive communication views are combined.",
    support: [
      {
        agentId: "risk-researcher",
        focus:
          "Surface the biggest blockers, hidden risks, and mitigation priorities that could change the portfolio view.",
      },
      {
        agentId: "status-reporter",
        focus:
          "Translate the portfolio situation into an executive-ready status summary with clear management asks.",
      },
    ],
  },
  analyze_project: {
    reason:
      "Project diagnosis is stronger when planning, risk, and quality perspectives are all present.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Break the project into the most important execution moves, dependencies, owners, and near-term deadlines.",
      },
      {
        agentId: "risk-researcher",
        focus:
          "Identify blockers, uncertainty, and failure modes that could derail delivery or distort the plan.",
      },
    ],
  },
  suggest_tasks: {
    reason:
      "Task generation is best when execution, risk, and quality checks happen before the answer is finalized.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Turn the prompt into a practical execution sequence with owners, deadlines, and clear dependencies.",
      },
      {
        agentId: "quality-guardian",
        focus:
          "Check that the proposed work is realistic, non-duplicative, and has a useful acceptance shape.",
      },
    ],
  },
  draft_status_report: {
    reason:
      "A status report is strongest when the narrative is checked against budget, quality, and execution reality.",
    support: [
      {
        agentId: "budget-controller",
        focus:
          "Validate the budget and spend narrative so the status draft does not miss financial pressure or variance.",
      },
      {
        agentId: "quality-guardian",
        focus:
          "Review the wording for completeness, risk disclosure, and any missing evidence that should be noted.",
      },
    ],
  },
  triage_tasks: {
    reason:
      "Triage works best when execution sequencing, risk exposure, and quality checks are considered together.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Reorder the queue by urgency, dependencies, owner capacity, and delivery consequence.",
      },
      {
        agentId: "risk-researcher",
        focus:
          "Highlight the blocked items, overdue dependencies, and hidden failure risks in the current queue.",
      },
    ],
  },
  "portfolio-analyst": {
    reason:
      "Strategic portfolio work needs a broader council to turn signals into an actionable management view.",
    support: [
      {
        agentId: "risk-researcher",
        focus:
          "Surface the most material risks, blockers, and unresolved dependencies that affect portfolio confidence.",
      },
      {
        agentId: "status-reporter",
        focus:
          "Turn the analysis into a concise executive summary and define the decision ask clearly.",
      },
    ],
  },
  "strategy-advisor": {
    reason:
      "Strategy benefits from portfolio evidence and an execution check before the answer is finalized.",
    support: [
      {
        agentId: "portfolio-analyst",
        focus:
          "Provide portfolio-wide context, priority trade-offs, and any cross-project implications.",
      },
      {
        agentId: "execution-planner",
        focus:
          "Check whether the strategic recommendation can actually be executed within the current constraints.",
      },
    ],
  },
  "execution-planner": {
    reason:
      "Execution planning is stronger when risk, quality, and budget realities are validated in parallel.",
    support: [
      {
        agentId: "risk-researcher",
        focus:
          "Identify the most important delivery risks, blockers, and mitigation actions before the plan is committed.",
      },
      {
        agentId: "quality-guardian",
        focus:
          "Validate the plan for completeness, acceptance criteria, and likely failure modes.",
      },
    ],
  },
  "resource-allocator": {
    reason:
      "Resource allocation should be checked against budget and timeline pressure before the recommendation is finalized.",
    support: [
      {
        agentId: "budget-controller",
        focus:
          "Validate the cost and spend implications of any resource shift or staffing change.",
      },
      {
        agentId: "timeline-optimizer",
        focus:
          "Check whether the proposed resource mix actually improves schedule predictability.",
      },
    ],
  },
  "timeline-optimizer": {
    reason:
      "Timeline changes should be balanced against execution realism and risk exposure.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Check the dependency chain, owner load, and sequencing implications of the timeline proposal.",
      },
      {
        agentId: "risk-researcher",
        focus:
          "Surface risks that could make the new timeline unrealistic or brittle.",
      },
    ],
  },
  "status-reporter": {
    reason:
      "Executive status becomes more reliable when budget and quality are checked against the story.",
    support: [
      {
        agentId: "budget-controller",
        focus:
          "Validate the financial narrative and note any variance or pressure that should be disclosed.",
      },
      {
        agentId: "quality-guardian",
        focus:
          "Review the draft for missing evidence, oversimplification, or phrases that could mislead stakeholders.",
      },
    ],
  },
  "risk-researcher": {
    reason:
      "Risk analysis is stronger when execution and quality perspectives are used to test the proposed mitigations.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Turn the risk findings into a practical mitigation sequence with owners and immediate next steps.",
      },
      {
        agentId: "quality-guardian",
        focus:
          "Check that the risks are distinct, well-evidenced, and not overstated or duplicated.",
      },
    ],
  },
  "budget-controller": {
    reason:
      "Budget decisions should be checked against portfolio priorities and delivery risk before the answer is final.",
    support: [
      {
        agentId: "portfolio-analyst",
        focus:
          "Explain which portfolio priorities the budget posture should favor and what trade-offs matter most.",
      },
      {
        agentId: "risk-researcher",
        focus:
          "Check whether the budget narrative is masking any delivery or supply-chain risk.",
      },
    ],
  },
  "evm-analyst": {
    reason:
      "Earned-value analysis is most useful when paired with execution and risk interpretation.",
    support: [
      {
        agentId: "execution-planner",
        focus:
          "Translate the metrics into a concrete recovery or acceleration plan with owners and dates.",
      },
      {
        agentId: "risk-researcher",
        focus:
          "Explain what the numbers imply for delivery confidence and hidden risk exposure.",
      },
    ],
  },
  "cost-predictor": {
    reason:
      "Cost forecasting benefits from strategic context and a risk sanity check before the answer is finalized.",
    support: [
      {
        agentId: "budget-controller",
        focus:
          "Check the forecast assumptions against current spend patterns and budget variance.",
      },
      {
        agentId: "portfolio-analyst",
        focus:
          "Explain how the cost outlook should influence portfolio priorities or sequencing.",
      },
    ],
  },
};

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

function normalizeBlueprintKey(input: AIRunInput) {
  return input.quickAction?.kind ?? input.agent.id;
}

function resolveBlueprint(input: AIRunInput): CollaborationBlueprint | null {
  const blueprint = BLUEPRINTS[normalizeBlueprintKey(input)];
  if (blueprint) {
    return blueprint;
  }

  const prompt = input.prompt.toLowerCase();

  if (/(risk|риск|blocker|blocked|проблем|风险)/.test(prompt)) {
    return BLUEPRINTS["risk-researcher"];
  }

  if (/(budget|cost|finance|spend|бюдж|затрат|成本)/.test(prompt)) {
    return BLUEPRINTS["budget-controller"];
  }

  if (/(timeline|deadline|schedule|срок|дедлайн|时间线)/.test(prompt)) {
    return BLUEPRINTS["timeline-optimizer"];
  }

  if (/(status|report|summary|отчет|отчёт|статус|报告)/.test(prompt)) {
    return BLUEPRINTS["status-reporter"];
  }

  if (/(task|tasks|plan|planning|задач|план|任务|计划)/.test(prompt)) {
    return BLUEPRINTS["execution-planner"];
  }

  return null;
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

async function runStructuredPrompt(
  input: AIRunInput,
  runId: string,
  strategy: CollaborationStrategy,
  promptOverride: string,
  router: AIRouter,
  runtimeRole: "leader" | "support" = "leader"
): Promise<AIRunResult> {
  if (strategy === "gateway") {
    return invokeOpenClawGateway(input, runId, { promptOverride });
  }

  const runtime = chooseProviderRuntime(router, runtimeRole === "leader");
  const rawText = await router.chat([{ role: "user", content: promptOverride }], {
    provider: runtime.provider,
    model: runtime.model,
  });

  try {
    return attachRunGrounding(parseGatewayResult(rawText, runId), input);
  } catch (error) {
    const fallback = rawText.trim();
    logger.warn("Provider collaborative output was not JSON, using fallback summary", {
      agentId: input.agent.id,
      error: error instanceof Error ? error.message : String(error),
    });

    return attachRunGrounding({
      title: `${humanizeAgentId(input.agent.id)} synthesis`,
      summary: fallback || "No structured output returned.",
      highlights: fallback ? [fallback.slice(0, 240)] : ["No highlights returned."],
      nextSteps: [],
      proposal: null,
    }, input);
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

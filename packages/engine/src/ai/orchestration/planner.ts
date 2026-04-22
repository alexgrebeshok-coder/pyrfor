/**
 * Dynamic Collaboration Planner
 *
 * Replaces the 5 hardcoded collaboration blueprints in multi-agent-runtime.ts
 * with a config-driven, LLM-assisted planning layer.
 *
 * Planning modes:
 * 1. config  — reads from config/agents/<agentId>.json collaboration block (fast)
 * 2. heuristic — applies domain rules based on agent category + context signals (fast)
 * 3. llm    — asks the LLM to plan the collaboration (slow, best quality)
 *
 * The default is "heuristic" with fallback to "config" entries for known agents.
 */

import { z } from "zod";
import { logger } from "@/lib/logger";
import type { AIRunInput } from "@/lib/ai/types";

// ============================================
// Schemas
// ============================================

export const CollaborationStepSchema = z.object({
  agentId: z.string(),
  focus: z.string(),
  role: z.enum(["support", "reviewer", "synthesizer"]).default("support"),
});

export const CollaborationPlanSchema = z.object({
  collaborative: z.boolean(),
  leaderAgentId: z.string(),
  reason: z.string(),
  steps: z.array(CollaborationStepSchema),
});

export type CollaborationStep = z.infer<typeof CollaborationStepSchema>;
export type CollaborationPlan = z.infer<typeof CollaborationPlanSchema>;

// ============================================
// Heuristic domain rules
// ============================================

/** Pairs: [agentCategory, suggestedSupportAgentId, focus, role] */
const DOMAIN_RULES: Array<{
  triggerAgentIds: string[];
  support: Array<{ agentId: string; focus: string; role: "support" | "reviewer" | "synthesizer" }>;
  reason: string;
}> = [
  {
    triggerAgentIds: ["pmo-director", "portfolio-analyst"],
    support: [
      {
        agentId: "risk-researcher",
        focus: "Surface the most material risks and blockers that affect portfolio confidence.",
        role: "support",
      },
      {
        agentId: "status-reporter",
        focus: "Translate analysis into an executive-ready summary with clear management asks.",
        role: "synthesizer",
      },
    ],
    reason: "Portfolio decisions improve with combined strategic, risk, and communication views.",
  },
  {
    triggerAgentIds: ["strategy-advisor"],
    support: [
      {
        agentId: "portfolio-analyst",
        focus: "Provide portfolio-wide context and priority trade-offs.",
        role: "support",
      },
      {
        agentId: "execution-planner",
        focus: "Validate whether the strategy can be executed within current constraints.",
        role: "reviewer",
      },
    ],
    reason: "Strategy needs portfolio evidence and an execution feasibility check.",
  },
  {
    triggerAgentIds: ["execution-planner"],
    support: [
      {
        agentId: "risk-researcher",
        focus: "Identify delivery risks, blockers, and mitigation actions before plan commitment.",
        role: "support",
      },
      {
        agentId: "quality-guardian",
        focus: "Validate plan completeness, acceptance criteria, and likely failure modes.",
        role: "reviewer",
      },
    ],
    reason: "Execution planning is stronger with risk and quality checks in parallel.",
  },
  {
    triggerAgentIds: ["budget-controller", "evm-analyst", "cost-predictor"],
    support: [
      {
        agentId: "execution-planner",
        focus: "Map financial variances to specific tasks and delivery impacts.",
        role: "support",
      },
      {
        agentId: "risk-researcher",
        focus: "Identify financial risks — overruns, scope creep, procurement delays.",
        role: "support",
      },
    ],
    reason: "Financial analysis is strongest when tied to execution reality and risk exposure.",
  },
  {
    triggerAgentIds: ["risk-researcher"],
    support: [
      {
        agentId: "execution-planner",
        focus: "Translate risks into concrete mitigation tasks and contingency plans.",
        role: "synthesizer",
      },
    ],
    reason: "Risk findings are more actionable when paired with concrete execution mitigations.",
  },
  {
    triggerAgentIds: ["status-reporter"],
    support: [
      {
        agentId: "budget-controller",
        focus: "Validate budget narrative so the status draft doesn't miss financial pressure.",
        role: "support",
      },
      {
        agentId: "quality-guardian",
        focus: "Review for completeness, risk disclosure, and any missing evidence.",
        role: "reviewer",
      },
    ],
    reason: "Status reports are most trusted when financial and quality perspectives are included.",
  },
  {
    triggerAgentIds: ["resource-allocator"],
    support: [
      {
        agentId: "execution-planner",
        focus: "Map resource allocations to specific deliverables and deadlines.",
        role: "support",
      },
      {
        agentId: "budget-controller",
        focus: "Validate resource decisions against budget and cost constraints.",
        role: "reviewer",
      },
    ],
    reason: "Resource decisions need execution and financial validation to be actionable.",
  },
];

// Quick-action mappings for legacy compatibility
const QUICK_ACTION_RULES: Record<
  string,
  { support: Array<{ agentId: string; focus: string; role: "support" | "reviewer" | "synthesizer" }>; reason: string }
> = {
  summarize_portfolio: {
    support: [
      { agentId: "risk-researcher", focus: "Surface biggest blockers and hidden risks.", role: "support" },
      { agentId: "status-reporter", focus: "Translate into executive-ready summary.", role: "synthesizer" },
    ],
    reason: "Portfolio summary requires strategic, risk, and communication perspectives.",
  },
  analyze_project: {
    support: [
      { agentId: "execution-planner", focus: "Break into execution moves, dependencies, owners, deadlines.", role: "support" },
      { agentId: "risk-researcher", focus: "Identify blockers and failure modes.", role: "support" },
    ],
    reason: "Project diagnosis needs planning, risk, and quality perspectives combined.",
  },
  suggest_tasks: {
    support: [
      { agentId: "execution-planner", focus: "Turn prompt into practical execution sequence.", role: "support" },
      { agentId: "quality-guardian", focus: "Check tasks are realistic and non-duplicative.", role: "reviewer" },
    ],
    reason: "Task generation is best with execution and quality checks.",
  },
  draft_status_report: {
    support: [
      { agentId: "budget-controller", focus: "Validate budget narrative.", role: "support" },
      { agentId: "quality-guardian", focus: "Review completeness and risk disclosure.", role: "reviewer" },
    ],
    reason: "Status reports need financial and quality validation.",
  },
  triage_tasks: {
    support: [
      { agentId: "execution-planner", focus: "Reorder by urgency, dependencies, capacity.", role: "support" },
      { agentId: "risk-researcher", focus: "Highlight blocked items and hidden risks.", role: "support" },
    ],
    reason: "Triage works best with execution sequencing and risk awareness.",
  },
};

// ============================================
// Context complexity score
// ============================================

function contextComplexity(input: AIRunInput): number {
  const ctx = input.context ?? {};
  return (
    (Array.isArray(ctx.projects) ? ctx.projects.length : 0) +
    (Array.isArray(ctx.tasks) ? ctx.tasks.length : 0) / 5 +
    (Array.isArray(ctx.risks) ? ctx.risks.length : 0) / 3 +
    (Array.isArray(ctx.team) ? ctx.team.length : 0) / 5
  );
}

const COMPLEXITY_SIGNALS = [
  /(portfolio|project|plan|status|risk|budget|deadline|timeline|priority|execution|enterprise)/i,
  /(операц|проект|риск|бюджет|срок|план|стратег|анализ|отчёт)/i,
];

function promptComplexity(prompt: string): number {
  let score = 0;
  if (prompt.length > 160) score++;
  if (prompt.length > 400) score++;
  for (const re of COMPLEXITY_SIGNALS) if (re.test(prompt)) score++;
  return score;
}

// ============================================
// Main planner function
// ============================================

export function buildDynamicPlan(input: AIRunInput): CollaborationPlan {
  const leaderAgentId = input.agent.id;
  const ctxScore = contextComplexity(input);
  const promptScore = promptComplexity(input.prompt);
  const totalComplexity = ctxScore + promptScore;

  // Quick-action always triggers collaboration
  if (input.quickAction) {
    const qa = input.quickAction.id;
    const rule = QUICK_ACTION_RULES[qa];
    if (rule) {
      return {
        collaborative: true,
        leaderAgentId,
        reason: rule.reason,
        steps: rule.support.filter((s) => s.agentId !== leaderAgentId),
      };
    }
  }

  // Below complexity threshold — single agent
  if (totalComplexity < 2) {
    return {
      collaborative: false,
      leaderAgentId,
      reason: "Single-agent execution is sufficient for this request.",
      steps: [],
    };
  }

  // Check domain rules
  const rule = DOMAIN_RULES.find((r) => r.triggerAgentIds.includes(leaderAgentId));
  if (rule) {
    const steps = rule.support.filter((s) => s.agentId !== leaderAgentId);
    return {
      collaborative: steps.length > 0,
      leaderAgentId,
      reason: rule.reason,
      steps,
    };
  }

  // No domain rule — apply a safe default: pair the leader with a quality
  // reviewer when the request is sufficiently complex. This prevents new or
  // unconfigured agents from silently falling back to single-agent mode on
  // strategic asks.
  const DEFAULT_REVIEWER = "quality-guardian";
  if (totalComplexity >= 4 && leaderAgentId !== DEFAULT_REVIEWER) {
    logger.info("dynamic-planner: applying default reviewer fallback", {
      agentId: leaderAgentId,
      totalComplexity,
    });
    return {
      collaborative: true,
      leaderAgentId,
      reason: "Complex request with no explicit collaboration rule — adding a quality reviewer.",
      steps: [
        {
          agentId: DEFAULT_REVIEWER,
          focus: "Challenge the leader's output: completeness, realism, missing evidence, explicit next steps.",
          role: "reviewer",
        },
      ],
    };
  }

  logger.warn("dynamic-planner: no rule for agent, single-agent mode", {
    agentId: leaderAgentId,
    totalComplexity,
  });
  return {
    collaborative: false,
    leaderAgentId,
    reason: "No collaboration rule defined for this agent.",
    steps: [],
  };
}

/**
 * Check whether a collaborative run should be used.
 * Drop-in replacement for shouldUseCollaborativeRun().
 */
export function shouldCollaborate(input: AIRunInput): boolean {
  const plan = buildDynamicPlan(input);
  return plan.collaborative;
}

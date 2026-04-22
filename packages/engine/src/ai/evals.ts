import { getProposalItemCount } from "@/lib/ai/action-engine";
import { buildMockFinalRun } from "@/lib/ai/mock-adapter";
import { buildAIRunTrace } from "@/lib/ai/trace";
import type { ServerAIRunEntry } from "@/lib/ai/server-runs";
import type { AIActionType, AIRunInput } from "@/lib/ai/types";
import { z } from "zod";

const taskDraftSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  assignee: z.string().min(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  priority: z.enum(["low", "medium", "high", "critical"]),
  reason: z.string().min(1),
});

const taskUpdateDraftSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  assignee: z.string().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  reason: z.string().min(1),
});

const taskRescheduleDraftSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1),
  previousDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assignee: z.string().optional(),
  reason: z.string().min(1),
});

const riskDraftSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  owner: z.string().min(1),
  probability: z.number().min(0).max(100),
  impact: z.number().min(0).max(100),
  mitigation: z.string().min(1),
  reason: z.string().min(1),
});

const statusReportSchema = z.object({
  projectId: z.string().min(1).optional(),
  title: z.string().min(1),
  audience: z.string().min(1),
  channel: z.string().min(1),
  summary: z.string().min(1),
  body: z.string().min(1),
  reason: z.string().min(1),
});

const notificationSchema = z.object({
  channel: z.string().min(1),
  recipients: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
  reason: z.string().min(1),
});

const proposalSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("create_tasks"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("update_tasks"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema),
    taskUpdates: z.array(taskUpdateDraftSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("reschedule_tasks"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema),
    taskReschedules: z.array(taskRescheduleDraftSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("raise_risks"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema),
    risks: z.array(riskDraftSchema).min(1),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("draft_status_report"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema),
    statusReport: statusReportSchema,
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("notify_team"),
    title: z.string().min(1),
    summary: z.string().min(1),
    state: z.enum(["pending", "applied", "dismissed"]),
    tasks: z.array(taskDraftSchema),
    notifications: z.array(notificationSchema).min(1),
  }),
]);

export interface AIRunEvalFixture {
  id: string;
  label: string;
  input: AIRunInput;
  expectedProposalType?: AIActionType;
  minProposalItems?: number;
  expectedFailure?: "missing_project_context";
}

export interface AIRunEvalResult {
  fixtureId: string;
  label: string;
  status: "passed" | "failed";
  issues: string[];
  proposalType: AIActionType | null;
  proposalItemCount: number;
  traceWorkflow: string | null;
}

export interface AIRunEvalSuiteResult {
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  results: AIRunEvalResult[];
}

function hasProjectContext(input: AIRunInput) {
  return Boolean(input.context.project?.id || input.context.activeContext.projectId);
}

export function evaluateAIRunFixture(fixture: AIRunEvalFixture): AIRunEvalResult {
  const issues: string[] = [];

  if (!hasProjectContext(fixture.input)) {
    issues.push("missing_project_context");
  }

  if (fixture.expectedFailure) {
    const status = issues.includes(fixture.expectedFailure) ? "passed" : "failed";
    return {
      fixtureId: fixture.id,
      label: fixture.label,
      status,
      issues,
      proposalType: null,
      proposalItemCount: 0,
      traceWorkflow: fixture.input.source?.workflow ?? null,
    };
  }

  const run = buildMockFinalRun(fixture.input, {
    id: `eval-${fixture.id}`,
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:00:05.000Z",
    quickActionId: fixture.input.quickAction?.id,
  });
  const entry: ServerAIRunEntry = {
    origin: "mock",
    input: fixture.input,
    run,
  };
  const trace = buildAIRunTrace(entry);
  const proposal = run.result?.proposal ?? null;

  const parsedProposal = proposalSchema.safeParse(proposal);
  if (!parsedProposal.success) {
    issues.push(`proposal_schema_invalid:${parsedProposal.error.issues[0]?.message ?? "unknown"}`);
  }

  if (!proposal) {
    issues.push("proposal_missing");
  } else {
    if (fixture.expectedProposalType && proposal.type !== fixture.expectedProposalType) {
      issues.push(
        `proposal_type_mismatch:${proposal.type}:expected:${fixture.expectedProposalType}`
      );
    }

    const itemCount = getProposalItemCount(proposal);
    if (fixture.minProposalItems && itemCount < fixture.minProposalItems) {
      issues.push(`proposal_item_count_too_low:${itemCount}:expected:${fixture.minProposalItems}`);
    }
  }

  return {
    fixtureId: fixture.id,
    label: fixture.label,
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    proposalType: proposal?.type ?? null,
    proposalItemCount: proposal ? getProposalItemCount(proposal) : 0,
    traceWorkflow: trace.workflow,
  };
}

export function runAIRunEvalSuite(fixtures: AIRunEvalFixture[]): AIRunEvalSuiteResult {
  const results = fixtures.map((fixture) => evaluateAIRunFixture(fixture));
  const passed = results.filter((result) => result.status === "passed").length;

  return {
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };
}

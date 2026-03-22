import assert from "node:assert/strict";

import { test } from "vitest";

import { buildAIRunTraceComparison } from "@/lib/ai/trace-comparison";
import type { AIRunTrace } from "@/lib/ai/trace";

function createTrace(
  runId: string,
  modelName: string,
  proposalState: "pending" | "applied" | "dismissed" | null,
  proposalItemCount: number,
  replayOfRunId?: string
): AIRunTrace {
  return {
    runId,
    workflow: "work_report_signal_packet",
    title: "Execution trace",
    status: "done",
    agentId: "execution-planner",
    quickActionId: null,
    origin: "mock",
    model: {
      name: modelName,
      status: "done",
    },
    source: {
      workflow: "work_report_signal_packet",
      workflowLabel: "Work-report signal packet",
      purposeLabel: "Execution patch",
      replayLabel: replayOfRunId ? `Replay of ${replayOfRunId}` : null,
      replayOfRunId,
      entityType: "work_report",
      entityId: "work-report-1",
      entityLabel: "Site diary",
    },
    context: {
      type: "project",
      title: "Site diary",
      pathname: "/work-reports",
      projectId: "project-1",
      facts: {
        projects: 1,
        tasks: 3,
        risks: 1,
        team: 4,
        notifications: 1,
      },
    },
    proposal: {
      type: proposalItemCount > 0 ? "update_tasks" : null,
      state: proposalState,
      title: proposalItemCount > 0 ? "Task patch" : null,
      summary: proposalItemCount > 0 ? "Keep the plan aligned." : null,
      itemCount: proposalItemCount,
      previewItems: proposalItemCount > 0 ? ["Sequence work"] : [],
      safety: proposalItemCount > 0
        ? {
            level: "medium",
            executionMode: "guarded_patch",
            liveMutation: false,
            mutationSurface: "Tasks",
            checks: ["Review the patch"],
            compensationMode: "follow_up_patch",
            compensationSummary: "Follow up if needed.",
            compensationSteps: ["Inspect output"],
          }
        : null,
    },
    apply: null,
    collaboration: {
      mode: "collaborative",
      leaderAgentId: "execution-planner",
      leaderRuntime: {
        provider: "openrouter",
        model: modelName,
      },
      supportAgentIds: ["risk-researcher"],
      reason: "Parallel analysis",
      consensus: ["Sequence work"],
      steps: [
        {
          agentId: "risk-researcher",
          agentName: "Risk Researcher",
          role: "Risk Researcher",
          focus: "Surface delivery risks.",
          status: "done",
          runtime: {
            provider: "openrouter",
            model: "openrouter/google/gemma-3-12b-it:free",
          },
          title: "Risk lens",
          summary: "Risk lens summary",
          highlights: ["Treat permit as blocker"],
          nextSteps: ["Escalate"],
          proposalType: null,
        },
      ],
    },
    promptPreview: "Plan the next execution steps.",
    createdAt: "2026-03-19T08:00:00.000Z",
    updatedAt: "2026-03-19T08:05:00.000Z",
    steps: [
      {
        id: "model",
        label: "Model",
        status: "done",
        summary: "Run finished",
        startedAt: "2026-03-19T08:00:00.000Z",
        endedAt: "2026-03-19T08:05:00.000Z",
      },
    ],
    failure: null,
  };
}

test("buildAIRunTraceComparison summarizes replay deltas", () => {
  const original = createTrace(
    "ai-run-original",
    "openrouter/google/gemma-3-12b-it:free",
    "pending",
    1
  );
  const replay = createTrace(
    "ai-run-replay",
    "openrouter/google/gemma-3-27b-it:free",
    "applied",
    2,
    "ai-run-original"
  );

  const comparison = buildAIRunTraceComparison(original, replay);

  assert.equal(comparison.originalRunId, "ai-run-original");
  assert.equal(comparison.replayRunId, "ai-run-replay");
  assert.equal(comparison.sameWorkflow, true);
  assert.equal(comparison.samePrompt, true);
  assert.equal(comparison.sameContext, true);
  assert.equal(comparison.sameModel, false);
  assert.equal(comparison.sameProposalState, false);
  assert.equal(comparison.itemCountDelta, 1);
  assert.ok(comparison.changedFields.some((field) => field.includes("model")));
  assert.ok(comparison.summary.startsWith("Replay changed"));
});

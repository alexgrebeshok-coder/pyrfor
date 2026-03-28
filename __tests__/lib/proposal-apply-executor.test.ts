import assert from "node:assert/strict";

import { afterEach, beforeEach, describe, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeAIKernelTool: vi.fn(),
  prisma: {
    aiApplyDecisionLedger: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/server/runtime-mode", () => ({
  isDatabaseConfigured: mocks.isDatabaseConfigured,
}));

vi.mock("@/lib/ai/kernel-tool-plane", () => ({
  executeAIKernelTool: mocks.executeAIKernelTool,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { executeServerAIProposalApply } from "@/lib/ai/proposal-apply-executor";
import type { AIApplyResult, AIRunRecord } from "@/lib/ai/types";

describe("proposal apply executor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDatabaseConfigured.mockReturnValue(true);
    mocks.prisma.aiApplyDecisionLedger.findFirst.mockResolvedValue(null);
    mocks.prisma.aiApplyDecisionLedger.create.mockResolvedValue({
      id: "decision-1",
      runId: "run-1",
      proposalId: "proposal-1",
      proposalType: "create_tasks",
      idempotencyKey: "key-1",
      status: "executing",
      operatorId: "exec-1",
      toolCallIdsJson: "[]",
      resultJson: "{\"status\":\"executing\"}",
      errorMessage: null,
      compensationMode: "follow_up_patch",
      compensationSummary: "Compensate with a corrective patch.",
      executedAt: null,
      failedAt: null,
    });
    mocks.prisma.aiApplyDecisionLedger.update.mockResolvedValue(undefined);
    mocks.executeAIKernelTool.mockResolvedValue({
      toolCallId: "apply-proposal-1-task-0",
      name: "create_task",
      success: true,
      result: {
        taskId: "task-1",
      },
      displayMessage: "✅ Задача создана",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back when the database-backed apply ledger is unavailable", async () => {
    mocks.isDatabaseConfigured.mockReturnValue(false);

    const result = await executeServerAIProposalApply(createRun(), {
      runId: "run-1",
      proposalId: "proposal-1",
      operatorId: "exec-1",
    });

    assert.equal(result, null);
    assert.equal(mocks.prisma.aiApplyDecisionLedger.findFirst.mock.calls.length, 0);
    assert.equal(mocks.executeAIKernelTool.mock.calls.length, 0);
  });

  it("executes create_tasks proposals through the canonical tool plane", async () => {
    const run = await executeServerAIProposalApply(createRun(), {
      runId: "run-1",
      proposalId: "proposal-1",
      operatorId: "exec-1",
    });

    assert.ok(run);
    assert.equal(run.result?.proposal?.state, "applied");
    assert.equal(run.result?.actionResult?.execution?.status, "executed");
    assert.equal(run.result?.actionResult?.execution?.decisionId, "decision-1");
    assert.equal(run.result?.actionResult?.safety.liveMutation, true);
    assert.match(run.result?.actionResult?.summary ?? "", /live task/);
    assert.equal(mocks.executeAIKernelTool.mock.calls.length, 1);
    assert.deepEqual(mocks.executeAIKernelTool.mock.calls[0]?.[0], {
      toolName: "create_task",
      toolCallId: "apply-proposal-1-task-0",
      arguments: {
        projectId: "project-1",
        title: "Подготовить смету",
        description: "Собрать затраты по материалам.\n\nAI reason: Нужна детализация перед советом.",
        priority: "high",
        dueDate: "2026-03-28T00:00:00.000Z",
      },
    });
  });

  it("reuses an executed apply decision idempotently", async () => {
    const storedResult = createStoredApplyResult();
    mocks.prisma.aiApplyDecisionLedger.findFirst.mockResolvedValueOnce({
      id: "decision-2",
      runId: "run-1",
      proposalId: "proposal-1",
      proposalType: "create_tasks",
      idempotencyKey: "key-2",
      status: "executed",
      operatorId: "exec-1",
      toolCallIdsJson: "[\"apply-proposal-1-task-0\"]",
      resultJson: JSON.stringify(storedResult),
      errorMessage: null,
      compensationMode: "follow_up_patch",
      compensationSummary: "Compensate with a corrective patch.",
      executedAt: new Date("2026-03-25T00:00:00.000Z"),
      failedAt: null,
    });

    const run = await executeServerAIProposalApply(createRun(), {
      runId: "run-1",
      proposalId: "proposal-1",
      operatorId: "exec-1",
    });

    assert.ok(run);
    assert.equal(run.result?.proposal?.state, "applied");
    assert.equal(run.result?.actionResult?.execution?.decisionId, "decision-2");
    assert.equal(mocks.executeAIKernelTool.mock.calls.length, 0);
    assert.equal(mocks.prisma.aiApplyDecisionLedger.create.mock.calls.length, 0);
  });
});

function createRun(): AIRunRecord {
  return {
    id: "run-1",
    agentId: "portfolio-analyst",
    title: "AI Workspace Run",
    prompt: "Создай пакет задач",
    status: "needs_approval",
    createdAt: "2026-03-25T00:00:00.000Z",
    updatedAt: "2026-03-25T00:00:00.000Z",
    context: {
      type: "project",
      pathname: "/projects/project-1",
      title: "Project 1",
      subtitle: "Kernel apply test",
      projectId: "project-1",
    },
    result: {
      title: "AI Result",
      summary: "Нужно добавить задачи",
      highlights: [],
      nextSteps: [],
      proposal: {
        id: "proposal-1",
        type: "create_tasks",
        title: "Создать задачи",
        summary: "Пакет задач",
        state: "pending",
        tasks: [
          {
            projectId: "project-1",
            title: "Подготовить смету",
            description: "Собрать затраты по материалам.",
            assignee: "Иван",
            dueDate: "2026-03-28T00:00:00.000Z",
            priority: "high",
            reason: "Нужна детализация перед советом.",
          },
        ],
      },
      actionResult: null,
    },
  };
}

function createStoredApplyResult(): AIApplyResult {
  return {
    proposalId: "proposal-1",
    type: "create_tasks",
    appliedAt: "2026-03-25T00:00:00.000Z",
    summary: "Created 1 live task(s) from the approved proposal.",
    itemCount: 1,
    tasksCreated: [
      {
        projectId: "project-1",
        title: "Подготовить смету",
        description: "Собрать затраты по материалам.",
        assignee: "Иван",
        dueDate: "2026-03-28T00:00:00.000Z",
        priority: "high",
        reason: "Нужна детализация перед советом.",
      },
    ],
    tasksUpdated: [],
    tasksRescheduled: [],
    risksRaised: [],
    draftedStatusReport: null,
    notificationsSent: [],
    safety: {
      level: "medium",
      executionMode: "guarded_patch",
      liveMutation: true,
      mutationSurface: "Live task backlog",
      checks: [],
      compensationMode: "follow_up_patch",
      compensationSummary: "Compensate with a corrective patch.",
      compensationSteps: [],
      operatorDecision: "manual_apply",
      postApplyState: "guarded_execution",
    },
    execution: {
      decisionId: "decision-2",
      status: "executed",
      operatorId: "exec-1",
      idempotencyKey: "key-2",
      toolCallIds: ["apply-proposal-1-task-0"],
      steps: [
        {
          toolCallId: "apply-proposal-1-task-0",
          toolName: "create_task",
          success: true,
          message: "✅ Задача создана",
          entityId: "task-1",
        },
      ],
    },
  };
}

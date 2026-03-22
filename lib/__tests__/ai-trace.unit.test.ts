import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { GET as getTraceRoute } from "../../app/api/ai/runs/[id]/trace/route";
import { applyAIProposal } from "@/lib/ai/action-engine";
import { runAIRunEvalSuite } from "@/lib/ai/evals";
import { buildMockFinalRun } from "@/lib/ai/mock-adapter";
import { createServerAIRun, getServerAIRun } from "@/lib/ai/server-runs";
import { buildAIRunTrace } from "@/lib/ai/trace";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/server/runtime-mode";

import { createWorkReportSignalFixtureBundle } from "./fixtures/work-report-signal-fixtures";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanupPersistedRun(runId?: string) {
  if (!runId) return;
  await rm(`${process.cwd()}/.ceoclaw-cache/ai-runs/${runId}.json`, { force: true });
  if (isDatabaseConfigured()) {
    await prisma.aiRunLedger.deleteMany({
      where: { id: runId },
    });
  }
}

async function testTraceSummarizesWorkReportRun() {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

  assert.ok(input);

  const run = buildMockFinalRun(input, {
    id: "ai-run-trace-tasks",
    createdAt: "2026-03-11T09:00:00.000Z",
    updatedAt: "2026-03-11T09:00:05.000Z",
    quickActionId: input?.quickAction?.id,
  });
  const trace = buildAIRunTrace({
    origin: "mock",
    input,
    run,
  });

  assert.equal(trace.workflow, "work_report_signal_packet");
  assert.equal(trace.source.entityType, "work_report");
  assert.equal(trace.source.purpose, "tasks");
  assert.equal(trace.model.name, "mock-adapter");
  assert.equal(trace.proposal.type, "update_tasks");
  assert.ok(trace.proposal.itemCount >= 1);
  assert.equal(trace.steps[2]?.id, "model");
  assert.equal(trace.steps[2]?.status, "done");
  assert.equal(trace.steps[3]?.status, "done");
  assert.equal(trace.steps[4]?.status, "pending");
  assert.equal(trace.proposal.safety?.executionMode, "guarded_patch");
}

async function testTraceCapturesApplySafetyAndCompensation() {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

  assert.ok(input);

  const pendingRun = buildMockFinalRun(input, {
    id: "ai-run-trace-applied",
    createdAt: "2026-03-11T09:20:00.000Z",
    updatedAt: "2026-03-11T09:20:05.000Z",
    quickActionId: input?.quickAction?.id,
  });
  const proposalId = pendingRun.result?.proposal?.id;

  assert.ok(proposalId);

  const appliedRun = applyAIProposal(pendingRun, proposalId);
  const trace = buildAIRunTrace({
    origin: "mock",
    input,
    run: appliedRun,
  });

  assert.equal(trace.apply?.safety.level, "high");
  assert.equal(trace.apply?.safety.compensationMode, "follow_up_patch");
  assert.equal(trace.apply?.safety.postApplyState, "guarded_execution");
  assert.ok(trace.steps[4]?.summary.includes("Compensation:"));
}

async function testTraceMarksReplaySources() {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

  assert.ok(input);

  const replayInput = {
    ...input,
    source: {
      ...input.source,
      replayOfRunId: "ai-run-original-123",
      replayReason: "manual_replay",
    },
  };

  const run = buildMockFinalRun(replayInput, {
    id: "ai-run-trace-replay",
    createdAt: "2026-03-11T09:10:00.000Z",
    updatedAt: "2026-03-11T09:10:05.000Z",
    quickActionId: replayInput.quickAction?.id,
  });
  const trace = buildAIRunTrace({
    origin: "mock",
    input: replayInput,
    run,
  });

  assert.equal(trace.source.replayOfRunId, "ai-run-original-123");
  assert.equal(trace.source.replayLabel, "Replay of ai-run-original-123");
  assert.ok(trace.steps[0]?.summary.includes("Replay of ai-run-original-123"));
}

async function testEvalSuitePassesStableFixturesAndCatchesMissingContext() {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const tasksInput = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;
  const risksInput = blueprints.find((blueprint) => blueprint.purpose === "risks")?.input;

  assert.ok(tasksInput);
  assert.ok(risksInput);

  const missingContextInput = {
    ...tasksInput,
    context: {
      ...tasksInput.context,
      activeContext: {
        ...tasksInput.context.activeContext,
        projectId: undefined,
      },
      project: undefined,
      projectTasks: undefined,
    },
  };

  const suite = runAIRunEvalSuite([
    {
      id: "work-report-tasks",
      label: "work report tasks",
      input: tasksInput,
      expectedProposalType: "update_tasks",
      minProposalItems: 1,
    },
    {
      id: "work-report-risks",
      label: "work report risks",
      input: risksInput,
      expectedProposalType: "raise_risks",
      minProposalItems: 1,
    },
    {
      id: "missing-project-context",
      label: "missing project context",
      input: missingContextInput,
      expectedFailure: "missing_project_context",
    },
  ]);

  assert.equal(suite.summary.total, 3);
  assert.equal(suite.summary.failed, 0);
  assert.equal(suite.results[0]?.status, "passed");
  assert.equal(suite.results[1]?.proposalType, "raise_risks");
  assert.equal(suite.results[2]?.status, "passed");
  assert.deepEqual(suite.results[2]?.issues, ["missing_project_context"]);
}

async function testTraceRouteReturnsPersistedRunTrace() {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "status")?.input;

  assert.ok(input);

  const previousMode = process.env.SEOCLAW_AI_MODE;
  process.env.SEOCLAW_AI_MODE = "mock";
  let runId: string | undefined;

  try {
    const created = await createServerAIRun(input);
    runId = created.id;

    let finalRun = created;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(300);
      finalRun = await getServerAIRun(runId);
      if (finalRun.result?.proposal) {
        break;
      }
    }

    assert.ok(finalRun.result?.proposal);

    const response = await getTraceRoute(new Request(`http://localhost/api/ai/runs/${runId}/trace`), {
      params: Promise.resolve({ id: runId }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.runId, runId);
    assert.equal(body.source.workflow, "work_report_signal_packet");
    assert.equal(body.proposal.type, "draft_status_report");
    assert.equal(body.steps[3].status, "done");
  } finally {
    await cleanupPersistedRun(runId);
    if (previousMode === undefined) {
      delete process.env.SEOCLAW_AI_MODE;
    } else {
      process.env.SEOCLAW_AI_MODE = previousMode;
    }
  }
}

async function main() {
  await testTraceSummarizesWorkReportRun();
  await testTraceCapturesApplySafetyAndCompensation();
  await testTraceMarksReplaySources();
  await testEvalSuitePassesStableFixturesAndCatchesMissingContext();
  await testTraceRouteReturnsPersistedRunTrace();
  console.log("PASS ai-trace.unit");
}

void main();

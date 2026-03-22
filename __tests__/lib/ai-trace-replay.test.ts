import assert from "node:assert/strict";

import { test } from "vitest";

import { createWorkReportSignalFixtureBundle } from "../../lib/__tests__/fixtures/work-report-signal-fixtures";
import { buildMockFinalRun } from "@/lib/ai/mock-adapter";
import { buildReplayAIRunInput } from "@/lib/ai/server-runs";
import { buildAIRunTrace } from "@/lib/ai/trace";
import type { ServerAIRunEntry } from "@/lib/ai/server-runs";

test("replay inputs preserve source context and mark replay origin", () => {
  const { blueprints } = createWorkReportSignalFixtureBundle();
  const input = blueprints.find((blueprint) => blueprint.purpose === "tasks")?.input;

  assert.ok(input);

  const baseRun = buildMockFinalRun(input, {
    id: "ai-run-replay-original",
    createdAt: "2026-03-11T09:30:00.000Z",
    updatedAt: "2026-03-11T09:30:05.000Z",
    quickActionId: input?.quickAction?.id,
  });

  const entry: ServerAIRunEntry = {
    origin: "mock",
    input,
    run: baseRun,
  };

  const replayInput = buildReplayAIRunInput(entry);
  assert.equal(replayInput.source?.replayOfRunId, "ai-run-replay-original");
  assert.equal(replayInput.source?.replayReason, "manual_replay");

  const replayRun = buildMockFinalRun(replayInput, {
    id: "ai-run-replay-copy",
    createdAt: "2026-03-11T09:45:00.000Z",
    updatedAt: "2026-03-11T09:45:05.000Z",
    quickActionId: replayInput.quickAction?.id,
  });

  const trace = buildAIRunTrace({
    origin: "mock",
    input: replayInput,
    run: replayRun,
  });

  assert.equal(trace.source.replayOfRunId, "ai-run-replay-original");
  assert.equal(trace.source.replayLabel, "Replay of ai-run-replay-original");
  assert.ok(trace.steps[0]?.summary.includes("Replay of ai-run-replay-original"));
});

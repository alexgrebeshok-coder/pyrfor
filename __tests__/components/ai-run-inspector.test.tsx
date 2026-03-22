import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { AIRunInspector } from "@/components/ai/ai-run-inspector";

const mockUseSWR = vi.fn();
const emptyResponse = {
  data: null as unknown,
  error: null as Error | null,
  isLoading: false,
  mutate: vi.fn(),
};

const responseMap = new Map<string, typeof emptyResponse>();

vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

function createTrace({
  modelName,
  proposalItemCount,
  proposalState,
  replayOfRunId,
  runId,
  title = "Execution trace",
  workflow = "direct_ai_run",
}: {
  modelName: string;
  proposalItemCount: number;
  proposalState: "pending" | "applied" | "dismissed" | null;
  replayOfRunId?: string;
  runId: string;
  title?: string;
  workflow?: string;
}) {
  return {
    runId,
    workflow,
    title,
    status: "done",
    agentId: "execution-planner",
    quickActionId: null,
    origin: "gateway",
    model: {
      name: modelName,
      status: "done",
    },
    source: {
      workflow,
      workflowLabel: workflow === "direct_ai_run" ? "Direct AI run" : "Work-report signal packet",
      purposeLabel: null,
      replayLabel: replayOfRunId ? `Replay of ${replayOfRunId}` : null,
      replayOfRunId,
      entityType: "project",
      entityId: "project-arctic-road",
      entityLabel: "Arctic Road",
    },
    context: {
      type: "project",
      title: "Arctic Road",
      pathname: "/projects/arctic-road",
      projectId: "project-arctic-road",
      facts: {
        projects: 1,
        tasks: 3,
        risks: 2,
        team: 4,
        notifications: 1,
      },
    },
    proposal: {
      type: proposalItemCount > 0 ? "update_tasks" : null,
      state: proposalState,
      title: proposalItemCount > 0 ? "Task patch" : null,
      summary: proposalItemCount > 0 ? "Keep the delivery patch aligned." : null,
      itemCount: proposalItemCount,
      previewItems: proposalItemCount > 0 ? ["Sequence the remaining work"] : [],
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
            operatorDecision: "manual_apply",
            postApplyState: "guarded_execution",
          }
        : null,
    },
    apply: null,
    collaboration: null,
    promptPreview: "Plan the next execution steps.",
    createdAt: "2026-03-19T08:00:00.000Z",
    updatedAt: "2026-03-19T08:05:00.000Z",
    steps: [
      {
        id: "model",
        label: "Model",
        status: "done",
        summary: "The run produced a final answer.",
        startedAt: "2026-03-19T08:00:00.000Z",
        endedAt: "2026-03-19T08:05:00.000Z",
      },
    ],
    failure: null,
  };
}

function installDefaultResponses() {
  responseMap.clear();
  responseMap.set(
    "/api/ai/runs/ai-run-123/trace",
    {
      ...emptyResponse,
      data: createTrace({
        runId: "ai-run-123",
        modelName: "openrouter/google/gemma-3-27b-it:free",
        proposalItemCount: 0,
        proposalState: null,
      }),
    }
  );

  responseMap.set(
    "/api/ai/runs/ai-run-replay/trace",
    {
      ...emptyResponse,
      data: createTrace({
        runId: "ai-run-replay",
        replayOfRunId: "ai-run-123-original",
        modelName: "openrouter/google/gemma-3-27b-it:free",
        proposalItemCount: 2,
        proposalState: "applied",
      }),
    }
  );

  responseMap.set(
    "/api/ai/runs/ai-run-123-original/trace",
    {
      ...emptyResponse,
      data: createTrace({
        runId: "ai-run-123-original",
        modelName: "openrouter/google/gemma-3-12b-it:free",
        proposalItemCount: 1,
        proposalState: "pending",
      }),
    }
  );
}

function swrMock(key: unknown) {
  if (typeof key !== "string") {
    return emptyResponse;
  }

  return responseMap.get(key) ?? emptyResponse;
}

describe("AIRunInspector", () => {
  beforeEach(() => {
    installDefaultResponses();
    mockUseSWR.mockImplementation(swrMock);
  });

  it("renders the live trace summary for the selected run", () => {
    render(<AIRunInspector runId="ai-run-123" />);

    expect(screen.getByText(/Execution trace/i)).toBeInTheDocument();
    expect(screen.getByText(/Direct AI run/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Arctic Road/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Refresh trace/i)).toBeInTheDocument();
    expect(screen.getByText(/Replay run/i)).toBeInTheDocument();
  });

  it("shows replay comparison details when the trace was rerun", () => {
    render(<AIRunInspector runId="ai-run-replay" />);

    expect(screen.getByText(/Replay comparison/i)).toBeInTheDocument();
    expect(screen.getByText(/Replay (matched|changed)/i)).toBeInTheDocument();
    expect(screen.getAllByText(/openrouter\/google\/gemma-3-12b-it:free/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/openrouter\/google\/gemma-3-27b-it:free/i).length).toBeGreaterThan(0);
  });
});

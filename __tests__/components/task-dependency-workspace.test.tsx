import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskDependencyWorkspace } from "@/components/tasks/task-dependency-workspace";
import type { Task } from "@/lib/types";

vi.mock("@/contexts/locale-context", () => ({
  useLocale: () => ({
    locale: "en",
    enumLabel: (_category: string, value: string) => value,
    formatDateLocalized: (value: string) => value,
  }),
}));

vi.mock("@/components/tasks/task-dependency-manager", () => ({
  TaskDependencyManager: ({ projectId, taskId }: { projectId: string; taskId: string }) => (
    <div data-testid="mock-task-dependency-manager">
      manager:{projectId}:{taskId}
    </div>
  ),
}));

const task: Task = {
  id: "task-1",
  projectId: "project-1",
  title: "Coordinate crane access",
  description: "Wait for crane permit before starting lift operations.",
  status: "blocked",
  order: 1,
  assignee: {
    id: "member-1",
    name: "Alex",
  },
  dueDate: "2026-03-30T00:00:00.000Z",
  priority: "high",
  tags: [],
  createdAt: "2026-03-25T00:00:00.000Z",
  blockedReason: "Waiting for permit handoff",
  dependencySummary: {
    dependencyCount: 2,
    dependentCount: 1,
    blockingDependencyCount: 1,
    downstreamImpactCount: 1,
    blockedByDependencies: true,
    earliestBlockingDueDate: "2026-03-28T00:00:00.000Z",
    blockingDependencies: [
      {
        id: "task-0",
        title: "Approve lift permit",
        status: "in-progress",
        dueDate: "2026-03-28T00:00:00.000Z",
        type: "FINISH_TO_START",
      },
    ],
  },
};

describe("TaskDependencyWorkspace", () => {
  it("renders focused dependency context for the selected task", () => {
    render(
      <TaskDependencyWorkspace
        onClose={() => undefined}
        projectName="Pier Extension"
        task={task}
      />
    );

    expect(screen.getByText("Dependency workspace")).toBeInTheDocument();
    expect(screen.getByText("Coordinate crane access")).toBeInTheDocument();
    expect(screen.getByText("Project:")).toBeInTheDocument();
    expect(screen.getAllByText("Pier Extension").length).toBeGreaterThan(0);
    expect(screen.getByText("Blocking predecessors")).toBeInTheDocument();
    expect(screen.getByText("Approve lift permit")).toBeInTheDocument();
    expect(screen.getByTestId("mock-task-dependency-manager")).toHaveTextContent(
      "manager:project-1:task-1"
    );
  });
});

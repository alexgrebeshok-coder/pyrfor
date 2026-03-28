import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksPage } from "@/components/tasks/tasks-page";
import type { Task } from "@/lib/types";

const mutateTasksMock = vi.fn();
let canManageTasks = true;

vi.mock("@/components/ai/ai-context-actions", () => ({
  AIContextActions: () => <div data-testid="mock-ai-context-actions" />,
}));

vi.mock("@/components/dashboard-provider", () => ({
  useDashboard: () => ({
    tasks: [],
    updateTaskStatus: vi.fn(),
  }),
}));

vi.mock("@/components/tasks/task-form-modal", () => ({
  TaskFormModal: () => null,
}));

vi.mock("@/components/tasks/task-dependency-workspace", () => ({
  TaskDependencyWorkspace: ({
    task,
    projectName,
  }: {
    task: Task;
    projectName?: string;
  }) => (
    <div data-testid="mock-task-dependency-workspace">
      workspace:{task.title}:{projectName}
    </div>
  ),
}));

vi.mock("@/contexts/locale-context", () => ({
  useLocale: () => ({
    locale: "en",
    t: (key: string) => key,
    enumLabel: (_category: string, value: string) => value,
    formatDateLocalized: (value: string) => value,
  }),
}));

vi.mock("@/lib/hooks/use-api", () => ({
  useTasks: () => ({
    tasks: [],
    isLoading: false,
    error: null,
    mutate: mutateTasksMock,
  }),
  useProjects: () => ({
    projects: [{ id: "project-1", name: "Pier Extension" }],
    isLoading: false,
    error: null,
    mutate: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/use-platform-permission", () => ({
  usePlatformPermission: () => ({
    allowed: canManageTasks,
  }),
}));

const initialTasks: Task[] = [
  {
    id: "task-1",
    projectId: "project-1",
    title: "Coordinate crane access",
    description: "Wait for permit handoff.",
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
      dependencyCount: 1,
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
  },
];

describe("TasksPage", () => {
  it("opens the dependency workspace from the task list", () => {
    canManageTasks = true;
    render(<TasksPage initialTasks={initialTasks} />);

    expect(screen.queryByTestId("mock-task-dependency-workspace")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /dependencies/i })[0]);

    expect(screen.getByTestId("mock-task-dependency-workspace")).toHaveTextContent(
      "workspace:Coordinate crane access:Pier Extension"
    );
  });

  it("disables task creation when manage permission is missing", () => {
    canManageTasks = false;

    render(<TasksPage initialTasks={initialTasks} />);

    expect(screen.getByTestId("create-task-button")).toBeDisabled();
  });
});

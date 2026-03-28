import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  buildTaskDependencySummary,
  enrichTaskWithDependencyInsights,
  enrichTasksWithDependencyInsights,
  type TaskDependencyEdgeRecord,
} from "@/lib/tasks/dependency-insights";

function createEdges(): TaskDependencyEdgeRecord[] {
  return [
    {
      taskId: "task-b",
      dependsOnTaskId: "task-a",
      projectId: "project-1",
    },
    {
      taskId: "task-c",
      dependsOnTaskId: "task-b",
      projectId: "project-1",
    },
  ];
}

describe("task dependency insights", () => {
  it("computes blocking predecessors and downstream impact", () => {
    const summary = buildTaskDependencySummary(
      {
        id: "task-b",
        projectId: "project-1",
        status: "todo",
        dependencies: [
          {
            id: "dep-b-a",
            type: "FINISH_TO_START",
            task: {
              id: "task-a",
              title: "Prep permit package",
              status: "in-progress",
              dueDate: "2026-03-28T00:00:00.000Z",
            },
          },
        ],
      },
      createEdges()
    );

    assert.equal(summary.dependencyCount, 1);
    assert.equal(summary.blockingDependencyCount, 1);
    assert.equal(summary.dependentCount, 1);
    assert.equal(summary.downstreamImpactCount, 1);
    assert.equal(summary.blockedByDependencies, true);
    assert.equal(summary.earliestBlockingDueDate, "2026-03-28T00:00:00.000Z");
  });

  it("builds honest blocked reasons from predecessor tasks", () => {
    const task = enrichTaskWithDependencyInsights(
      {
        id: "task-b",
        projectId: "project-1",
        status: "blocked",
        dependencies: [
          {
            id: "dep-b-a",
            type: "FINISH_TO_START",
            task: {
              id: "task-a",
              title: "Prep permit package",
              status: "blocked",
              dueDate: "2026-03-28T00:00:00.000Z",
            },
          },
        ],
      },
      createEdges()
    );

    assert.match(task.blockedReason ?? "", /Prep permit package/);
    assert.match(task.blockedReason ?? "", /Earliest unblock after 2026-03-28/);
  });

  it("keeps manually blocked tasks explicit when no dependencies explain the block", () => {
    const task = enrichTaskWithDependencyInsights(
      {
        id: "task-manual",
        projectId: "project-1",
        status: "blocked",
        dependencies: [],
      },
      createEdges()
    );

    assert.equal(task.dependencySummary.blockingDependencyCount, 0);
    assert.match(task.blockedReason ?? "", /no active predecessor dependency explains it yet/i);
  });

  it("counts transitive downstream impact across the project graph", () => {
    const [taskA] = enrichTasksWithDependencyInsights(
      [
        {
          id: "task-a",
          projectId: "project-1",
          status: "done",
          dependencies: [],
        },
      ],
      createEdges()
    );

    assert.equal(taskA.dependencySummary.dependentCount, 1);
    assert.equal(taskA.dependencySummary.downstreamImpactCount, 2);
  });
});

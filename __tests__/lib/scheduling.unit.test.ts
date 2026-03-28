import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { autoScheduleTasks } from "@/lib/scheduling/auto-schedule";
import { calculateCriticalPath, type SchedulingDependencyInput, type SchedulingTaskInput } from "@/lib/scheduling/critical-path";
import { levelResources } from "@/lib/scheduling/resource-leveling";

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function createTask(overrides: Partial<SchedulingTaskInput>): SchedulingTaskInput {
  return {
    id: overrides.id ?? "task-1",
    title: overrides.title ?? "Task",
    projectId: overrides.projectId ?? "project-1",
    startDate: overrides.startDate ?? null,
    dueDate: overrides.dueDate ?? date("2026-03-01"),
    estimatedHours: overrides.estimatedHours ?? 8,
    percentComplete: overrides.percentComplete ?? 0,
    isMilestone: overrides.isMilestone ?? false,
    isManualSchedule: overrides.isManualSchedule ?? false,
    constraintType: overrides.constraintType ?? null,
    constraintDate: overrides.constraintDate ?? null,
  };
}

function createDependency(
  overrides: Partial<SchedulingDependencyInput>
): SchedulingDependencyInput {
  return {
    id: overrides.id ?? "dep-1",
    taskId: overrides.taskId ?? "task-2",
    dependsOnTaskId: overrides.dependsOnTaskId ?? "task-1",
    type: overrides.type ?? "FINISH_TO_START",
    lagDays: overrides.lagDays ?? 0,
  };
}

describe("scheduling engine", () => {
  it("calculates critical path and float for a dependency chain", () => {
    const tasks = [
      createTask({
        id: "A",
        title: "Foundation",
        startDate: date("2026-03-01"),
        dueDate: date("2026-03-02"),
        estimatedHours: 16,
      }),
      createTask({
        id: "B",
        title: "Walls",
        dueDate: date("2026-03-02"),
        estimatedHours: 16,
      }),
      createTask({
        id: "C",
        title: "Roof",
        dueDate: date("2026-03-02"),
        estimatedHours: 8,
      }),
      createTask({
        id: "D",
        title: "Parallel prep",
        startDate: date("2026-03-01"),
        dueDate: date("2026-03-01"),
        estimatedHours: 8,
      }),
    ];

    const dependencies = [
      createDependency({ id: "dep-ab", taskId: "B", dependsOnTaskId: "A" }),
      createDependency({ id: "dep-bc", taskId: "C", dependsOnTaskId: "B" }),
    ];

    const result = calculateCriticalPath({
      tasks,
      dependencies,
      projectStart: date("2026-03-01"),
      projectEnd: date("2026-03-05"),
    });

    assert.deepEqual(result.criticalPath, ["A", "B", "C"]);

    const taskB = result.tasks.find((task) => task.taskId === "B");
    const taskD = result.tasks.find((task) => task.taskId === "D");

    assert.ok(taskB);
    assert.ok(taskD);
    assert.equal(taskB?.earliestStart.toISOString(), "2026-03-03T00:00:00.000Z");
    assert.equal(taskB?.earliestFinish.toISOString(), "2026-03-04T00:00:00.000Z");
    assert.equal(taskD?.isCritical, false);
    assert.ok((taskD?.totalFloatDays ?? 0) > 0);
  });

  it("auto-schedules dependent tasks from shared critical-path logic", () => {
    const tasks = [
      createTask({
        id: "A",
        title: "Foundation",
        startDate: date("2026-03-01"),
        dueDate: date("2026-03-03"),
        estimatedHours: 24,
      }),
      createTask({
        id: "B",
        title: "Walls",
        dueDate: date("2026-03-01"),
        estimatedHours: 16,
      }),
      createTask({
        id: "C",
        title: "Roof",
        dueDate: date("2026-03-01"),
        estimatedHours: 8,
      }),
    ];

    const dependencies = [
      createDependency({ id: "dep-ab", taskId: "B", dependsOnTaskId: "A" }),
      createDependency({ id: "dep-bc", taskId: "C", dependsOnTaskId: "B" }),
    ];

    const result = autoScheduleTasks({
      tasks,
      dependencies,
      projectStart: date("2026-03-01"),
      projectEnd: date("2026-03-08"),
    });

    assert.equal(result.updatedTasks.length, 2);

    const taskB = result.updatedTasks.find((task) => task.taskId === "B");
    const taskC = result.updatedTasks.find((task) => task.taskId === "C");

    assert.equal(taskB?.newStartDate.toISOString(), "2026-03-04T00:00:00.000Z");
    assert.equal(taskB?.newDueDate.toISOString(), "2026-03-05T00:00:00.000Z");
    assert.equal(taskC?.newStartDate.toISOString(), "2026-03-06T00:00:00.000Z");
    assert.equal(taskC?.newDueDate.toISOString(), "2026-03-06T00:00:00.000Z");
  });

  it("detects resource conflicts and suggests shifting non-critical work", () => {
    const tasks = [
      createTask({
        id: "A",
        title: "Critical work",
        startDate: date("2026-03-01"),
        dueDate: date("2026-03-02"),
        estimatedHours: 16,
      }),
      createTask({
        id: "B",
        title: "Flexible work",
        startDate: date("2026-03-01"),
        dueDate: date("2026-03-01"),
        estimatedHours: 8,
      }),
    ];

    const result = levelResources({
      tasks,
      dependencies: [],
      assignments: [
        {
          id: "assign-a",
          taskId: "A",
          memberId: "member-1",
          equipmentId: null,
          units: 100,
        },
        {
          id: "assign-b",
          taskId: "B",
          memberId: "member-1",
          equipmentId: null,
          units: 100,
        },
      ],
      capacities: [
        {
          resourceKey: "member:member-1",
          resourceId: "member-1",
          resourceType: "member",
          label: "Ирина П.",
          capacityUnits: 1,
        },
      ],
      projectStart: date("2026-03-01"),
      projectEnd: date("2026-03-03"),
    });

    assert.equal(result.conflicts.length, 1);
    assert.equal(result.adjustments.length, 1);
    assert.equal(result.adjustments[0]?.taskId, "B");
    assert.equal(result.adjustments[0]?.newStartDate.toISOString(), "2026-03-02T00:00:00.000Z");
  });
});

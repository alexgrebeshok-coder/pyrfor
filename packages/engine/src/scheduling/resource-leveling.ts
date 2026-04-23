import {
  autoScheduleTasks,
  type AutoScheduleResult,
} from './auto-schedule';
import {
  addDays,
  getDayOffset,
  type SchedulingDependencyInput,
  type SchedulingTaskInput,
} from './critical-path';

export interface SchedulingResourceAssignment {
  id: string;
  taskId: string;
  memberId: string | null;
  equipmentId: string | null;
  units: number | null;
}

export interface ResourceCapacityInput {
  resourceKey: string;
  resourceId: string;
  resourceType: "member" | "equipment";
  label: string;
  capacityUnits: number;
}

export interface ResourceLevelingConflict {
  resourceKey: string;
  resourceId: string;
  resourceType: "member" | "equipment";
  label: string;
  date: Date;
  loadUnits: number;
  capacityUnits: number;
  overloadUnits: number;
  taskIds: string[];
}

export interface ResourceLevelingAdjustment {
  taskId: string;
  title: string;
  shiftDays: number;
  newStartDate: Date;
  newDueDate: Date;
  reason: string;
}

export interface ResourceLevelingResult {
  criticalPath: AutoScheduleResult["criticalPath"];
  conflicts: ResourceLevelingConflict[];
  adjustments: ResourceLevelingAdjustment[];
}

type LevelingCandidate = {
  metric: AutoScheduleResult["criticalPath"]["tasks"][number];
  task: SchedulingTaskInput;
};

export function levelResources(input: {
  tasks: SchedulingTaskInput[];
  dependencies: SchedulingDependencyInput[];
  assignments: SchedulingResourceAssignment[];
  capacities: ResourceCapacityInput[];
  projectStart?: Date;
  projectEnd?: Date;
}): ResourceLevelingResult {
  const scheduled = autoScheduleTasks(input);
  const metricMap = new Map(scheduled.criticalPath.tasks.map((task) => [task.taskId, task]));
  const taskMap = new Map(input.tasks.map((task) => [task.id, task]));
  const capacityMap = new Map(input.capacities.map((capacity) => [capacity.resourceKey, capacity]));
  const loadMap = new Map<
    string,
    Map<number, { loadUnits: number; taskIds: Set<string> }>
  >();

  for (const assignment of input.assignments) {
    const metric = metricMap.get(assignment.taskId);
    if (!metric || metric.durationDays === 0) {
      continue;
    }

    const resourceKey = assignment.memberId
      ? `member:${assignment.memberId}`
      : assignment.equipmentId
        ? `equipment:${assignment.equipmentId}`
        : null;

    if (!resourceKey) {
      continue;
    }

    const units = Math.max(0, (assignment.units ?? 100) / 100);
    const startOffset = getDayOffset(metric.earliestStart, scheduled.criticalPath.projectStart);
    const resourceTimeline = loadMap.get(resourceKey) ?? new Map();

    for (let dayOffset = 0; dayOffset < metric.durationDays; dayOffset += 1) {
      const bucket = resourceTimeline.get(startOffset + dayOffset) ?? {
        loadUnits: 0,
        taskIds: new Set<string>(),
      };

      bucket.loadUnits += units;
      bucket.taskIds.add(assignment.taskId);
      resourceTimeline.set(startOffset + dayOffset, bucket);
    }

    loadMap.set(resourceKey, resourceTimeline);
  }

  const conflicts: ResourceLevelingConflict[] = [];

  for (const [resourceKey, resourceTimeline] of loadMap) {
    const capacity =
      capacityMap.get(resourceKey) ??
      ({
        resourceKey,
        resourceId: resourceKey.split(":")[1] ?? resourceKey,
        resourceType: resourceKey.startsWith("equipment:") ? "equipment" : "member",
        label: resourceKey,
        capacityUnits: 1,
      } satisfies ResourceCapacityInput);

    for (const [offset, bucket] of resourceTimeline) {
      if (bucket.loadUnits <= capacity.capacityUnits) {
        continue;
      }

      conflicts.push({
        resourceKey,
        resourceId: capacity.resourceId,
        resourceType: capacity.resourceType,
        label: capacity.label,
        date: addDays(scheduled.criticalPath.projectStart, offset),
        loadUnits: Number(bucket.loadUnits.toFixed(2)),
        capacityUnits: capacity.capacityUnits,
        overloadUnits: Number((bucket.loadUnits - capacity.capacityUnits).toFixed(2)),
        taskIds: [...bucket.taskIds],
      });
    }
  }

  const shiftByTask = new Map<string, number>();

  for (const conflict of conflicts) {
    const candidates = conflict.taskIds
      .map((taskId) => {
        const metric = metricMap.get(taskId);
        const task = taskMap.get(taskId);
        if (!metric || !task || metric.isCritical || task.isManualSchedule) {
          return null;
        }
        return { metric, task };
      })
      .filter((candidate): candidate is LevelingCandidate => candidate !== null)
      .sort((left, right) => right.metric.totalFloatDays - left.metric.totalFloatDays);

    const selected = candidates.find((candidate) => {
      const assignedShift = shiftByTask.get(candidate.metric.taskId) ?? 0;
      return assignedShift < candidate.metric.totalFloatDays;
    });

    if (!selected) {
      continue;
    }

    shiftByTask.set(selected.metric.taskId, (shiftByTask.get(selected.metric.taskId) ?? 0) + 1);
  }

  const adjustments: ResourceLevelingAdjustment[] = [...shiftByTask.entries()].map(
    ([taskId, shiftDays]) => {
      const metric = metricMap.get(taskId)!;
      return {
        taskId,
        title: metric.title,
        shiftDays,
        newStartDate: addDays(metric.earliestStart, shiftDays),
        newDueDate: addDays(metric.earliestFinish, shiftDays),
        reason: "Resource overallocation leveling",
      };
    }
  );

  return {
    criticalPath: scheduled.criticalPath,
    conflicts,
    adjustments,
  };
}

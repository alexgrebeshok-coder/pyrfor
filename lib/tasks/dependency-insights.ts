interface TaskDependencyRelationRecord {
  id: string;
  type: string;
  task: {
    id: string;
    title: string;
    status: string;
    dueDate: Date | string;
  };
}

export interface TaskDependencyEdgeRecord {
  taskId: string;
  dependsOnTaskId: string;
  projectId: string;
}

export interface TaskDependencySummaryRecord {
  dependencyCount: number;
  dependentCount: number;
  blockingDependencyCount: number;
  downstreamImpactCount: number;
  blockedByDependencies: boolean;
  earliestBlockingDueDate: string | null;
  blockingDependencies: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: string;
    type: string;
  }>;
}

interface TaskWithDependencyRelations {
  id: string;
  projectId: string;
  status: string;
  dependencies: TaskDependencyRelationRecord[];
}

function toIsoString(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function compareIsoDate(left: string, right: string) {
  return new Date(left).getTime() - new Date(right).getTime();
}

function buildSuccessorMap(projectEdges: TaskDependencyEdgeRecord[]) {
  const map = new Map<string, string[]>();

  for (const edge of projectEdges) {
    const current = map.get(edge.dependsOnTaskId) ?? [];
    current.push(edge.taskId);
    map.set(edge.dependsOnTaskId, current);
  }

  return map;
}

function countDownstreamImpact(taskId: string, successorMap: Map<string, string[]>) {
  const visited = new Set<string>();
  const stack = [...(successorMap.get(taskId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) {
      continue;
    }

    visited.add(current);
    stack.push(...(successorMap.get(current) ?? []));
  }

  return visited.size;
}

function buildBlockedReason(
  taskStatus: string,
  summary: TaskDependencySummaryRecord
) {
  if (summary.blockingDependencyCount === 0) {
    return taskStatus === "blocked"
      ? "Task is blocked, but no active predecessor dependency explains it yet."
      : undefined;
  }

  if (summary.blockingDependencyCount === 1) {
    const [dependency] = summary.blockingDependencies;
    const dueDateSuffix = summary.earliestBlockingDueDate
      ? ` Earliest unblock after ${summary.earliestBlockingDueDate.slice(0, 10)}.`
      : "";
    return `Waiting for predecessor "${dependency.title}" (${dependency.status}).${dueDateSuffix}`;
  }

  const preview = summary.blockingDependencies
    .slice(0, 2)
    .map((dependency) => `"${dependency.title}"`)
    .join(", ");
  const remaining = summary.blockingDependencyCount - 2;
  const remainingSuffix = remaining > 0 ? ` and ${remaining} more` : "";
  const dueDateSuffix = summary.earliestBlockingDueDate
    ? ` Earliest unblock after ${summary.earliestBlockingDueDate.slice(0, 10)}.`
    : "";
  return `Waiting for ${summary.blockingDependencyCount} predecessor tasks: ${preview}${remainingSuffix}.${dueDateSuffix}`;
}

export function buildTaskDependencySummary(
  task: TaskWithDependencyRelations,
  projectEdges: TaskDependencyEdgeRecord[]
): TaskDependencySummaryRecord {
  const successorMap = buildSuccessorMap(projectEdges);
  const blockingDependencies = task.dependencies
    .filter((dependency) => dependency.task.status !== "done")
    .map((dependency) => ({
      id: dependency.task.id,
      title: dependency.task.title,
      status: dependency.task.status,
      dueDate: toIsoString(dependency.task.dueDate),
      type: dependency.type,
    }))
    .sort((left, right) => compareIsoDate(left.dueDate, right.dueDate));

  const dependentCount = successorMap.get(task.id)?.length ?? 0;

  return {
    dependencyCount: task.dependencies.length,
    dependentCount,
    blockingDependencyCount: blockingDependencies.length,
    downstreamImpactCount: countDownstreamImpact(task.id, successorMap),
    blockedByDependencies: blockingDependencies.length > 0,
    earliestBlockingDueDate: blockingDependencies[0]?.dueDate ?? null,
    blockingDependencies,
  };
}

export function enrichTaskWithDependencyInsights<T extends TaskWithDependencyRelations>(
  task: T,
  projectEdges: TaskDependencyEdgeRecord[]
) {
  const dependencySummary = buildTaskDependencySummary(task, projectEdges);

  return {
    ...task,
    blockedReason: buildBlockedReason(task.status, dependencySummary),
    dependencySummary,
  };
}

export function enrichTasksWithDependencyInsights<T extends TaskWithDependencyRelations>(
  tasks: T[],
  projectEdges: TaskDependencyEdgeRecord[]
) {
  const edgesByProject = new Map<string, TaskDependencyEdgeRecord[]>();

  for (const edge of projectEdges) {
    const current = edgesByProject.get(edge.projectId) ?? [];
    current.push(edge);
    edgesByProject.set(edge.projectId, current);
  }

  return tasks.map((task) =>
    enrichTaskWithDependencyInsights(task, edgesByProject.get(task.projectId) ?? [])
  );
}

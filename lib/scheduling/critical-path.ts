const DAY_MS = 24 * 60 * 60 * 1000;

export type SchedulingDependencyType =
  | "FINISH_TO_START"
  | "START_TO_START"
  | "FINISH_TO_FINISH"
  | "START_TO_FINISH";

export interface SchedulingTaskInput {
  id: string;
  title: string;
  projectId: string;
  startDate: Date | null;
  dueDate: Date;
  estimatedHours: number | null;
  percentComplete: number;
  isMilestone: boolean;
  isManualSchedule: boolean;
  constraintType: string | null;
  constraintDate: Date | null;
}

export interface SchedulingDependencyInput {
  id: string;
  taskId: string;
  dependsOnTaskId: string;
  type: string;
  lagDays: number;
}

export interface CriticalPathTaskMetrics {
  taskId: string;
  title: string;
  earliestStart: Date;
  earliestFinish: Date;
  latestStart: Date;
  latestFinish: Date;
  durationDays: number;
  totalFloatDays: number;
  freeFloatDays: number;
  isCritical: boolean;
  percentComplete: number;
  isManualSchedule: boolean;
}

export interface CriticalPathResult {
  projectStart: Date;
  projectFinish: Date;
  tasks: CriticalPathTaskMetrics[];
  criticalPath: string[];
}

interface PreparedTask extends SchedulingTaskInput {
  normalizedStart: Date;
  normalizedDue: Date;
  durationDays: number;
  currentStartIndex: number;
}

interface IndexedNode {
  es: number;
  ef: number;
  ls: number;
  lf: number;
}

function normalizeDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(normalizeDate(date).getTime() + days * DAY_MS);
}

export function getDayOffset(date: Date, anchor: Date): number {
  return Math.round((normalizeDate(date).getTime() - normalizeDate(anchor).getTime()) / DAY_MS);
}

export function normalizeDependencyType(value: string): SchedulingDependencyType {
  switch (value) {
    case "START_TO_START":
    case "FINISH_TO_FINISH":
    case "START_TO_FINISH":
      return value;
    default:
      return "FINISH_TO_START";
  }
}

export function getTaskDurationDays(task: SchedulingTaskInput): number {
  if (task.isMilestone) return 0;

  if (task.startDate) {
    const start = normalizeDate(task.startDate);
    const due = normalizeDate(task.dueDate);
    const span = getDayOffset(due, start) + 1;
    return Math.max(1, span);
  }

  if (typeof task.estimatedHours === "number" && Number.isFinite(task.estimatedHours)) {
    return Math.max(1, Math.ceil(task.estimatedHours / 8));
  }

  return 1;
}

export function getTaskStartDate(task: SchedulingTaskInput): Date {
  const due = normalizeDate(task.dueDate);
  const durationDays = getTaskDurationDays(task);

  if (task.startDate) {
    return normalizeDate(task.startDate);
  }

  if (durationDays === 0) {
    return due;
  }

  return addDays(due, -(durationDays - 1));
}

export function getTaskFinishDate(task: SchedulingTaskInput): Date {
  return normalizeDate(task.dueDate);
}

function prepareTasks(
  tasks: SchedulingTaskInput[],
  projectStart?: Date
): { anchor: Date; prepared: Map<string, PreparedTask> } {
  const normalizedProjectStart = projectStart ? normalizeDate(projectStart) : null;
  const anchor =
    normalizedProjectStart ??
    tasks.reduce<Date | null>((minDate, task) => {
      const start = getTaskStartDate(task);
      if (!minDate || start < minDate) return start;
      return minDate;
    }, null) ??
    normalizeDate(new Date());

  const prepared = new Map<string, PreparedTask>();
  for (const task of tasks) {
    const normalizedStart = getTaskStartDate(task);
    const normalizedDue = getTaskFinishDate(task);
    const durationDays = getTaskDurationDays(task);
    prepared.set(task.id, {
      ...task,
      normalizedStart,
      normalizedDue,
      durationDays,
      currentStartIndex: getDayOffset(normalizedStart, anchor),
    });
  }

  return { anchor, prepared };
}

function topologicalSort(
  taskIds: string[],
  dependencies: SchedulingDependencyInput[]
): string[] {
  const inDegree = new Map<string, number>(taskIds.map((taskId) => [taskId, 0]));
  const outgoing = new Map<string, string[]>(taskIds.map((taskId) => [taskId, []]));

  for (const dependency of dependencies) {
    if (!inDegree.has(dependency.taskId) || !inDegree.has(dependency.dependsOnTaskId)) {
      continue;
    }
    inDegree.set(dependency.taskId, (inDegree.get(dependency.taskId) ?? 0) + 1);
    outgoing.get(dependency.dependsOnTaskId)?.push(dependency.taskId);
  }

  const queue = taskIds.filter((taskId) => (inDegree.get(taskId) ?? 0) === 0);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const next of outgoing.get(current) ?? []) {
      const nextInDegree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, nextInDegree);
      if (nextInDegree === 0) {
        queue.push(next);
      }
    }
  }

  if (result.length !== taskIds.length) {
    throw new Error("Circular dependency detected in scheduling graph");
  }

  return result;
}

function successorMinStart(
  dependency: SchedulingDependencyInput,
  predecessor: IndexedNode,
  successorDuration: number
): number {
  const lag = dependency.lagDays ?? 0;
  const type = normalizeDependencyType(dependency.type);

  switch (type) {
    case "START_TO_START":
      return predecessor.es + lag;
    case "FINISH_TO_FINISH":
      return predecessor.ef + lag - successorDuration;
    case "START_TO_FINISH":
      return predecessor.es + lag - successorDuration;
    case "FINISH_TO_START":
    default:
      return predecessor.ef + lag;
  }
}

function predecessorMaxFinish(
  dependency: SchedulingDependencyInput,
  successor: IndexedNode,
  predecessorDuration: number
): number {
  const lag = dependency.lagDays ?? 0;
  const type = normalizeDependencyType(dependency.type);

  switch (type) {
    case "START_TO_START":
      return successor.ls - lag + predecessorDuration;
    case "FINISH_TO_FINISH":
      return successor.lf - lag;
    case "START_TO_FINISH":
      return successor.lf - lag + predecessorDuration;
    case "FINISH_TO_START":
    default:
      return successor.ls - lag;
  }
}

function applyEarliestConstraint(
  startIndex: number,
  task: PreparedTask,
  anchor: Date
): number {
  if (!task.constraintType || !task.constraintDate) {
    return startIndex;
  }

  const constraintIndex = getDayOffset(task.constraintDate, anchor);
  const finishConstraintExclusive = constraintIndex + 1;

  switch (task.constraintType) {
    case "MSO":
      return constraintIndex;
    case "MFO":
      return finishConstraintExclusive - task.durationDays;
    case "SNET":
      return Math.max(startIndex, constraintIndex);
    case "FNET":
      return Math.max(startIndex, finishConstraintExclusive - task.durationDays);
    default:
      return startIndex;
  }
}

function applyLatestConstraint(
  finishIndex: number,
  task: PreparedTask,
  anchor: Date
): number {
  if (!task.constraintType || !task.constraintDate) {
    return finishIndex;
  }

  const constraintIndex = getDayOffset(task.constraintDate, anchor);
  const finishConstraintExclusive = constraintIndex + 1;

  switch (task.constraintType) {
    case "MSO":
      return constraintIndex + task.durationDays;
    case "MFO":
      return finishConstraintExclusive;
    case "SNLT":
      return Math.min(finishIndex, constraintIndex + task.durationDays);
    case "FNLT":
      return Math.min(finishIndex, finishConstraintExclusive);
    default:
      return finishIndex;
  }
}

function computeFreeFloatDays(
  taskId: string,
  node: IndexedNode,
  outgoingDependencies: Map<string, SchedulingDependencyInput[]>,
  nodes: Map<string, IndexedNode>
): number {
  const outgoing = outgoingDependencies.get(taskId) ?? [];
  if (!outgoing.length) {
    return Math.max(0, node.ls - node.es);
  }

  let minFloat = Number.POSITIVE_INFINITY;
  for (const dependency of outgoing) {
    const successor = nodes.get(dependency.taskId);
    if (!successor) continue;

    const lag = dependency.lagDays ?? 0;
    const type = normalizeDependencyType(dependency.type);
    let candidate = 0;

    switch (type) {
      case "START_TO_START":
        candidate = successor.es - lag - node.es;
        break;
      case "FINISH_TO_FINISH":
        candidate = successor.ef - lag - node.ef;
        break;
      case "START_TO_FINISH":
        candidate = successor.ef - lag - node.es;
        break;
      case "FINISH_TO_START":
      default:
        candidate = successor.es - lag - node.ef;
        break;
    }

    minFloat = Math.min(minFloat, candidate);
  }

  if (!Number.isFinite(minFloat)) {
    return Math.max(0, node.ls - node.es);
  }

  return Math.max(0, minFloat);
}

export function calculateCriticalPath(input: {
  tasks: SchedulingTaskInput[];
  dependencies: SchedulingDependencyInput[];
  projectStart?: Date;
  projectEnd?: Date;
}): CriticalPathResult {
  const { tasks, dependencies, projectStart, projectEnd } = input;

  if (tasks.length === 0) {
    const today = normalizeDate(new Date());
    return {
      projectStart: today,
      projectFinish: today,
      tasks: [],
      criticalPath: [],
    };
  }

  const { anchor, prepared } = prepareTasks(tasks, projectStart);
  const taskIds = tasks.map((task) => task.id);
  const orderedTaskIds = topologicalSort(taskIds, dependencies);

  const incomingDependencies = new Map<string, SchedulingDependencyInput[]>();
  const outgoingDependencies = new Map<string, SchedulingDependencyInput[]>();

  for (const dependency of dependencies) {
    if (!prepared.has(dependency.taskId) || !prepared.has(dependency.dependsOnTaskId)) {
      continue;
    }
    incomingDependencies.set(dependency.taskId, [
      ...(incomingDependencies.get(dependency.taskId) ?? []),
      dependency,
    ]);
    outgoingDependencies.set(dependency.dependsOnTaskId, [
      ...(outgoingDependencies.get(dependency.dependsOnTaskId) ?? []),
      dependency,
    ]);
  }

  const nodes = new Map<string, IndexedNode>();

  for (const taskId of orderedTaskIds) {
    const task = prepared.get(taskId)!;
    let earliestStart = task.currentStartIndex;

    for (const dependency of incomingDependencies.get(taskId) ?? []) {
      const predecessor = nodes.get(dependency.dependsOnTaskId);
      if (!predecessor) continue;
      earliestStart = Math.max(
        earliestStart,
        successorMinStart(dependency, predecessor, task.durationDays)
      );
    }

    earliestStart = applyEarliestConstraint(earliestStart, task, anchor);
    const earliestFinish = earliestStart + task.durationDays;
    nodes.set(taskId, {
      es: earliestStart,
      ef: earliestFinish,
      ls: earliestStart,
      lf: earliestFinish,
    });
  }

  const projectEndIndex =
    projectEnd && Number.isFinite(projectEnd.getTime())
      ? getDayOffset(projectEnd, anchor) + 1
      : null;

  let finishIndex =
    projectEndIndex ??
    Math.max(...Array.from(nodes.values(), (node) => node.ef));

  for (const taskId of [...orderedTaskIds].reverse()) {
    const task = prepared.get(taskId)!;
    const outgoing = outgoingDependencies.get(taskId) ?? [];
    let latestFinish = finishIndex;

    if (outgoing.length > 0) {
      latestFinish = Number.POSITIVE_INFINITY;
      for (const dependency of outgoing) {
        const successor = nodes.get(dependency.taskId);
        if (!successor) continue;
        latestFinish = Math.min(
          latestFinish,
          predecessorMaxFinish(dependency, successor, task.durationDays)
        );
      }
      if (!Number.isFinite(latestFinish)) {
        latestFinish = finishIndex;
      }
    }

    latestFinish = applyLatestConstraint(latestFinish, task, anchor);
    const latestStart = latestFinish - task.durationDays;
    nodes.set(taskId, {
      ...nodes.get(taskId)!,
      ls: latestStart,
      lf: latestFinish,
    });
  }

  const taskMetrics: CriticalPathTaskMetrics[] = orderedTaskIds.map((taskId) => {
    const task = prepared.get(taskId)!;
    const node = nodes.get(taskId)!;
    const durationDays = task.durationDays;
    const earliestStart = addDays(anchor, node.es);
    const earliestFinish =
      durationDays === 0 ? earliestStart : addDays(anchor, node.ef - 1);
    const latestStart = addDays(anchor, node.ls);
    const latestFinish =
      durationDays === 0 ? latestStart : addDays(anchor, node.lf - 1);
    const totalFloatDays = Math.max(0, node.ls - node.es);
    const freeFloatDays = computeFreeFloatDays(taskId, node, outgoingDependencies, nodes);
    const isCritical = totalFloatDays === 0;

    return {
      taskId,
      title: task.title,
      earliestStart,
      earliestFinish,
      latestStart,
      latestFinish,
      durationDays,
      totalFloatDays,
      freeFloatDays,
      isCritical,
      percentComplete: task.percentComplete,
      isManualSchedule: task.isManualSchedule,
    };
  });

  finishIndex = Math.max(...Array.from(nodes.values(), (node) => node.ef), finishIndex);

  return {
    projectStart: anchor,
    projectFinish: addDays(anchor, Math.max(0, finishIndex - 1)),
    tasks: taskMetrics,
    criticalPath: taskMetrics.filter((task) => task.isCritical).map((task) => task.taskId),
  };
}

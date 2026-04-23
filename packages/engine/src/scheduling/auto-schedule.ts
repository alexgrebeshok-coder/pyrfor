import {
  calculateCriticalPath,
  getTaskFinishDate,
  getTaskStartDate,
  type CriticalPathResult,
  type SchedulingDependencyInput,
  type SchedulingTaskInput,
} from './critical-path';

export interface AutoScheduleTaskUpdate {
  taskId: string;
  title: string;
  oldStartDate: Date;
  newStartDate: Date;
  oldDueDate: Date;
  newDueDate: Date;
  durationDays: number;
  totalFloatDays: number;
  isCritical: boolean;
}

export interface AutoScheduleResult {
  criticalPath: CriticalPathResult;
  updatedTasks: AutoScheduleTaskUpdate[];
}

export function autoScheduleTasks(input: {
  tasks: SchedulingTaskInput[];
  dependencies: SchedulingDependencyInput[];
  projectStart?: Date;
  projectEnd?: Date;
}): AutoScheduleResult {
  const criticalPath = calculateCriticalPath(input);
  const taskMap = new Map(input.tasks.map((task) => [task.id, task]));

  const updatedTasks = criticalPath.tasks.flatMap((metrics) => {
    const task = taskMap.get(metrics.taskId);
    if (!task || task.isManualSchedule) {
      return [];
    }

    const oldStartDate = getTaskStartDate(task);
    const oldDueDate = getTaskFinishDate(task);
    const newStartDate = metrics.earliestStart;
    const newDueDate = metrics.earliestFinish;

    const changed =
      oldStartDate.getTime() !== newStartDate.getTime() ||
      oldDueDate.getTime() !== newDueDate.getTime() ||
      task.startDate === null;

    if (!changed) {
      return [];
    }

    return [
      {
        taskId: metrics.taskId,
        title: metrics.title,
        oldStartDate,
        newStartDate,
        oldDueDate,
        newDueDate,
        durationDays: metrics.durationDays,
        totalFloatDays: metrics.totalFloatDays,
        isCritical: metrics.isCritical,
      },
    ];
  });

  return {
    criticalPath,
    updatedTasks,
  };
}

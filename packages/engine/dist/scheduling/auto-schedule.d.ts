import { type CriticalPathResult, type SchedulingDependencyInput, type SchedulingTaskInput } from './critical-path';
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
export declare function autoScheduleTasks(input: {
    tasks: SchedulingTaskInput[];
    dependencies: SchedulingDependencyInput[];
    projectStart?: Date;
    projectEnd?: Date;
}): AutoScheduleResult;
//# sourceMappingURL=auto-schedule.d.ts.map
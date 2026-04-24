export type SchedulingDependencyType = "FINISH_TO_START" | "START_TO_START" | "FINISH_TO_FINISH" | "START_TO_FINISH";
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
export declare function addDays(date: Date, days: number): Date;
export declare function getDayOffset(date: Date, anchor: Date): number;
export declare function normalizeDependencyType(value: string): SchedulingDependencyType;
export declare function getTaskDurationDays(task: SchedulingTaskInput): number;
export declare function getTaskStartDate(task: SchedulingTaskInput): Date;
export declare function getTaskFinishDate(task: SchedulingTaskInput): Date;
export declare function calculateCriticalPath(input: {
    tasks: SchedulingTaskInput[];
    dependencies: SchedulingDependencyInput[];
    projectStart?: Date;
    projectEnd?: Date;
}): CriticalPathResult;
//# sourceMappingURL=critical-path.d.ts.map
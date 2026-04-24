import { type AutoScheduleResult } from './auto-schedule';
import { type SchedulingDependencyInput, type SchedulingTaskInput } from './critical-path';
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
export declare function levelResources(input: {
    tasks: SchedulingTaskInput[];
    dependencies: SchedulingDependencyInput[];
    assignments: SchedulingResourceAssignment[];
    capacities: ResourceCapacityInput[];
    projectStart?: Date;
    projectEnd?: Date;
}): ResourceLevelingResult;
//# sourceMappingURL=resource-leveling.d.ts.map
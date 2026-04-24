import type { CriticalPathResult, SchedulingDependencyInput, SchedulingTaskInput } from './critical-path';
import type { ResourceCapacityInput, SchedulingResourceAssignment } from './resource-leveling';
export interface ProjectSchedulingContext {
    project: {
        id: string;
        start: Date;
        end: Date;
    };
    tasks: SchedulingTaskInput[];
    dependencies: SchedulingDependencyInput[];
    assignments: SchedulingResourceAssignment[];
    capacities: ResourceCapacityInput[];
}
export declare function createSchedulingId(prefix: string): string;
export declare function getProjectSchedulingContext(projectId: string): Promise<ProjectSchedulingContext | null>;
export declare function serializeCriticalPath(result: CriticalPathResult): {
    projectStart: string;
    projectFinish: string;
    criticalPath: string[];
    tasks: {
        earliestStart: string;
        earliestFinish: string;
        latestStart: string;
        latestFinish: string;
        taskId: string;
        title: string;
        durationDays: number;
        totalFloatDays: number;
        freeFloatDays: number;
        isCritical: boolean;
        percentComplete: number;
        isManualSchedule: boolean;
    }[];
};
//# sourceMappingURL=service.d.ts.map
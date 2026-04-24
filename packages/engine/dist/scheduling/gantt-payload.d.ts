export interface GanttProjectV2 {
    id: string;
    name: string;
    start: string;
    end: string;
    status: string;
    progress: number | null;
}
export interface GanttDependencyV2 {
    id: string;
    source: string;
    target: string;
    type: string;
    lagDays: number;
    isCritical: boolean;
    sourceTask: string;
    targetTask: string;
}
export interface GanttTaskV2 {
    id: string;
    name: string;
    title: string;
    start: string;
    end: string;
    progress: number;
    status: string;
    projectId: string;
    type: string;
    dependencies: string[];
    wbs: string | null;
    parentTaskId: string | null;
    isMilestone: boolean;
    isManualSchedule: boolean;
    durationDays: number;
    totalFloatDays: number;
    freeFloatDays: number;
    isCritical: boolean;
    estimatedHours: number | null;
    estimatedCost: number | null;
    actualCost: number | null;
    resourceAssignments: Array<{
        id: string;
        memberId: string | null;
        memberName: string | null;
        equipmentId: string | null;
        equipmentName: string | null;
        units: number;
        plannedHours: number | null;
        actualHours: number | null;
        costRate: number | null;
    }>;
    baselines: Array<{
        id: string;
        baselineNumber: number;
        startDate: string;
        finishDate: string;
        duration: number | null;
        cost: number | null;
        work: number | null;
    }>;
}
export interface ProjectGanttSnapshot {
    project: GanttProjectV2;
    tasks: GanttTaskV2[];
    dependencies: GanttDependencyV2[];
}
export declare function buildProjectGanttSnapshot(projectId: string): Promise<ProjectGanttSnapshot | null>;
//# sourceMappingURL=gantt-payload.d.ts.map
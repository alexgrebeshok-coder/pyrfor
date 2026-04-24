/**
 * Daily overallocation calculator
 * Reads ResourceAssignment + Task dates → daily load per resource
 */
export interface DailyResourceLoad {
    date: string;
    resourceId: string;
    resourceName: string;
    resourceType: "member" | "equipment";
    allocatedHours: number;
    capacityHours: number;
    overallocated: boolean;
}
/**
 * Calculate daily resource load for a project within a date range
 */
export declare function calculateDailyLoad(projectId: string, startDate: Date, endDate: Date): Promise<DailyResourceLoad[]>;
/**
 * Get summary: overallocated days per resource
 */
export declare function getOverallocationSummary(projectId: string, startDate: Date, endDate: Date): Promise<Array<{
    resourceId: string;
    resourceName: string;
    overallocatedDays: number;
    maxOverload: number;
}>>;
//# sourceMappingURL=overallocation.d.ts.map
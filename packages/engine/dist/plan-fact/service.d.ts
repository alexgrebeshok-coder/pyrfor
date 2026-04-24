import type { ExecutiveSnapshot } from '../briefs/types';
import type { PortfolioPlanFactSummary, ProjectPlanFactSummary } from "./types";
interface PlanFactOptions {
    referenceDate?: string | Date;
}
export declare function buildProjectPlanFactSummary(snapshot: ExecutiveSnapshot, projectId: string, options?: PlanFactOptions): ProjectPlanFactSummary;
export declare function buildPortfolioPlanFactSummary(snapshot: ExecutiveSnapshot, options?: PlanFactOptions): PortfolioPlanFactSummary;
export declare function summarizeProjectPlanFactForBrief(summary: ProjectPlanFactSummary): {
    plannedProgress: number;
    actualProgress: number;
    progressVariance: number;
    cpi: number | null;
    spi: number | null;
    pendingWorkReports: number;
    daysSinceLastApprovedReport: number | null;
};
export {};
//# sourceMappingURL=service.d.ts.map
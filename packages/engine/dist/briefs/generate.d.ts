import { type BriefLocale } from "./locale";
import type { ExecutiveSnapshot, PortfolioBrief, ProjectBrief } from "./types";
type BriefOptions = {
    referenceDate?: string | Date;
    locale?: BriefLocale;
};
export declare function generatePortfolioBrief(options?: BriefOptions): Promise<PortfolioBrief>;
export declare function generateProjectBrief(projectId: string, options?: BriefOptions): Promise<ProjectBrief>;
export declare function generatePortfolioBriefFromSnapshot(snapshot: ExecutiveSnapshot, options?: BriefOptions): PortfolioBrief;
export declare function generateProjectBriefFromSnapshot(snapshot: ExecutiveSnapshot, projectId: string, options?: BriefOptions): ProjectBrief;
export declare function buildDemoPortfolioBrief(referenceDate: string | Date): Promise<PortfolioBrief>;
export {};
//# sourceMappingURL=generate.d.ts.map
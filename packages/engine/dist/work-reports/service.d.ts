import type { CreateWorkReportInput, UpdateWorkReportInput, WorkReportQuery, WorkReportStatus, WorkReportView } from "./types";
export declare function listWorkReports(query?: WorkReportQuery): Promise<WorkReportView[]>;
export declare function getWorkReportById(id: string): Promise<WorkReportView | null>;
export declare function createWorkReport(input: CreateWorkReportInput): Promise<WorkReportView>;
export declare function updateWorkReport(id: string, input: UpdateWorkReportInput): Promise<WorkReportView>;
export declare function approveWorkReport(id: string, input: {
    reviewerId: string;
    reviewComment?: string | null;
}): Promise<WorkReportView>;
export declare function rejectWorkReport(id: string, input: {
    reviewerId: string;
    reviewComment: string;
}): Promise<WorkReportView>;
export declare function deleteWorkReport(id: string): Promise<void>;
export declare function generateNextWorkReportNumber(reportDate: string): Promise<string>;
export declare function normalizeWorkReportStatus(value: unknown): WorkReportStatus | undefined;
//# sourceMappingURL=service.d.ts.map
import type { EVMResult, TaskEVMResult } from "./types";
export interface ProjectEvmSnapshotPayload {
    projectId: string;
    projectName: string;
    referenceDate: string;
    source: "task_costs" | "project_budget";
    metrics: EVMResult;
    summary: {
        taskCount: number;
        costedTaskCount: number;
        taskBudgetCoverage: number;
    };
    taskMetrics: TaskEVMResult[];
}
export declare function getProjectEvmSnapshot(projectId: string, referenceDate?: Date): Promise<ProjectEvmSnapshotPayload>;
export declare function listWorkspaceEvmSnapshots(workspaceId: string, referenceDate?: Date): Promise<{
    referenceDate: string;
    metrics: EVMResult;
    projects: ProjectEvmSnapshotPayload[];
    summary: {
        projectCount: number;
        taskCount: number;
        costedTaskCount: number;
    };
}>;
export declare function saveEvmSnapshot(projectId: string, snapshotDate?: Date): Promise<{
    snapshot: {
        id: string;
        createdAt: Date;
        date: Date;
        spi: number | null;
        cpi: number | null;
        projectId: string;
        bac: number;
        ac: number;
        pv: number;
        ev: number;
        eac: number | null;
        tcpi: number | null;
    };
    payload: ProjectEvmSnapshotPayload;
}>;
export declare function getEvmHistory(projectId: string, options?: {
    fromDate?: Date;
    toDate?: Date;
}): Promise<{
    id: string;
    createdAt: Date;
    date: Date;
    spi: number | null;
    cpi: number | null;
    projectId: string;
    bac: number;
    ac: number;
    pv: number;
    ev: number;
    eac: number | null;
    tcpi: number | null;
}[]>;
//# sourceMappingURL=snapshot-service.d.ts.map
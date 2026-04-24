export interface Project {
    id: string;
    name: string;
    budgetPlan: number;
    budgetFact: number;
    progress: number;
    start: Date;
    end: Date;
}
export interface EVMResult {
    BAC: number;
    PV: number;
    EV: number;
    AC: number;
    CV: number;
    SV: number;
    CPI: number;
    SPI: number;
    EAC: number;
    ETC: number;
    VAC: number;
    TCPI: number | null;
    TCPI_EAC: number | null;
}
export interface TaskEVMInput {
    id: string;
    title: string;
    estimatedCost?: number | null;
    actualCost?: number | null;
    percentComplete?: number | null;
    startDate?: Date | null;
    dueDate?: Date | null;
}
export interface TaskEVMResult {
    taskId: string;
    title: string;
    BAC: number;
    PV: number;
    EV: number;
    AC: number;
    CV: number;
    SV: number;
    CPI: number;
    SPI: number;
    EAC: number;
    ETC: number;
    VAC: number;
    TCPI: number | null;
    TCPI_EAC: number | null;
    percentComplete: number;
    plannedPercent: number;
}
//# sourceMappingURL=types.d.ts.map
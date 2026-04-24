import { EVMResult, Project, TaskEVMInput, TaskEVMResult } from "./types";
export declare function calculateEVM(project: Project, currentDate: Date): EVMResult;
export declare function calculateTaskEVM(task: TaskEVMInput, currentDate: Date): TaskEVMResult;
export declare function calculateEVMFromValues(input: {
    BAC: number;
    PV: number;
    EV: number;
    AC: number;
}): EVMResult;
//# sourceMappingURL=calculator.d.ts.map
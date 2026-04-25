export type GoalStatus = 'active' | 'done' | 'cancelled';
export interface Goal {
    id: string;
    description: string;
    status: GoalStatus;
    createdAt: string;
    updatedAt: string;
}
export declare class GoalStore {
    private filePath;
    constructor(dir?: string);
    private readAll;
    private writeAll;
    create(description: string): Goal;
    list(status?: GoalStatus): Goal[];
    get(id: string): Goal | undefined;
    private updateStatus;
    markDone(id: string): Goal | null;
    cancel(id: string): Goal | null;
}
//# sourceMappingURL=goal-store.d.ts.map
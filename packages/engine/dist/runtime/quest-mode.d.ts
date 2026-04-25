export type QuestPhase = 'research' | 'requirements' | 'design' | 'tasks' | 'execute' | 'verify' | 'report' | 'done' | 'failed';
export interface QuestSpec {
    id?: string;
    title: string;
    goal: string;
    context?: string;
    acceptance?: string[];
    constraints?: string[];
    files?: string[];
    budgetUsd?: number;
}
export interface QuestTask {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';
    dependencies: string[];
    result?: {
        summary: string;
        ok: boolean;
        ts: string;
    };
    attempts: number;
}
export interface QuestPlan {
    spec: Required<Omit<QuestSpec, 'context' | 'acceptance' | 'constraints' | 'files' | 'budgetUsd'>> & QuestSpec;
    research: string;
    requirements: string[];
    design: string;
    tasks: QuestTask[];
    phase: QuestPhase;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string;
    metrics: {
        tasksTotal: number;
        tasksDone: number;
        tasksFailed: number;
        costUsd: number;
    };
}
export interface QuestExecutor {
    research?(spec: QuestSpec): Promise<string>;
    requirements?(spec: QuestSpec, research: string): Promise<string[]>;
    design?(spec: QuestSpec, requirements: string[]): Promise<string>;
    tasks?(spec: QuestSpec, design: string): Promise<Array<Pick<QuestTask, 'title' | 'description' | 'dependencies'>>>;
    executeTask?(task: QuestTask, plan: QuestPlan): Promise<{
        ok: boolean;
        summary: string;
        costUsd?: number;
    }>;
    verify?(plan: QuestPlan): Promise<{
        ok: boolean;
        report: string;
    }>;
    report?(plan: QuestPlan, verifyReport: string): Promise<string>;
}
export interface QuestRunOptions {
    spec: QuestSpec;
    executor?: QuestExecutor;
    llmFn?: (prompt: string) => Promise<string>;
    storeDir?: string;
    abortSignal?: AbortSignal;
    onProgress?: (plan: QuestPlan) => void;
    maxAttemptsPerTask?: number;
}
export interface QuestResult {
    status: 'completed' | 'failed' | 'aborted';
    plan: QuestPlan;
    reportPath?: string;
}
export declare function defaultExecutor(llmFn?: (p: string) => Promise<string>): Required<QuestExecutor>;
/** Atomically write plan to storeDir/{plan.spec.id}/plan.json. Returns file path. */
export declare function saveQuestPlan(dir: string, plan: QuestPlan): string;
/** Load plan from storeDir/{id}/plan.json. Returns null if not found. */
export declare function loadQuestPlan(dir: string, id: string): QuestPlan | null;
export declare function runQuest(opts: QuestRunOptions): Promise<QuestResult>;
//# sourceMappingURL=quest-mode.d.ts.map
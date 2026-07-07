export interface ManagedGitWorktree {
    id: string;
    branch: string;
    path: string;
    baseBranch: string;
}
export interface RuntimeWorktreeManagerOptions {
    getWorkspacePath(): string;
    rootDir: string;
}
export declare class RuntimeWorktreeManager {
    private readonly getWorkspacePathValue;
    private readonly rootDir;
    constructor(options: RuntimeWorktreeManagerOptions);
    createForRun(runId: string): Promise<ManagedGitWorktree>;
    cleanupForRun(runId: string): Promise<void>;
    cleanupOrphans(retainRunIds?: string[]): Promise<string[]>;
    cleanupAll(): Promise<string[]>;
    describe(runId: string): Pick<ManagedGitWorktree, 'id' | 'branch' | 'path'>;
    private worktreeIdForRun;
    private cleanupWorktree;
}
//# sourceMappingURL=worktree-manager.d.ts.map
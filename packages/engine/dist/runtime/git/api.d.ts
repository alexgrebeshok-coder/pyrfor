/**
 * Git CLI wrapper for the Pyrfor IDE sidecar.
 *
 * Uses node:child_process.execFile (NOT shell exec) — no shell injection risk.
 * All public functions take `workspace: string` as first parameter.
 */
export interface GitStatusResult {
    branch: string;
    ahead: number;
    behind: number;
    files: Array<{
        path: string;
        x: string;
        y: string;
    }>;
}
export interface GitLogEntry {
    sha: string;
    author: string;
    dateUnix: number;
    subject: string;
}
export interface GitRemoteResult {
    name: string;
    url: string;
}
export interface GitBlameEntry {
    sha: string;
    author: string;
    line: number;
    content: string;
}
export interface GitWorktreeRemoveOptions {
    force?: boolean;
    branch?: string;
    prune?: boolean;
}
export declare function validateWorkspace(workspace: string): Promise<void>;
export declare function validateRelPath(p: string): void;
export declare function gitStatus(workspace: string): Promise<GitStatusResult>;
export declare function gitHeadSha(workspace: string): Promise<string>;
export declare function gitRepoRoot(workspace: string): Promise<string>;
export declare function gitCurrentBranch(workspace: string): Promise<string>;
export declare function gitRemote(workspace: string, remote?: string): Promise<GitRemoteResult | null>;
export declare function gitPushHeadToBranch(workspace: string, remote: string, branch: string): Promise<void>;
export declare function gitWorktreeAdd(workspace: string, worktreePath: string, branch: string, ref?: string): Promise<void>;
export declare function gitWorktreePrune(workspace: string): Promise<void>;
export declare function gitWorktreeRemove(workspace: string, worktreePath: string, options?: GitWorktreeRemoveOptions): Promise<void>;
export declare function gitDiff(workspace: string, filePath: string, staged?: boolean): Promise<string>;
export declare function gitFileContent(workspace: string, filePath: string, ref?: string): Promise<string>;
export declare function gitStage(workspace: string, paths: string[]): Promise<void>;
export declare function gitUnstage(workspace: string, paths: string[]): Promise<void>;
export declare function gitCommit(workspace: string, message: string): Promise<{
    sha: string;
}>;
export declare function gitLog(workspace: string, limit?: number): Promise<GitLogEntry[]>;
export declare function gitBlame(workspace: string, filePath: string): Promise<GitBlameEntry[]>;
export type GitMergeOk = {
    ok: true;
    mergeCommitSha?: string;
};
export type GitMergeConflict = {
    ok: false;
    kind: 'conflict';
    conflictPaths: string[];
    stderr?: string;
};
export type GitMergeError = {
    ok: false;
    kind: 'error';
    message: string;
};
export type GitMergeResult = GitMergeOk | GitMergeConflict | GitMergeError;
export type GitCherryPickOk = {
    ok: true;
    headSha?: string;
};
export type GitCherryPickConflict = {
    ok: false;
    kind: 'conflict';
    conflictPaths: string[];
    stderr?: string;
};
export type GitCherryPickError = {
    ok: false;
    kind: 'error';
    message: string;
};
export type GitCherryPickResult = GitCherryPickOk | GitCherryPickConflict | GitCherryPickError;
export declare function gitUnmergedPaths(workspace: string): Promise<string[]>;
export declare function gitMergeAbort(workspace: string): Promise<void>;
export declare function gitCherryPickAbort(workspace: string): Promise<void>;
/**
 * Merge `branch` into the current HEAD of `workspace`.
 * On conflict: records unmerged paths, runs `merge --abort`, and returns `kind: 'conflict'`.
 */
export declare function gitMergeBranch(workspace: string, branch: string, options?: {
    noFf?: boolean;
}): Promise<GitMergeResult>;
/**
 * Cherry-pick one or more commits onto the current HEAD of `workspace`.
 * On conflict: records unmerged paths, runs `cherry-pick --abort`, and returns `kind: 'conflict'`.
 */
export declare function gitCherryPickCommits(workspace: string, commits: string[]): Promise<GitCherryPickResult>;
//# sourceMappingURL=api.d.ts.map
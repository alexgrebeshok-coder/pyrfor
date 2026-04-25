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
export interface GitBlameEntry {
    sha: string;
    author: string;
    line: number;
    content: string;
}
export declare function validateWorkspace(workspace: string): Promise<void>;
export declare function validateRelPath(p: string): void;
export declare function gitStatus(workspace: string): Promise<GitStatusResult>;
export declare function gitDiff(workspace: string, filePath: string, staged?: boolean): Promise<string>;
export declare function gitFileContent(workspace: string, filePath: string, ref?: string): Promise<string>;
export declare function gitStage(workspace: string, paths: string[]): Promise<void>;
export declare function gitUnstage(workspace: string, paths: string[]): Promise<void>;
export declare function gitCommit(workspace: string, message: string): Promise<{
    sha: string;
}>;
export declare function gitLog(workspace: string, limit?: number): Promise<GitLogEntry[]>;
export declare function gitBlame(workspace: string, filePath: string): Promise<GitBlameEntry[]>;
//# sourceMappingURL=api.d.ts.map
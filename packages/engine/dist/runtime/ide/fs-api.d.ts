/**
 * IDE Filesystem API — pure helper module (no HTTP I/O).
 *
 * All operations are restricted to a configured workspaceRoot via:
 *  1. Lexical path resolution (resolve + startsWith check)
 *  2. Symlink dereferencing (fs.realpath)
 *
 * No new runtime dependencies — uses only Node built-ins.
 */
export interface FsApiConfig {
    /** Absolute path to workspace root. All operations are restricted to this root. */
    workspaceRoot: string;
    /** Max file size for read/write (bytes). Default 5_000_000 (5 MB). */
    maxFileSize?: number;
}
export interface FsEntry {
    name: string;
    /** Relative to workspaceRoot, POSIX separators, no leading "/" */
    path: string;
    type: 'file' | 'directory';
    /** Bytes — only for files */
    size?: number;
    /** mtime milliseconds — only for files */
    modifiedMs?: number;
}
export interface FsListResult {
    path: string;
    entries: FsEntry[];
}
export interface FsReadResult {
    path: string;
    content: string;
    size: number;
}
export interface FsSearchHit {
    path: string;
    line: number;
    column: number;
    preview: string;
}
export interface FsSearchResult {
    query: string;
    hits: FsSearchHit[];
    truncated: boolean;
}
export type FsApiErrorCode = 'ENOENT' | 'EACCES' | 'EISDIR' | 'ENOTDIR' | 'E2BIG' | 'EINVAL';
export declare class FsApiError extends Error {
    readonly code: FsApiErrorCode;
    constructor(code: FsApiErrorCode, message: string);
}
/** Directories that are always skipped during listing and search. */
export declare const EXCLUDED_DIRS: Set<string>;
export declare function listDir(cfg: FsApiConfig, relPath: string): Promise<FsListResult>;
export declare function readFile(cfg: FsApiConfig, relPath: string): Promise<FsReadResult>;
export declare function writeFile(cfg: FsApiConfig, relPath: string, content: string): Promise<{
    path: string;
    size: number;
}>;
/** Pure Node content search — no shell-out to ripgrep. */
export declare function searchFiles(cfg: FsApiConfig, query: string, opts?: {
    maxHits?: number;
    relPath?: string;
}): Promise<FsSearchResult>;
//# sourceMappingURL=fs-api.d.ts.map
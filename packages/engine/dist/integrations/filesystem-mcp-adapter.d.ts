/**
 * filesystem-mcp-adapter.ts — Filesystem MCP adapter for Pyrfor Engine.
 *
 * A typed facade over an MCP filesystem server that maps high-level file
 * operations (readFile, writeFile, listDir, stat, move, delete, mkdir) to
 * underlying MCP tool calls via a structural `McpToolClientLike` interface.
 *
 * Design notes:
 *  - Does NOT access the filesystem directly; caller provides `McpToolClientLike`.
 *  - All public methods forward an optional AbortSignal to `callTool`.
 *  - On failure, the original error is wrapped in `FilesystemAdapterError` with
 *    `action` and `cause` fields for structured error handling.
 *  - If a `sandboxRoot` is configured, every input path is validated before the
 *    tool is called; violations throw `SandboxViolationError` immediately.
 *  - If a ledger is provided, an `fs_action` event is emitted after every
 *    operation (success or failure) with `ok`, `action`, `durationMs`, and path info.
 */
export interface McpToolClientLike {
    callTool(name: string, args: Record<string, unknown>, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<unknown>;
}
export interface FilesystemAdapterOptions {
    client: McpToolClientLike;
    /** Prefix prepended to every tool name. Default: `'fs_'`. */
    toolPrefix?: string;
    /** Default timeout for every `callTool` invocation. Default: `10000`. */
    defaultTimeoutMs?: number;
    /** Optional ledger to emit `fs_action` audit events. */
    ledger?: {
        append(e: {
            kind: string;
            data: Record<string, unknown>;
        }): Promise<void> | void;
    };
    /**
     * Optional sandbox root — every input path must be inside this absolute path;
     * otherwise throws `SandboxViolationError` BEFORE calling the tool.
     */
    sandboxRoot?: string;
}
export interface ReadFileResult {
    path: string;
    content: string;
    encoding: 'utf8' | 'base64';
    bytes: number;
}
export interface WriteFileResult {
    path: string;
    bytesWritten: number;
    created: boolean;
}
export interface ListDirResult {
    path: string;
    entries: Array<{
        name: string;
        kind: 'file' | 'dir' | 'symlink' | 'other';
        size?: number;
    }>;
}
export interface StatResult {
    path: string;
    kind: 'file' | 'dir' | 'symlink' | 'other';
    size: number;
    mtimeMs: number;
}
export interface MoveResult {
    from: string;
    to: string;
}
export interface DeleteResult {
    path: string;
    deleted: boolean;
}
export interface MkdirResult {
    path: string;
    created: boolean;
}
export declare class FilesystemAdapterError extends Error {
    readonly action: string;
    readonly cause: unknown;
    constructor(action: string, message: string, cause?: unknown);
}
export declare class SandboxViolationError extends FilesystemAdapterError {
    constructor(action: string, violatingPath: string);
}
/**
 * Build a full MCP tool name from a prefix and action.
 * e.g. buildToolName('fs_', 'readFile') → 'fs_readFile'
 */
export declare function buildToolName(prefix: string, action: string): string;
/**
 * Check whether `filePath` is inside `root` (or equal to it).
 * Returns `true` if `root` is `undefined` (no sandbox configured).
 * Uses path normalization to avoid prefix-match false positives like
 * `/foo/barbaz` matching `/foo/bar`.
 */
export declare function isInsideSandbox(filePath: string, root: string | undefined): boolean;
/**
 * Parse raw MCP response into a `ReadFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseReadFile(raw: unknown): ReadFileResult;
/**
 * Parse raw MCP response into a `WriteFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseWriteFile(raw: unknown): WriteFileResult;
/**
 * Parse raw MCP response into a `ListDirResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseListDir(raw: unknown): ListDirResult;
/**
 * Parse raw MCP response into a `StatResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export declare function parseStat(raw: unknown): StatResult;
/**
 * High-level filesystem adapter that maps typed file operations to MCP tool calls.
 *
 * Usage:
 * ```ts
 * const adapter = new FilesystemMcpAdapter({ client: myMcpClient, sandboxRoot: '/workspace' });
 * const file = await adapter.readFile('/workspace/hello.txt');
 * const dir  = await adapter.listDir('/workspace');
 * await adapter.writeFile('/workspace/out.txt', 'hello');
 * ```
 */
export declare class FilesystemMcpAdapter {
    private readonly _client;
    private readonly _prefix;
    private readonly _defaultTimeoutMs;
    private readonly _ledger;
    private readonly _sandboxRoot;
    constructor(opts: FilesystemAdapterOptions);
    /**
     * Validate a path against the sandbox root. Emits a ledger event and throws
     * `SandboxViolationError` when the path escapes the sandbox.
     */
    private _checkSandbox;
    /**
     * Call the MCP tool, parse the result, wrap errors in `FilesystemAdapterError`,
     * and emit a ledger event (success or failure).
     */
    private _call;
    /**
     * Read the contents of a file at `path`.
     */
    readFile(filePath: string, opts?: {
        encoding?: 'utf8' | 'base64';
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ReadFileResult>;
    /**
     * Write `content` to the file at `path`.
     */
    writeFile(filePath: string, content: string, opts?: {
        encoding?: 'utf8' | 'base64';
        createParents?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<WriteFileResult>;
    /**
     * List entries in a directory at `path`.
     */
    listDir(filePath: string, opts?: {
        recursive?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<ListDirResult>;
    /**
     * Retrieve metadata for the file or directory at `path`.
     */
    stat(filePath: string, opts?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<StatResult>;
    /**
     * Move (rename) a file or directory from `from` to `to`.
     * Both `from` and `to` are validated against the sandbox root.
     */
    move(from: string, to: string, opts?: {
        overwrite?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MoveResult>;
    /**
     * Delete the file or directory at `path`.
     */
    delete(filePath: string, opts?: {
        recursive?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<DeleteResult>;
    /**
     * Create a directory at `path`.
     */
    mkdir(filePath: string, opts?: {
        recursive?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MkdirResult>;
}
//# sourceMappingURL=filesystem-mcp-adapter.d.ts.map
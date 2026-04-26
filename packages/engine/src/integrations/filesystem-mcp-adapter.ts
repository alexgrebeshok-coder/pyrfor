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

import path from 'path';

// ====== McpToolClientLike — structural interface ==============================

export interface McpToolClientLike {
  callTool(
    name: string,
    args: Record<string, unknown>,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<unknown>;
}

// ====== FilesystemAdapterOptions =============================================

export interface FilesystemAdapterOptions {
  client: McpToolClientLike;
  /** Prefix prepended to every tool name. Default: `'fs_'`. */
  toolPrefix?: string;
  /** Default timeout for every `callTool` invocation. Default: `10000`. */
  defaultTimeoutMs?: number;
  /** Optional ledger to emit `fs_action` audit events. */
  ledger?: {
    append(e: { kind: string; data: Record<string, unknown> }): Promise<void> | void;
  };
  /**
   * Optional sandbox root — every input path must be inside this absolute path;
   * otherwise throws `SandboxViolationError` BEFORE calling the tool.
   */
  sandboxRoot?: string;
}

// ====== Result types =========================================================

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
  entries: Array<{ name: string; kind: 'file' | 'dir' | 'symlink' | 'other'; size?: number }>;
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

// ====== FilesystemAdapterError ===============================================

export class FilesystemAdapterError extends Error {
  readonly action: string;
  readonly cause: unknown;

  constructor(action: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'FilesystemAdapterError';
    this.action = action;
    this.cause = cause;
  }
}

export class SandboxViolationError extends FilesystemAdapterError {
  constructor(action: string, violatingPath: string) {
    super(
      action,
      `FilesystemAdapter [${action}]: path "${violatingPath}" is outside the sandbox root`,
    );
    this.name = 'SandboxViolationError';
  }
}

// ====== Pure helpers =========================================================

/**
 * Build a full MCP tool name from a prefix and action.
 * e.g. buildToolName('fs_', 'readFile') → 'fs_readFile'
 */
export function buildToolName(prefix: string, action: string): string {
  return `${prefix}${action}`;
}

/**
 * Check whether `filePath` is inside `root` (or equal to it).
 * Returns `true` if `root` is `undefined` (no sandbox configured).
 * Uses path normalization to avoid prefix-match false positives like
 * `/foo/barbaz` matching `/foo/bar`.
 */
export function isInsideSandbox(filePath: string, root: string | undefined): boolean {
  if (root === undefined) return true;
  const normalizedPath = path.normalize(filePath);
  // Strip trailing separator so '/foo/bar/' and '/foo/bar' are treated identically.
  const raw = path.normalize(root);
  const normalizedRoot = raw.endsWith(path.sep) ? raw.slice(0, -path.sep.length) : raw;
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(normalizedRoot + path.sep)
  );
}

/**
 * Parse raw MCP response into a `ReadFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseReadFile(raw: unknown): ReadFileResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseReadFile: response is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['path'] !== 'string') {
    throw new Error('parseReadFile: missing or invalid "path" field');
  }
  if (typeof r['content'] !== 'string') {
    throw new Error('parseReadFile: missing or invalid "content" field');
  }
  const encoding: 'utf8' | 'base64' = r['encoding'] === 'base64' ? 'base64' : 'utf8';
  const bytes = typeof r['bytes'] === 'number' ? r['bytes'] : (r['content'] as string).length;
  return { path: r['path'], content: r['content'], encoding, bytes };
}

/**
 * Parse raw MCP response into a `WriteFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseWriteFile(raw: unknown): WriteFileResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseWriteFile: response is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['path'] !== 'string') {
    throw new Error('parseWriteFile: missing or invalid "path" field');
  }
  if (typeof r['bytesWritten'] !== 'number') {
    throw new Error('parseWriteFile: missing or invalid "bytesWritten" field');
  }
  const created = typeof r['created'] === 'boolean' ? r['created'] : false;
  return { path: r['path'], bytesWritten: r['bytesWritten'], created };
}

/**
 * Parse raw MCP response into a `ListDirResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseListDir(raw: unknown): ListDirResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseListDir: response is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['path'] !== 'string') {
    throw new Error('parseListDir: missing or invalid "path" field');
  }
  if (!Array.isArray(r['entries'])) {
    throw new Error('parseListDir: missing or invalid "entries" field');
  }
  const validKinds = new Set(['file', 'dir', 'symlink', 'other']);
  const entries = (r['entries'] as unknown[]).map((e, i) => {
    if (e === null || typeof e !== 'object') {
      throw new Error(`parseListDir: entries[${i}] is not an object`);
    }
    const entry = e as Record<string, unknown>;
    if (typeof entry['name'] !== 'string') {
      throw new Error(`parseListDir: entries[${i}].name is missing or invalid`);
    }
    if (!validKinds.has(entry['kind'] as string)) {
      throw new Error(`parseListDir: entries[${i}].kind is missing or invalid`);
    }
    return {
      name: entry['name'] as string,
      kind: entry['kind'] as 'file' | 'dir' | 'symlink' | 'other',
      size: typeof entry['size'] === 'number' ? entry['size'] : undefined,
    };
  });
  return { path: r['path'], entries };
}

/**
 * Parse raw MCP response into a `StatResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseStat(raw: unknown): StatResult {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('parseStat: response is not an object');
  }
  const r = raw as Record<string, unknown>;
  if (typeof r['path'] !== 'string') {
    throw new Error('parseStat: missing or invalid "path" field');
  }
  const validKinds = new Set(['file', 'dir', 'symlink', 'other']);
  if (!validKinds.has(r['kind'] as string)) {
    throw new Error('parseStat: missing or invalid "kind" field');
  }
  if (typeof r['size'] !== 'number') {
    throw new Error('parseStat: missing or invalid "size" field');
  }
  if (typeof r['mtimeMs'] !== 'number') {
    throw new Error('parseStat: missing or invalid "mtimeMs" field');
  }
  return {
    path: r['path'],
    kind: r['kind'] as 'file' | 'dir' | 'symlink' | 'other',
    size: r['size'],
    mtimeMs: r['mtimeMs'],
  };
}

// ====== Internal helpers =====================================================

/** Emit a ledger event if a ledger is configured; never throws. */
async function emitFsLedger(
  ledger: FilesystemAdapterOptions['ledger'],
  data: Record<string, unknown>,
): Promise<void> {
  if (!ledger) return;
  try {
    await ledger.append({ kind: 'fs_action', data });
  } catch {
    // Ledger failures must never propagate to callers.
  }
}

// ====== FilesystemMcpAdapter =================================================

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
export class FilesystemMcpAdapter {
  // ── Private state ──────────────────────────────────────────────────────────
  private readonly _client: McpToolClientLike;
  private readonly _prefix: string;
  private readonly _defaultTimeoutMs: number;
  private readonly _ledger: FilesystemAdapterOptions['ledger'];
  private readonly _sandboxRoot: string | undefined;

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(opts: FilesystemAdapterOptions) {
    this._client = opts.client;
    this._prefix = opts.toolPrefix ?? 'fs_';
    this._defaultTimeoutMs = opts.defaultTimeoutMs ?? 10_000;
    this._ledger = opts.ledger;
    this._sandboxRoot = opts.sandboxRoot;
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  /**
   * Validate a path against the sandbox root. Emits a ledger event and throws
   * `SandboxViolationError` when the path escapes the sandbox.
   */
  private async _checkSandbox(action: string, filePath: string): Promise<void> {
    if (!isInsideSandbox(filePath, this._sandboxRoot)) {
      await emitFsLedger(this._ledger, {
        action,
        ok: false,
        reason: 'sandbox_violation',
        path: filePath,
      });
      throw new SandboxViolationError(action, filePath);
    }
  }

  /**
   * Call the MCP tool, parse the result, wrap errors in `FilesystemAdapterError`,
   * and emit a ledger event (success or failure).
   */
  private async _call<T>(
    action: string,
    args: Record<string, unknown>,
    parse: (raw: unknown) => T,
    pathInfo: Record<string, string>,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<T> {
    const toolName = buildToolName(this._prefix, action);
    const timeoutMs = opts?.timeoutMs ?? this._defaultTimeoutMs;
    const start = Date.now();

    let raw: unknown;
    try {
      raw = await this._client.callTool(toolName, args, { timeoutMs, signal: opts?.signal });
    } catch (err) {
      const durationMs = Date.now() - start;
      await emitFsLedger(this._ledger, { action, ok: false, durationMs, ...pathInfo });
      throw new FilesystemAdapterError(
        action,
        `FilesystemAdapter [${action}]: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    let result: T;
    try {
      result = parse(raw);
    } catch (err) {
      const durationMs = Date.now() - start;
      await emitFsLedger(this._ledger, { action, ok: false, durationMs, ...pathInfo });
      throw new FilesystemAdapterError(
        action,
        `FilesystemAdapter [${action}]: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    const durationMs = Date.now() - start;
    await emitFsLedger(this._ledger, { action, ok: true, durationMs, ...pathInfo });
    return result;
  }

  // ── readFile ───────────────────────────────────────────────────────────────

  /**
   * Read the contents of a file at `path`.
   */
  async readFile(
    filePath: string,
    opts?: { encoding?: 'utf8' | 'base64'; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ReadFileResult> {
    await this._checkSandbox('readFile', filePath);
    const args: Record<string, unknown> = { path: filePath };
    if (opts?.encoding !== undefined) args['encoding'] = opts.encoding;
    return this._call('readFile', args, parseReadFile, { path: filePath }, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── writeFile ──────────────────────────────────────────────────────────────

  /**
   * Write `content` to the file at `path`.
   */
  async writeFile(
    filePath: string,
    content: string,
    opts?: {
      encoding?: 'utf8' | 'base64';
      createParents?: boolean;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<WriteFileResult> {
    await this._checkSandbox('writeFile', filePath);
    const args: Record<string, unknown> = { path: filePath, content };
    if (opts?.encoding !== undefined) args['encoding'] = opts.encoding;
    if (opts?.createParents !== undefined) args['createParents'] = opts.createParents;
    return this._call('writeFile', args, parseWriteFile, { path: filePath }, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── listDir ────────────────────────────────────────────────────────────────

  /**
   * List entries in a directory at `path`.
   */
  async listDir(
    filePath: string,
    opts?: { recursive?: boolean; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<ListDirResult> {
    await this._checkSandbox('listDir', filePath);
    const args: Record<string, unknown> = { path: filePath };
    if (opts?.recursive !== undefined) args['recursive'] = opts.recursive;
    return this._call('listDir', args, parseListDir, { path: filePath }, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── stat ───────────────────────────────────────────────────────────────────

  /**
   * Retrieve metadata for the file or directory at `path`.
   */
  async stat(
    filePath: string,
    opts?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<StatResult> {
    await this._checkSandbox('stat', filePath);
    const args: Record<string, unknown> = { path: filePath };
    return this._call('stat', args, parseStat, { path: filePath }, {
      timeoutMs: opts?.timeoutMs,
      signal: opts?.signal,
    });
  }

  // ── move ───────────────────────────────────────────────────────────────────

  /**
   * Move (rename) a file or directory from `from` to `to`.
   * Both `from` and `to` are validated against the sandbox root.
   */
  async move(
    from: string,
    to: string,
    opts?: { overwrite?: boolean; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<MoveResult> {
    await this._checkSandbox('move', from);
    await this._checkSandbox('move', to);
    const args: Record<string, unknown> = { from, to };
    if (opts?.overwrite !== undefined) args['overwrite'] = opts.overwrite;
    return this._call(
      'move',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          from: typeof r?.['from'] === 'string' ? r['from'] : from,
          to: typeof r?.['to'] === 'string' ? r['to'] : to,
        };
      },
      { from, to },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── delete ─────────────────────────────────────────────────────────────────

  /**
   * Delete the file or directory at `path`.
   */
  async delete(
    filePath: string,
    opts?: { recursive?: boolean; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<DeleteResult> {
    await this._checkSandbox('delete', filePath);
    const args: Record<string, unknown> = { path: filePath };
    if (opts?.recursive !== undefined) args['recursive'] = opts.recursive;
    return this._call(
      'delete',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          path: filePath,
          deleted: typeof r?.['deleted'] === 'boolean' ? r['deleted'] : true,
        };
      },
      { path: filePath },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }

  // ── mkdir ──────────────────────────────────────────────────────────────────

  /**
   * Create a directory at `path`.
   */
  async mkdir(
    filePath: string,
    opts?: { recursive?: boolean; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<MkdirResult> {
    await this._checkSandbox('mkdir', filePath);
    const args: Record<string, unknown> = { path: filePath };
    if (opts?.recursive !== undefined) args['recursive'] = opts.recursive;
    return this._call(
      'mkdir',
      args,
      (raw) => {
        const r = raw as Record<string, unknown>;
        return {
          path: filePath,
          created: typeof r?.['created'] === 'boolean' ? r['created'] : true,
        };
      },
      { path: filePath },
      { timeoutMs: opts?.timeoutMs, signal: opts?.signal },
    );
  }
}

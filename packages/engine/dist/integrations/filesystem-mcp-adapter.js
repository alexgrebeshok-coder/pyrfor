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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import path from 'path';
// ====== FilesystemAdapterError ===============================================
export class FilesystemAdapterError extends Error {
    constructor(action, message, cause) {
        super(message);
        this.name = 'FilesystemAdapterError';
        this.action = action;
        this.cause = cause;
    }
}
export class SandboxViolationError extends FilesystemAdapterError {
    constructor(action, violatingPath) {
        super(action, `FilesystemAdapter [${action}]: path "${violatingPath}" is outside the sandbox root`);
        this.name = 'SandboxViolationError';
    }
}
// ====== Pure helpers =========================================================
/**
 * Build a full MCP tool name from a prefix and action.
 * e.g. buildToolName('fs_', 'readFile') → 'fs_readFile'
 */
export function buildToolName(prefix, action) {
    return `${prefix}${action}`;
}
/**
 * Check whether `filePath` is inside `root` (or equal to it).
 * Returns `true` if `root` is `undefined` (no sandbox configured).
 * Uses path normalization to avoid prefix-match false positives like
 * `/foo/barbaz` matching `/foo/bar`.
 */
export function isInsideSandbox(filePath, root) {
    if (root === undefined)
        return true;
    const normalizedPath = path.normalize(filePath);
    // Strip trailing separator so '/foo/bar/' and '/foo/bar' are treated identically.
    const raw = path.normalize(root);
    const normalizedRoot = raw.endsWith(path.sep) ? raw.slice(0, -path.sep.length) : raw;
    return (normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(normalizedRoot + path.sep));
}
/**
 * Parse raw MCP response into a `ReadFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseReadFile(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseReadFile: response is not an object');
    }
    const r = raw;
    if (typeof r['path'] !== 'string') {
        throw new Error('parseReadFile: missing or invalid "path" field');
    }
    if (typeof r['content'] !== 'string') {
        throw new Error('parseReadFile: missing or invalid "content" field');
    }
    const encoding = r['encoding'] === 'base64' ? 'base64' : 'utf8';
    const bytes = typeof r['bytes'] === 'number' ? r['bytes'] : r['content'].length;
    return { path: r['path'], content: r['content'], encoding, bytes };
}
/**
 * Parse raw MCP response into a `WriteFileResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseWriteFile(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseWriteFile: response is not an object');
    }
    const r = raw;
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
export function parseListDir(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseListDir: response is not an object');
    }
    const r = raw;
    if (typeof r['path'] !== 'string') {
        throw new Error('parseListDir: missing or invalid "path" field');
    }
    if (!Array.isArray(r['entries'])) {
        throw new Error('parseListDir: missing or invalid "entries" field');
    }
    const validKinds = new Set(['file', 'dir', 'symlink', 'other']);
    const entries = r['entries'].map((e, i) => {
        if (e === null || typeof e !== 'object') {
            throw new Error(`parseListDir: entries[${i}] is not an object`);
        }
        const entry = e;
        if (typeof entry['name'] !== 'string') {
            throw new Error(`parseListDir: entries[${i}].name is missing or invalid`);
        }
        if (!validKinds.has(entry['kind'])) {
            throw new Error(`parseListDir: entries[${i}].kind is missing or invalid`);
        }
        return {
            name: entry['name'],
            kind: entry['kind'],
            size: typeof entry['size'] === 'number' ? entry['size'] : undefined,
        };
    });
    return { path: r['path'], entries };
}
/**
 * Parse raw MCP response into a `StatResult`.
 * Throws a descriptive error if required fields are missing or invalid.
 */
export function parseStat(raw) {
    if (raw === null || typeof raw !== 'object') {
        throw new Error('parseStat: response is not an object');
    }
    const r = raw;
    if (typeof r['path'] !== 'string') {
        throw new Error('parseStat: missing or invalid "path" field');
    }
    const validKinds = new Set(['file', 'dir', 'symlink', 'other']);
    if (!validKinds.has(r['kind'])) {
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
        kind: r['kind'],
        size: r['size'],
        mtimeMs: r['mtimeMs'],
    };
}
// ====== Internal helpers =====================================================
/** Emit a ledger event if a ledger is configured; never throws. */
function emitFsLedger(ledger, data) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!ledger)
            return;
        try {
            yield ledger.append({ kind: 'fs_action', data });
        }
        catch (_a) {
            // Ledger failures must never propagate to callers.
        }
    });
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
    // ── Constructor ────────────────────────────────────────────────────────────
    constructor(opts) {
        var _a, _b;
        this._client = opts.client;
        this._prefix = (_a = opts.toolPrefix) !== null && _a !== void 0 ? _a : 'fs_';
        this._defaultTimeoutMs = (_b = opts.defaultTimeoutMs) !== null && _b !== void 0 ? _b : 10000;
        this._ledger = opts.ledger;
        this._sandboxRoot = opts.sandboxRoot;
    }
    // ── Internal helpers ───────────────────────────────────────────────────────
    /**
     * Validate a path against the sandbox root. Emits a ledger event and throws
     * `SandboxViolationError` when the path escapes the sandbox.
     */
    _checkSandbox(action, filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!isInsideSandbox(filePath, this._sandboxRoot)) {
                yield emitFsLedger(this._ledger, {
                    action,
                    ok: false,
                    reason: 'sandbox_violation',
                    path: filePath,
                });
                throw new SandboxViolationError(action, filePath);
            }
        });
    }
    /**
     * Call the MCP tool, parse the result, wrap errors in `FilesystemAdapterError`,
     * and emit a ledger event (success or failure).
     */
    _call(action, args, parse, pathInfo, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const toolName = buildToolName(this._prefix, action);
            const timeoutMs = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : this._defaultTimeoutMs;
            const start = Date.now();
            let raw;
            try {
                raw = yield this._client.callTool(toolName, args, { timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
            }
            catch (err) {
                const durationMs = Date.now() - start;
                yield emitFsLedger(this._ledger, Object.assign({ action, ok: false, durationMs }, pathInfo));
                throw new FilesystemAdapterError(action, `FilesystemAdapter [${action}]: ${err instanceof Error ? err.message : String(err)}`, err);
            }
            let result;
            try {
                result = parse(raw);
            }
            catch (err) {
                const durationMs = Date.now() - start;
                yield emitFsLedger(this._ledger, Object.assign({ action, ok: false, durationMs }, pathInfo));
                throw new FilesystemAdapterError(action, `FilesystemAdapter [${action}]: ${err instanceof Error ? err.message : String(err)}`, err);
            }
            const durationMs = Date.now() - start;
            yield emitFsLedger(this._ledger, Object.assign({ action, ok: true, durationMs }, pathInfo));
            return result;
        });
    }
    // ── readFile ───────────────────────────────────────────────────────────────
    /**
     * Read the contents of a file at `path`.
     */
    readFile(filePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('readFile', filePath);
            const args = { path: filePath };
            if ((opts === null || opts === void 0 ? void 0 : opts.encoding) !== undefined)
                args['encoding'] = opts.encoding;
            return this._call('readFile', args, parseReadFile, { path: filePath }, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── writeFile ──────────────────────────────────────────────────────────────
    /**
     * Write `content` to the file at `path`.
     */
    writeFile(filePath, content, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('writeFile', filePath);
            const args = { path: filePath, content };
            if ((opts === null || opts === void 0 ? void 0 : opts.encoding) !== undefined)
                args['encoding'] = opts.encoding;
            if ((opts === null || opts === void 0 ? void 0 : opts.createParents) !== undefined)
                args['createParents'] = opts.createParents;
            return this._call('writeFile', args, parseWriteFile, { path: filePath }, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── listDir ────────────────────────────────────────────────────────────────
    /**
     * List entries in a directory at `path`.
     */
    listDir(filePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('listDir', filePath);
            const args = { path: filePath };
            if ((opts === null || opts === void 0 ? void 0 : opts.recursive) !== undefined)
                args['recursive'] = opts.recursive;
            return this._call('listDir', args, parseListDir, { path: filePath }, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── stat ───────────────────────────────────────────────────────────────────
    /**
     * Retrieve metadata for the file or directory at `path`.
     */
    stat(filePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('stat', filePath);
            const args = { path: filePath };
            return this._call('stat', args, parseStat, { path: filePath }, {
                timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs,
                signal: opts === null || opts === void 0 ? void 0 : opts.signal,
            });
        });
    }
    // ── move ───────────────────────────────────────────────────────────────────
    /**
     * Move (rename) a file or directory from `from` to `to`.
     * Both `from` and `to` are validated against the sandbox root.
     */
    move(from, to, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('move', from);
            yield this._checkSandbox('move', to);
            const args = { from, to };
            if ((opts === null || opts === void 0 ? void 0 : opts.overwrite) !== undefined)
                args['overwrite'] = opts.overwrite;
            return this._call('move', args, (raw) => {
                const r = raw;
                return {
                    from: typeof (r === null || r === void 0 ? void 0 : r['from']) === 'string' ? r['from'] : from,
                    to: typeof (r === null || r === void 0 ? void 0 : r['to']) === 'string' ? r['to'] : to,
                };
            }, { from, to }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── delete ─────────────────────────────────────────────────────────────────
    /**
     * Delete the file or directory at `path`.
     */
    delete(filePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('delete', filePath);
            const args = { path: filePath };
            if ((opts === null || opts === void 0 ? void 0 : opts.recursive) !== undefined)
                args['recursive'] = opts.recursive;
            return this._call('delete', args, (raw) => {
                const r = raw;
                return {
                    path: filePath,
                    deleted: typeof (r === null || r === void 0 ? void 0 : r['deleted']) === 'boolean' ? r['deleted'] : true,
                };
            }, { path: filePath }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
    // ── mkdir ──────────────────────────────────────────────────────────────────
    /**
     * Create a directory at `path`.
     */
    mkdir(filePath, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this._checkSandbox('mkdir', filePath);
            const args = { path: filePath };
            if ((opts === null || opts === void 0 ? void 0 : opts.recursive) !== undefined)
                args['recursive'] = opts.recursive;
            return this._call('mkdir', args, (raw) => {
                const r = raw;
                return {
                    path: filePath,
                    created: typeof (r === null || r === void 0 ? void 0 : r['created']) === 'boolean' ? r['created'] : true,
                };
            }, { path: filePath }, { timeoutMs: opts === null || opts === void 0 ? void 0 : opts.timeoutMs, signal: opts === null || opts === void 0 ? void 0 : opts.signal });
        });
    }
}

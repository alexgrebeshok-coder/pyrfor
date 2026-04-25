/**
 * IDE Filesystem API — pure helper module (no HTTP I/O).
 *
 * All operations are restricted to a configured workspaceRoot via:
 *  1. Lexical path resolution (resolve + startsWith check)
 *  2. Symlink dereferencing (fs.realpath)
 *
 * No new runtime dependencies — uses only Node built-ins.
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
import { promises as fsp } from 'fs';
import path from 'path';
export class FsApiError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'FsApiError';
    }
}
// ─── Constants ─────────────────────────────────────────────────────────────
/** Directories that are always skipped during listing and search. */
export const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'dist-cjs',
    '.next',
    '.cache',
    'coverage',
    '__pycache__',
]);
const DEFAULT_MAX_FILE_SIZE = 5000000;
const DEFAULT_MAX_HITS = 200;
/** First N bytes checked for NULL to detect binary files. */
const BINARY_SNIFF_BYTES = 1024;
// ─── Internal helpers ──────────────────────────────────────────────────────
function resolvedRoot(cfg) {
    return path.resolve(cfg.workspaceRoot);
}
/** Resolve the workspace root's real path (dereferencing symlinks on macOS /var → /private/var). */
function realRoot(cfg) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield fsp.realpath(path.resolve(cfg.workspaceRoot));
        }
        catch (_a) {
            // If root doesn't exist yet (e.g., writeFile will create it), fall back to lexical resolution
            return path.resolve(cfg.workspaceRoot);
        }
    });
}
/**
 * Resolve a relative path to an absolute path inside workspaceRoot.
 * Throws FsApiError('EACCES') for traversal attempts, absolute inputs, or
 * paths starting with '/'.
 * Empty/blank relPath resolves to workspaceRoot itself.
 */
function resolveInsideRoot(cfg, relPath) {
    const root = resolvedRoot(cfg);
    // Reject absolute paths immediately
    if (relPath.startsWith('/') || path.isAbsolute(relPath)) {
        throw new FsApiError('EACCES', `Absolute paths are not allowed: ${relPath}`);
    }
    const normalised = relPath.trim();
    const resolved = normalised === '' ? root : path.resolve(root, normalised);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new FsApiError('EACCES', `Path traversal detected: ${relPath}`);
    }
    return resolved;
}
/**
 * Dereference symlinks and verify the real path is still inside the workspace.
 * Uses realpath on the workspace root too so macOS /var → /private/var is handled.
 */
function realpathInsideRoot(cfg, absPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const root = yield realRoot(cfg);
        let real;
        try {
            real = yield fsp.realpath(absPath);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT')
                throw new FsApiError('ENOENT', `No such file or directory: ${absPath}`);
            throw err;
        }
        if (real !== root && !real.startsWith(root + path.sep)) {
            throw new FsApiError('EACCES', `Symlink points outside workspace: ${absPath}`);
        }
        return real;
    });
}
/** Convert an absolute real path back to a POSIX-style relative path. */
function toRelPath(realRootPath, absPath) {
    const rel = path.relative(realRootPath, absPath);
    // Use forward slashes on all platforms
    return rel.split(path.sep).join('/');
}
function maxFileSize(cfg) {
    var _a;
    return (_a = cfg.maxFileSize) !== null && _a !== void 0 ? _a : DEFAULT_MAX_FILE_SIZE;
}
// ─── listDir ───────────────────────────────────────────────────────────────
export function listDir(cfg, relPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const absPath = resolveInsideRoot(cfg, relPath);
        const realPath = yield realpathInsideRoot(cfg, absPath);
        const root = yield realRoot(cfg);
        let stat;
        try {
            stat = yield fsp.stat(realPath);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT')
                throw new FsApiError('ENOENT', `No such directory: ${relPath}`);
            throw err;
        }
        if (!stat.isDirectory()) {
            throw new FsApiError('ENOTDIR', `Not a directory: ${relPath}`);
        }
        const names = yield fsp.readdir(realPath);
        const entries = [];
        for (const name of names) {
            const childAbs = path.join(realPath, name);
            let childStat = null;
            try {
                childStat = yield fsp.stat(childAbs);
            }
            catch (_a) {
                // skip unreadable entries
                continue;
            }
            const isDir = childStat.isDirectory();
            // Skip excluded directories
            if (isDir && EXCLUDED_DIRS.has(name))
                continue;
            const entry = {
                name,
                path: toRelPath(root, childAbs),
                type: isDir ? 'directory' : 'file',
            };
            if (!isDir) {
                entry.size = childStat.size;
                entry.modifiedMs = childStat.mtimeMs;
            }
            entries.push(entry);
        }
        // Sort: directories first, then files; alphabetically within each group
        entries.sort((a, b) => {
            if (a.type !== b.type)
                return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        return { path: toRelPath(root, realPath) || '.', entries };
    });
}
// ─── readFile ──────────────────────────────────────────────────────────────
export function readFile(cfg, relPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const absPath = resolveInsideRoot(cfg, relPath);
        const realPath = yield realpathInsideRoot(cfg, absPath);
        const root = yield realRoot(cfg);
        let stat;
        try {
            stat = yield fsp.stat(realPath);
        }
        catch (err) {
            const code = err.code;
            if (code === 'ENOENT')
                throw new FsApiError('ENOENT', `No such file: ${relPath}`);
            throw err;
        }
        if (stat.isDirectory()) {
            throw new FsApiError('EISDIR', `Path is a directory: ${relPath}`);
        }
        const limit = maxFileSize(cfg);
        if (stat.size > limit) {
            throw new FsApiError('E2BIG', `File too large: ${stat.size} bytes (limit ${limit})`);
        }
        const content = yield fsp.readFile(realPath, 'utf-8');
        return { path: toRelPath(root, realPath), content, size: stat.size };
    });
}
// ─── writeFile ─────────────────────────────────────────────────────────────
export function writeFile(cfg, relPath, content) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!relPath || relPath.trim() === '') {
            throw new FsApiError('EINVAL', 'relPath must not be empty for writeFile');
        }
        const limit = maxFileSize(cfg);
        const contentBytes = Buffer.byteLength(content, 'utf-8');
        if (contentBytes > limit) {
            throw new FsApiError('E2BIG', `Content too large: ${contentBytes} bytes (limit ${limit})`);
        }
        const absPath = resolveInsideRoot(cfg, relPath);
        // Ensure parent directory exists (inside workspace) — use lexical root for this check
        const parentAbs = path.dirname(absPath);
        const lexRoot = resolvedRoot(cfg);
        if (parentAbs !== lexRoot && !parentAbs.startsWith(lexRoot + path.sep)) {
            throw new FsApiError('EACCES', `Parent directory is outside workspace: ${relPath}`);
        }
        yield fsp.mkdir(parentAbs, { recursive: true });
        yield fsp.writeFile(absPath, content, 'utf-8');
        const stat = yield fsp.stat(absPath);
        // Use realpath on the written file so relative path computation is consistent
        const realFilePath = yield fsp.realpath(absPath);
        const realRootPath = yield realRoot(cfg);
        return { path: toRelPath(realRootPath, realFilePath), size: stat.size };
    });
}
// ─── searchFiles ───────────────────────────────────────────────────────────
/** Pure Node content search — no shell-out to ripgrep. */
export function searchFiles(cfg, query, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!query) {
            throw new FsApiError('EINVAL', 'query must not be empty');
        }
        const maxHits = (_a = opts === null || opts === void 0 ? void 0 : opts.maxHits) !== null && _a !== void 0 ? _a : DEFAULT_MAX_HITS;
        const root = yield realRoot(cfg);
        const searchRoot = (opts === null || opts === void 0 ? void 0 : opts.relPath)
            ? yield (() => __awaiter(this, void 0, void 0, function* () {
                const abs = resolveInsideRoot(cfg, opts.relPath);
                try {
                    return yield fsp.realpath(abs);
                }
                catch (_a) {
                    return abs;
                }
            }))()
            : root;
        // Verify it exists
        try {
            const s = yield fsp.stat(searchRoot);
            if (!s.isDirectory()) {
                throw new FsApiError('ENOTDIR', `Search path is not a directory: ${opts === null || opts === void 0 ? void 0 : opts.relPath}`);
            }
        }
        catch (err) {
            if (err instanceof FsApiError)
                throw err;
            const code = err.code;
            if (code === 'ENOENT')
                throw new FsApiError('ENOENT', `Search path not found: ${opts === null || opts === void 0 ? void 0 : opts.relPath}`);
            throw err;
        }
        const hits = [];
        let truncated = false;
        function walk(dir) {
            return __awaiter(this, void 0, void 0, function* () {
                if (truncated)
                    return;
                let entries;
                try {
                    entries = yield fsp.readdir(dir);
                }
                catch (_a) {
                    return;
                }
                for (const name of entries) {
                    if (truncated)
                        break;
                    const childAbs = path.join(dir, name);
                    let childStat = null;
                    try {
                        childStat = yield fsp.stat(childAbs);
                    }
                    catch (_b) {
                        continue;
                    }
                    if (childStat.isDirectory()) {
                        if (EXCLUDED_DIRS.has(name))
                            continue;
                        yield walk(childAbs);
                    }
                    else if (childStat.isFile()) {
                        if (truncated)
                            break;
                        yield searchInFile(childAbs);
                    }
                }
            });
        }
        function searchInFile(absFile) {
            return __awaiter(this, void 0, void 0, function* () {
                let buf;
                try {
                    buf = yield fsp.readFile(absFile);
                }
                catch (_a) {
                    return; // unreadable — skip
                }
                // Binary heuristic: NULL byte in first BINARY_SNIFF_BYTES bytes
                const sniff = buf.subarray(0, BINARY_SNIFF_BYTES);
                if (sniff.includes(0))
                    return;
                const text = buf.toString('utf-8');
                const lines = text.split('\n');
                const relFile = toRelPath(root, absFile);
                for (let i = 0; i < lines.length; i++) {
                    if (truncated)
                        break;
                    const lineText = lines[i];
                    let col = lineText.indexOf(query);
                    while (col !== -1) {
                        if (hits.length >= maxHits) {
                            truncated = true;
                            return;
                        }
                        hits.push({
                            path: relFile,
                            line: i + 1,
                            column: col + 1,
                            preview: lineText.trimEnd(),
                        });
                        col = lineText.indexOf(query, col + 1);
                        if (truncated)
                            return;
                    }
                }
            });
        }
        yield walk(searchRoot);
        return { query, hits, truncated };
    });
}

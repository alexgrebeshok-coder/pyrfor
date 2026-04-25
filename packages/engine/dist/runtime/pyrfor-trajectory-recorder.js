/**
 * pyrfor-trajectory-recorder.ts
 *
 * JSONL trajectory recorder for FreeClaude (FC) sessions in Pyrfor.
 * Each session gets one append-only JSONL file at <dir>/<sessionId>.jsonl.
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
import * as nodeFsPromises from 'node:fs/promises';
import * as nodePath from 'node:path';
import * as nodeOs from 'node:os';
// ── Helpers ───────────────────────────────────────────────────────────────────
function sanitizeSessionId(id) {
    return id.replace(/[^A-Za-z0-9_.-]/g, '_');
}
// ── Implementation ────────────────────────────────────────────────────────────
export function createTrajectoryRecorder(opts) {
    var _a, _b, _c, _d, _e;
    const dir = (_a = opts === null || opts === void 0 ? void 0 : opts.dir) !== null && _a !== void 0 ? _a : nodePath.join(nodeOs.homedir(), '.pyrfor', 'trajectories');
    const fs = (_b = opts === null || opts === void 0 ? void 0 : opts.fs) !== null && _b !== void 0 ? _b : nodeFsPromises;
    const now = (_c = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _c !== void 0 ? _c : (() => Date.now());
    const autoOpen = (_d = opts === null || opts === void 0 ? void 0 : opts.autoOpen) !== null && _d !== void 0 ? _d : true;
    const gzipOnClose = (_e = opts === null || opts === void 0 ? void 0 : opts.gzipOnClose) !== null && _e !== void 0 ? _e : false;
    // Per-session write chain for serialization
    const chains = new Map();
    // Track which sessions have been explicitly or auto-opened
    const openedSessions = new Set();
    // Track whether mkdir has been done
    let dirReady = null;
    function ensureDir() {
        if (!dirReady) {
            dirReady = fs.mkdir(dir, { recursive: true });
        }
        return dirReady;
    }
    function pathFor(sessionId) {
        return nodePath.join(dir, `${sanitizeSessionId(sessionId)}.jsonl`);
    }
    function enqueue(sessionId, work) {
        var _a;
        const prev = (_a = chains.get(sessionId)) !== null && _a !== void 0 ? _a : Promise.resolve();
        const next = prev.then(() => work(), () => work());
        chains.set(sessionId, next);
        return next;
    }
    function writeRecord(sessionId, record) {
        return __awaiter(this, void 0, void 0, function* () {
            yield ensureDir();
            const line = JSON.stringify(record) + '\n';
            yield fs.appendFile(pathFor(sessionId), line);
        });
    }
    function ensureOpen(sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (openedSessions.has(sessionId))
                return;
            if (!autoOpen) {
                throw new Error(`Session "${sessionId}" has not been opened. Call openSession() first or enable autoOpen.`);
            }
            // Auto-open: emit session_open with minimal meta
            openedSessions.add(sessionId);
            const record = {
                kind: 'session_open',
                sessionId: sanitizeSessionId(sessionId),
                startedAt: now(),
            };
            yield writeRecord(sessionId, record);
        });
    }
    return {
        pathFor(sessionId) {
            return pathFor(sessionId);
        },
        openSession(sessionId, meta) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    if (openedSessions.has(sessionId))
                        return;
                    openedSessions.add(sessionId);
                    const record = Object.assign(Object.assign(Object.assign(Object.assign({ kind: 'session_open', sessionId: sanitizeSessionId(sessionId), startedAt: now() }, ((meta === null || meta === void 0 ? void 0 : meta.taskId) !== undefined && { taskId: meta.taskId })), ((meta === null || meta === void 0 ? void 0 : meta.cwd) !== undefined && { cwd: meta.cwd })), ((meta === null || meta === void 0 ? void 0 : meta.model) !== undefined && { model: meta.model })), ((meta === null || meta === void 0 ? void 0 : meta.meta) !== undefined && { meta: meta.meta }));
                    yield writeRecord(sessionId, record);
                }));
            });
        },
        recordRaw(sessionId, event) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ensureOpen(sessionId);
                    const record = {
                        kind: 'raw',
                        sessionId: sanitizeSessionId(sessionId),
                        ts: now(),
                        event,
                    };
                    yield writeRecord(sessionId, record);
                }));
            });
        },
        recordTyped(sessionId, event) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ensureOpen(sessionId);
                    const record = {
                        kind: 'typed',
                        sessionId: sanitizeSessionId(sessionId),
                        ts: now(),
                        event,
                    };
                    yield writeRecord(sessionId, record);
                }));
            });
        },
        note(sessionId, level, text, meta) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ensureOpen(sessionId);
                    const record = Object.assign({ kind: 'note', sessionId: sanitizeSessionId(sessionId), ts: now(), level,
                        text }, (meta !== undefined && { meta }));
                    yield writeRecord(sessionId, record);
                }));
            });
        },
        recordEnvelope(sessionId, envelope) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ensureOpen(sessionId);
                    const record = {
                        kind: 'envelope',
                        sessionId: sanitizeSessionId(sessionId),
                        ts: now(),
                        envelope,
                    };
                    yield writeRecord(sessionId, record);
                }));
            });
        },
        closeSession(sessionId, status, reason) {
            return __awaiter(this, void 0, void 0, function* () {
                return enqueue(sessionId, () => __awaiter(this, void 0, void 0, function* () {
                    yield ensureOpen(sessionId);
                    const record = Object.assign({ kind: 'session_close', sessionId: sanitizeSessionId(sessionId), ts: now(), status }, (reason !== undefined && { reason }));
                    yield writeRecord(sessionId, record);
                    if (gzipOnClose) {
                        const { gzip } = yield import('node:zlib');
                        const { promisify } = yield import('node:util');
                        const gzipAsync = promisify(gzip);
                        const filePath = pathFor(sessionId);
                        const content = yield fs.readFile(filePath, 'utf8');
                        const compressed = yield gzipAsync(Buffer.from(content, 'utf8'));
                        const gzPath = filePath + '.gz';
                        yield fs.appendFile(gzPath, compressed.toString('binary'));
                        yield fs.rename(filePath, filePath + '.bak');
                    }
                }));
            });
        },
        listSessions() {
            return __awaiter(this, void 0, void 0, function* () {
                yield ensureDir();
                let entries;
                try {
                    entries = yield fs.readdir(dir);
                }
                catch (_a) {
                    return [];
                }
                return entries
                    .filter(f => f.endsWith('.jsonl'))
                    .map(f => f.slice(0, -('.jsonl'.length)));
            });
        },
        readSession(sessionId) {
            return __awaiter(this, void 0, void 0, function* () {
                const content = yield fs.readFile(pathFor(sessionId), 'utf8');
                const records = [];
                for (const line of content.split('\n')) {
                    const trimmed = line.trim();
                    if (!trimmed)
                        continue;
                    try {
                        records.push(JSON.parse(trimmed));
                    }
                    catch (_a) {
                        // skip malformed lines silently
                    }
                }
                return records;
            });
        },
    };
}

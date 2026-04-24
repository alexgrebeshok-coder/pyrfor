/**
 * SessionStore — JSON file persistence for SessionManager.
 *
 * Layout:
 *   ~/.pyrfor/sessions/{channel}/{userId}_{chatId}.json
 *
 * Design choices:
 * - One file per session keyed by (channel, userId, chatId), so /clear or
 *   eviction can remove a single small file.
 * - **Atomic writes**: write to `<file>.tmp` then `rename()` — crash-safe on
 *   POSIX (`rename(2)` is atomic within a filesystem). No half-written JSON.
 * - **Debounced writes**: addMessage() can fire many times per second during
 *   a tool loop; we coalesce into one write every `debounceMs` (default 5s).
 * - **flush() on shutdown** drains the debounce queue synchronously.
 * - **No schema migrations** — we store a `schemaVersion` field; older files
 *   are silently ignored if version is incompatible.
 *
 * Format:
 * {
 *   schemaVersion: 1,
 *   id, channel, userId, chatId,
 *   messages: [{ role, content, timestamp }],
 *   systemPrompt, tokenCount, maxTokens, metadata,
 *   createdAt, updatedAt
 * }
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
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { logger } from '../observability/logger';
export const SCHEMA_VERSION = 1;
const VALID_CHANNELS = new Set(['telegram', 'cli', 'tma', 'web']);
/** Sanitize a path segment so it can never escape the channel directory. */
function safeSegment(s) {
    // Replace anything that isn't safe with `_`. Collapse runs.
    return (s
        .normalize('NFKC')
        .replace(/[^A-Za-z0-9._-]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 200) || '_');
}
/** Build the absolute path for a session's JSON file. */
function buildPath(rootDir, channel, userId, chatId) {
    return path.join(rootDir, channel, `${safeSegment(userId)}_${safeSegment(chatId)}.json`);
}
export class SessionStore {
    constructor(options = {}) {
        var _a;
        this.timers = new Map();
        /** Sessions awaiting debounced flush, keyed by sessionId. */
        this.pending = new Map();
        /** Map sessionId → file path (set on save/load). */
        this.pathBySessionId = new Map();
        this.closed = false;
        this.rootDir = options.rootDir || path.join(homedir(), '.pyrfor', 'sessions');
        this.debounceMs = (_a = options.debounceMs) !== null && _a !== void 0 ? _a : 5000;
    }
    getRootDir() {
        return this.rootDir;
    }
    /** Ensure base directories exist. Idempotent. */
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            yield fs.mkdir(this.rootDir, { recursive: true });
            for (const channel of VALID_CHANNELS) {
                yield fs.mkdir(path.join(this.rootDir, channel), { recursive: true });
            }
        });
    }
    /**
     * Schedule a debounced save of the session.
     * Multiple calls within the debounce window collapse into one write.
     */
    save(session) {
        if (this.closed)
            return;
        this.pending.set(session.id, session);
        const existing = this.timers.get(session.id);
        if (existing)
            clearTimeout(existing);
        const timer = setTimeout(() => {
            this.timers.delete(session.id);
            const snap = this.pending.get(session.id);
            this.pending.delete(session.id);
            if (!snap)
                return;
            void this.writeAtomic(snap).catch((err) => {
                logger.error('SessionStore: deferred write failed', {
                    sessionId: snap.id,
                    error: String(err),
                });
            });
        }, this.debounceMs);
        // Don't keep the event loop alive just for a debounced write.
        if (typeof timer.unref === 'function')
            timer.unref();
        this.timers.set(session.id, timer);
    }
    /** Force-write a single session immediately, bypassing debounce. */
    saveNow(session) {
        return __awaiter(this, void 0, void 0, function* () {
            const t = this.timers.get(session.id);
            if (t) {
                clearTimeout(t);
                this.timers.delete(session.id);
            }
            this.pending.delete(session.id);
            yield this.writeAtomic(session);
        });
    }
    /** Flush all pending writes synchronously (await all). */
    flushAll() {
        return __awaiter(this, void 0, void 0, function* () {
            const sessions = Array.from(this.pending.values());
            for (const t of this.timers.values())
                clearTimeout(t);
            this.timers.clear();
            this.pending.clear();
            yield Promise.all(sessions.map((s) => this.writeAtomic(s).catch((err) => {
                logger.error('SessionStore: flush write failed', {
                    sessionId: s.id,
                    error: String(err),
                });
            })));
        });
    }
    /** Delete a session's persisted file. */
    delete(session) {
        return __awaiter(this, void 0, void 0, function* () {
            // Cancel any pending write first.
            const t = this.timers.get(session.id);
            if (t) {
                clearTimeout(t);
                this.timers.delete(session.id);
            }
            this.pending.delete(session.id);
            const filePath = this.pathBySessionId.get(session.id) ||
                buildPath(this.rootDir, session.channel, session.userId, session.chatId);
            this.pathBySessionId.delete(session.id);
            try {
                yield fs.unlink(filePath);
                logger.info('SessionStore: deleted', { sessionId: session.id, path: filePath });
            }
            catch (err) {
                const code = err.code;
                if (code !== 'ENOENT') {
                    logger.warn('SessionStore: delete failed', {
                        sessionId: session.id,
                        error: String(err),
                    });
                }
            }
        });
    }
    /**
     * Load all persisted sessions from disk.
     * Skips files that fail to parse / have wrong schema version.
     */
    loadAll() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.init();
            const out = [];
            for (const channel of VALID_CHANNELS) {
                const dir = path.join(this.rootDir, channel);
                let entries;
                try {
                    entries = yield fs.readdir(dir);
                }
                catch (err) {
                    const code = err.code;
                    if (code === 'ENOENT')
                        continue;
                    throw err;
                }
                for (const name of entries) {
                    if (!name.endsWith('.json'))
                        continue;
                    const filePath = path.join(dir, name);
                    try {
                        const raw = yield fs.readFile(filePath, 'utf-8');
                        const parsed = JSON.parse(raw);
                        if (parsed.schemaVersion !== SCHEMA_VERSION) {
                            logger.warn('SessionStore: skipping incompatible schema', {
                                file: filePath,
                                version: parsed.schemaVersion,
                            });
                            continue;
                        }
                        if (!parsed.id || !parsed.channel || !parsed.userId || !parsed.chatId) {
                            logger.warn('SessionStore: skipping malformed session', { file: filePath });
                            continue;
                        }
                        this.pathBySessionId.set(parsed.id, filePath);
                        out.push(parsed);
                    }
                    catch (err) {
                        logger.warn('SessionStore: failed to load session file', {
                            file: filePath,
                            error: String(err),
                        });
                    }
                }
            }
            logger.info('SessionStore: loaded', { count: out.length, root: this.rootDir });
            return out;
        });
    }
    /** Stop all timers; no more writes will be scheduled. */
    close() {
        this.closed = true;
        for (const t of this.timers.values())
            clearTimeout(t);
        this.timers.clear();
    }
    // ──────────────────────────────────────────────────────────────────────
    // Internals
    // ──────────────────────────────────────────────────────────────────────
    writeAtomic(session) {
        return __awaiter(this, void 0, void 0, function* () {
            const filePath = buildPath(this.rootDir, session.channel, session.userId, session.chatId);
            this.pathBySessionId.set(session.id, filePath);
            yield fs.mkdir(path.dirname(filePath), { recursive: true });
            const persisted = {
                schemaVersion: SCHEMA_VERSION,
                id: session.id,
                channel: session.channel,
                userId: session.userId,
                chatId: session.chatId,
                systemPrompt: session.systemPrompt,
                messages: session.messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                    timestamp: new Date().toISOString(),
                })),
                tokenCount: session.tokenCount,
                maxTokens: session.maxTokens,
                metadata: session.metadata,
                createdAt: session.createdAt.toISOString(),
                updatedAt: session.lastActivityAt.toISOString(),
            };
            const tmpPath = `${filePath}.${process.pid}.tmp`;
            const json = JSON.stringify(persisted, null, 2);
            let fh;
            try {
                fh = yield fs.open(tmpPath, 'w', 0o600);
                yield fh.writeFile(json, 'utf-8');
                // fsync to survive power loss / kernel panics.
                yield fh.sync().catch(() => { });
            }
            finally {
                yield (fh === null || fh === void 0 ? void 0 : fh.close());
            }
            yield fs.rename(tmpPath, filePath);
            logger.debug('SessionStore: wrote', {
                sessionId: session.id,
                path: filePath,
                bytes: json.length,
            });
        });
    }
}
/**
 * Convert a PersistedSession back into a runtime Session.
 * Timestamps on individual messages are dropped (Message type has no field).
 */
export function reviveSession(p) {
    return {
        id: p.id,
        channel: p.channel,
        userId: p.userId,
        chatId: p.chatId,
        messages: p.messages.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt: p.systemPrompt,
        createdAt: new Date(p.createdAt),
        lastActivityAt: new Date(p.updatedAt),
        tokenCount: p.tokenCount,
        maxTokens: p.maxTokens,
        metadata: p.metadata || {},
    };
}

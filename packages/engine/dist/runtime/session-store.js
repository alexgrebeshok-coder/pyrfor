/**
 * session-store.ts — Runtime Session Store: persists chat/run sessions to disk.
 *
 * Sprint 3 #8 — UNIFIED_PLAN_FINAL.md
 *
 * Layout: <rootDir>/<workspaceId>/<sessionId>.json
 *
 * Design:
 *  - In-memory cache (Map) is the source of truth for hot reads.
 *  - Mutations mark the entry dirty and schedule a debounced flush via setTimeout.
 *  - Atomic write: write to <file>.tmp then rename() — POSIX crash-safe.
 *  - flush() drains all dirty entries immediately; returns after all writes complete.
 *  - close() flushes then clears all timers.
 *  - Write errors during debounced saves: increment writeErrors, log warn, swallow.
 *  - Write errors during flush()/close(): increment writeErrors, log warn, rethrow.
 *
 * Also exports legacy PersistedSession / reviveSession / debounceMs alias so that
 * existing callers (index.ts, session.ts, cli.ts) continue to compile without
 * modification. These will be removed in a future sprint.
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
import { promises as fsp } from 'node:fs';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import logger from '../observability/logger.js';
/**
 * @deprecated Converts a PersistedSession back to a legacy session shape.
 * Used by index.ts to hydrate sessions on startup.
 */
export function reviveSession(p) {
    var _a, _b, _c, _d, _e;
    return {
        id: p.id,
        channel: p.channel,
        userId: p.userId,
        chatId: p.chatId,
        systemPrompt: (_a = p.systemPrompt) !== null && _a !== void 0 ? _a : '',
        messages: p.messages.map((m) => ({ role: normalizeLegacyRole(m.role), content: m.content })),
        createdAt: new Date(p.createdAt),
        lastActivityAt: new Date(p.updatedAt),
        tokenCount: (_b = p.tokenCount) !== null && _b !== void 0 ? _b : 0,
        maxTokens: (_c = p.maxTokens) !== null && _c !== void 0 ? _c : 128000,
        summary: typeof ((_d = p.metadata) === null || _d === void 0 ? void 0 : _d['sessionSummary']) === 'string' ? p.metadata['sessionSummary'] : undefined,
        metadata: (_e = p.metadata) !== null && _e !== void 0 ? _e : {},
    };
}
export function reviveSessionRecord(record) {
    return reviveSession(recordToPersistedSession(record));
}
// ====== Pure Helpers ==========================================================
/**
 * Return the absolute file path for a session JSON file.
 * Layout: <rootDir>/<workspaceId>/<sessionId>.json
 */
export function sessionFilePath(rootDir, workspaceId, sessionId) {
    return path.join(rootDir, sanitizeId(workspaceId), `${sanitizeId(sessionId)}.json`);
}
/**
 * Strip path-traversal sequences and filesystem-unsafe characters from an id
 * so it is safe to use as a path segment.
 */
export function sanitizeId(s) {
    return (s
        .replace(/\.\./g, '')
        .replace(/[/\\]/g, '_')
        .replace(/^_+/, '')
        .replace(/_+$/, '')) || '_';
}
/**
 * Build a deterministic rolling summary of messages by concatenating
 * "role: content" pairs and truncating to maxChars.
 * Deterministic: same input always produces the same output.
 */
export function summarizeMessages(messages, maxChars) {
    return messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n')
        .slice(0, maxChars);
}
/** Generate a new session id (UUID v4). */
export function newSessionId() {
    return randomUUID();
}
// ====== Internal helpers ======================================================
function cacheKey(workspaceId, sessionId) {
    return `${workspaceId}/${sessionId}`;
}
function isMode(value) {
    return value === 'chat' || value === 'edit' || value === 'autonomous' || value === 'pm';
}
function normalizeLegacyRole(role) {
    return role === 'user' || role === 'system' || role === 'assistant' ? role : 'assistant';
}
function legacyWorkspaceId(session) {
    var _a, _b, _c;
    if (!('metadata' in session))
        return 'legacy';
    const metadataWorkspace = (_b = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a['workspaceId']) !== null && _b !== void 0 ? _b : (_c = session.metadata) === null || _c === void 0 ? void 0 : _c['workspacePath'];
    if (typeof metadataWorkspace === 'string' && metadataWorkspace.length > 0)
        return metadataWorkspace;
    return 'legacy';
}
function legacySessionToRecord(session) {
    var _a;
    const workspaceId = legacyWorkspaceId(session);
    const summary = (_a = session.summary) !== null && _a !== void 0 ? _a : (typeof session.metadata['sessionSummary'] === 'string' ? session.metadata['sessionSummary'] : undefined);
    const mode = isMode(session.metadata['mode']) ? session.metadata['mode'] : 'chat';
    const updatedAt = session.lastActivityAt.toISOString();
    return Object.assign(Object.assign({ id: session.id, workspaceId, title: typeof session.metadata['title'] === 'string'
            ? session.metadata['title']
            : `${session.channel}:${session.chatId}`, mode, createdAt: session.createdAt.toISOString(), updatedAt, messages: session.messages.map((message, index) => ({
            id: `${session.id}:msg:${index}`,
            role: message.role,
            content: message.content,
            createdAt: updatedAt,
        })) }, (summary ? { summary } : {})), { metadata: Object.assign(Object.assign(Object.assign({}, session.metadata), { workspaceId, legacyChannel: session.channel, legacyUserId: session.userId, legacyChatId: session.chatId, systemPrompt: session.systemPrompt, tokenCount: session.tokenCount, maxTokens: session.maxTokens }), (summary ? { sessionSummary: summary } : {})) });
}
function recordToPersistedSession(record) {
    var _a;
    const metadata = (_a = record.metadata) !== null && _a !== void 0 ? _a : {};
    const channel = typeof metadata['legacyChannel'] === 'string' ? metadata['legacyChannel'] : 'web';
    const userId = typeof metadata['legacyUserId'] === 'string' ? metadata['legacyUserId'] : 'unknown';
    const chatId = typeof metadata['legacyChatId'] === 'string' ? metadata['legacyChatId'] : record.id;
    const systemPrompt = typeof metadata['systemPrompt'] === 'string' ? metadata['systemPrompt'] : '';
    const tokenCount = typeof metadata['tokenCount'] === 'number' ? metadata['tokenCount'] : 0;
    const maxTokens = typeof metadata['maxTokens'] === 'number' ? metadata['maxTokens'] : 128000;
    return {
        schemaVersion: 1,
        id: record.id,
        channel,
        userId,
        chatId,
        systemPrompt,
        messages: record.messages.map((message) => ({
            role: normalizeLegacyRole(message.role),
            content: message.content,
            timestamp: message.createdAt,
        })),
        tokenCount,
        maxTokens,
        metadata: Object.assign(Object.assign(Object.assign({}, metadata), { workspaceId: record.workspaceId }), (record.summary ? { sessionSummary: record.summary } : {})),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
// ====== SessionStore ==========================================================
/**
 * Persists chat/run sessions to disk as JSON files, one file per session.
 * In-memory cache is the source of truth for hot reads.
 * Mutations are debounce-autosaved to disk atomically.
 */
export class SessionStore {
    constructor(opts) {
        var _a, _b, _c, _d;
        /** workspaceId/sessionId → SessionRecord */
        this.cache = new Map();
        /** Keys of records that have unsaved mutations. */
        this.dirty = new Set();
        /** Active debounce timers keyed by cache key. */
        this.timers = new Map();
        this._flushes = 0;
        this._writeErrors = 0;
        this.opts = {
            // debounceMs is a legacy alias; autosaveDebounceMs wins if both present.
            autosaveDebounceMs: (_b = (_a = opts.autosaveDebounceMs) !== null && _a !== void 0 ? _a : opts.debounceMs) !== null && _b !== void 0 ? _b : 200,
            maxMessagesInMemory: (_c = opts.maxMessagesInMemory) !== null && _c !== void 0 ? _c : 5000,
            rootDir: (_d = opts.rootDir) !== null && _d !== void 0 ? _d : '',
        };
    }
    // ====== New API =============================================================
    /**
     * Create a new session record, write it to disk immediately, and return it.
     */
    create(input) {
        return __awaiter(this, void 0, void 0, function* () {
            const now = new Date().toISOString();
            const record = Object.assign(Object.assign(Object.assign({ id: newSessionId(), workspaceId: input.workspaceId, title: input.title, mode: input.mode, createdAt: now, updatedAt: now, messages: [] }, (input.runId !== undefined && { runId: input.runId })), (input.parentSessionId !== undefined && { parentSessionId: input.parentSessionId })), (input.metadata !== undefined && { metadata: input.metadata }));
            const key = cacheKey(record.workspaceId, record.id);
            this.cache.set(key, record);
            yield this._writeRecord(record);
            return record;
        });
    }
    /**
     * Get a session by workspaceId + sessionId.
     * Returns null if the session does not exist on disk or in cache.
     * Populates the cache on first disk read.
     */
    get(workspaceId, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const key = cacheKey(workspaceId, sessionId);
            if (this.cache.has(key))
                return this.cache.get(key);
            const filePath = sessionFilePath(this.opts.rootDir, workspaceId, sessionId);
            try {
                const raw = yield fsp.readFile(filePath, 'utf-8');
                const record = JSON.parse(raw);
                this.cache.set(key, record);
                return record;
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return null;
                throw err;
            }
        });
    }
    /**
     * List sessions for a workspace.
     * Scans <rootDir>/<workspaceId>/*.json; uses in-memory cache when available.
     * Sorting is done by reading createdAt/updatedAt fields from each record.
     *
     * Default behaviour: excludes archived sessions (archived !== true).
     */
    list(workspaceId_1) {
        return __awaiter(this, arguments, void 0, function* (workspaceId, opts = {}) {
            const { archived = false, mode, limit, offset = 0, orderBy = 'updatedAt', direction = 'desc', } = opts;
            const wsDir = path.join(this.opts.rootDir, sanitizeId(workspaceId));
            let entries;
            try {
                entries = yield fsp.readdir(wsDir);
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return [];
                throw err;
            }
            const records = [];
            for (const name of entries) {
                if (!name.endsWith('.json'))
                    continue;
                const sessionId = name.slice(0, -5); // strip '.json'
                const key = cacheKey(workspaceId, sessionId);
                let record;
                if (this.cache.has(key)) {
                    record = this.cache.get(key);
                }
                else {
                    const filePath = path.join(wsDir, name);
                    try {
                        const raw = yield fsp.readFile(filePath, 'utf-8');
                        record = JSON.parse(raw);
                        this.cache.set(key, record);
                    }
                    catch (_a) {
                        continue;
                    }
                }
                const isArchived = record.archived === true;
                if (archived !== isArchived)
                    continue;
                if (mode !== undefined && record.mode !== mode)
                    continue;
                records.push(record);
            }
            records.sort((a, b) => {
                const av = a[orderBy];
                const bv = b[orderBy];
                const cmp = av < bv ? -1 : av > bv ? 1 : 0;
                return direction === 'asc' ? cmp : -cmp;
            });
            return records.slice(offset, limit !== undefined ? offset + limit : undefined);
        });
    }
    /**
     * Append a message to a session.
     * Auto-assigns id (UUID v4) and createdAt (ISO) if absent on the input.
     * Marks session dirty and schedules a debounced flush.
     */
    appendMessage(workspaceId, sessionId, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const record = yield this.get(workspaceId, sessionId);
            if (!record) {
                throw new Error(`[SessionStore] Session not found: ${workspaceId}/${sessionId}`);
            }
            const message = Object.assign(Object.assign({}, msg), { id: (_a = msg.id) !== null && _a !== void 0 ? _a : randomUUID(), createdAt: (_b = msg.createdAt) !== null && _b !== void 0 ? _b : new Date().toISOString() });
            record.messages.push(message);
            record.updatedAt = new Date().toISOString();
            const key = cacheKey(workspaceId, sessionId);
            this.cache.set(key, record);
            this._scheduleSave(key, record);
            return message;
        });
    }
    /**
     * Patch specific fields on a session and bump updatedAt.
     * Returns null if session not found.
     */
    update(workspaceId, sessionId, patch) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.get(workspaceId, sessionId);
            if (!record)
                return null;
            Object.assign(record, patch, { updatedAt: new Date().toISOString() });
            const key = cacheKey(workspaceId, sessionId);
            this.cache.set(key, record);
            this._scheduleSave(key, record);
            return record;
        });
    }
    /**
     * Set archived=true on a session.
     * Returns false if session not found, true otherwise.
     */
    archive(workspaceId, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            return (yield this.update(workspaceId, sessionId, { archived: true })) !== null;
        });
    }
    delete(workspaceIdOrSession, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof workspaceIdOrSession !== 'string') {
                return this.delete(legacyWorkspaceId(workspaceIdOrSession), workspaceIdOrSession.id);
            }
            const wsId = workspaceIdOrSession;
            const sid = sessionId;
            const key = cacheKey(wsId, sid);
            const timer = this.timers.get(key);
            if (timer !== undefined) {
                clearTimeout(timer);
                this.timers.delete(key);
            }
            this.dirty.delete(key);
            this.cache.delete(key);
            const filePath = sessionFilePath(this.opts.rootDir, wsId, sid);
            try {
                yield fsp.unlink(filePath);
                return true;
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return false;
                throw err;
            }
        });
    }
    /**
     * Return a pretty-printed JSON string of the session record.
     * Throws if session not found.
     */
    exportToJson(workspaceId, sessionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const record = yield this.get(workspaceId, sessionId);
            if (!record) {
                throw new Error(`[SessionStore] exportToJson: session not found ${workspaceId}/${sessionId}`);
            }
            return JSON.stringify(record, null, 2);
        });
    }
    /**
     * Parse a JSON string, validate required fields, persist to disk, and add to cache.
     * Throws on invalid JSON or missing required fields.
     */
    importFromJson(json) {
        return __awaiter(this, void 0, void 0, function* () {
            let record;
            try {
                record = JSON.parse(json);
            }
            catch (err) {
                throw new Error(`[SessionStore] importFromJson: invalid JSON — ${String(err)}`);
            }
            const required = [
                'id', 'workspaceId', 'title', 'mode', 'createdAt', 'updatedAt', 'messages',
            ];
            for (const field of required) {
                // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                if (record[field] === undefined || record[field] === null) {
                    throw new Error(`[SessionStore] importFromJson: missing required field "${field}"`);
                }
            }
            if (!Array.isArray(record.messages)) {
                throw new Error('[SessionStore] importFromJson: "messages" must be an array');
            }
            const key = cacheKey(record.workspaceId, record.id);
            this.cache.set(key, record);
            yield this._writeRecord(record);
            return record;
        });
    }
    /**
     * Force all pending dirty sessions to be written to disk immediately.
     * Cancels outstanding debounce timers.
     * Increments the flushes counter regardless of errors.
     * Rethrows the first write error if any occur.
     */
    flush() {
        return __awaiter(this, void 0, void 0, function* () {
            for (const [key, timer] of this.timers) {
                clearTimeout(timer);
                this.timers.delete(key);
            }
            const dirtyKeys = [...this.dirty];
            this.dirty.clear();
            const errors = [];
            yield Promise.all(dirtyKeys.map((key) => __awaiter(this, void 0, void 0, function* () {
                const record = this.cache.get(key);
                if (!record)
                    return;
                try {
                    yield this._writeRecord(record);
                }
                catch (err) {
                    this._writeErrors++;
                    logger.warn('[SessionStore] Flush write error', { key, error: String(err) });
                    errors.push(err);
                }
            })));
            this._flushes++;
            if (errors.length > 0)
                throw errors[0];
        });
    }
    /**
     * Flush any pending writes, then clear all timers and state.
     * Should be called on graceful shutdown.
     */
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.flush();
            for (const timer of this.timers.values())
                clearTimeout(timer);
            this.timers.clear();
            this.dirty.clear();
        });
    }
    /** Return a snapshot of internal cache and write statistics. */
    getCacheStats() {
        return {
            loaded: this.cache.size,
            dirty: this.dirty.size,
            flushes: this._flushes,
            writeErrors: this._writeErrors,
        };
    }
    // ====== Legacy backward-compat methods =====================================
    /**
     * @deprecated Bridge for legacy session.ts callers.
     * New API: mutations are autosaved via appendMessage/update.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    save(_session) {
        const record = legacySessionToRecord(_session);
        const key = cacheKey(record.workspaceId, record.id);
        this.cache.set(key, record);
        this._scheduleSave(key, record);
    }
    /**
     * Persist a legacy session synchronously.
     *
     * Used for initial session creation so a crash immediately after create()
     * does not lose the session identity or first-turn continuity anchor.
     */
    saveImmediate(_session) {
        const record = legacySessionToRecord(_session);
        const key = cacheKey(record.workspaceId, record.id);
        const timer = this.timers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.timers.delete(key);
        }
        this.cache.set(key, record);
        this.dirty.delete(key);
        this._writeRecordSync(record);
    }
    /**
     * @deprecated No-op bridge for legacy index.ts callers.
     * New API: sessions are loaded lazily; no explicit init required.
     */
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            // Intentional no-op.
        });
    }
    /**
     * @deprecated Bridge for legacy index.ts callers. Always returns [].
     * New API: use list() per workspace.
     */
    loadAll() {
        return __awaiter(this, void 0, void 0, function* () {
            const records = [];
            let workspaceEntries;
            try {
                workspaceEntries = yield fsp.readdir(this.opts.rootDir);
            }
            catch (err) {
                if (err.code === 'ENOENT')
                    return [];
                throw err;
            }
            for (const workspaceName of workspaceEntries) {
                const workspaceDir = path.join(this.opts.rootDir, workspaceName);
                let stat;
                try {
                    stat = yield fsp.stat(workspaceDir);
                }
                catch (_a) {
                    continue;
                }
                if (!stat.isDirectory())
                    continue;
                let sessionFiles;
                try {
                    sessionFiles = yield fsp.readdir(workspaceDir);
                }
                catch (_b) {
                    continue;
                }
                for (const fileName of sessionFiles) {
                    if (!fileName.endsWith('.json'))
                        continue;
                    try {
                        const raw = yield fsp.readFile(path.join(workspaceDir, fileName), 'utf-8');
                        const record = JSON.parse(raw);
                        records.push(record);
                        this.cache.set(cacheKey(record.workspaceId, record.id), record);
                    }
                    catch (err) {
                        logger.warn('[SessionStore] Skipping unreadable persisted session', {
                            path: path.join(workspaceDir, fileName),
                            error: String(err),
                        });
                    }
                }
            }
            return records.map(recordToPersistedSession);
        });
    }
    /**
     * @deprecated Alias for flush(). Used by legacy index.ts callers.
     */
    flushAll() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.flush();
        });
    }
    // ====== Private helpers =====================================================
    /**
     * Schedule a debounced write for a session.
     * Multiple calls within the window collapse into one write at the end.
     * Write errors are counted and logged; they do NOT rethrow here.
     */
    _scheduleSave(key, record) {
        this.dirty.add(key);
        const existing = this.timers.get(key);
        if (existing !== undefined)
            clearTimeout(existing);
        const timer = setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            this.timers.delete(key);
            this.dirty.delete(key);
            try {
                yield this._writeRecord(record);
            }
            catch (err) {
                this._writeErrors++;
                logger.warn('[SessionStore] Autosave write error', { key, error: String(err) });
            }
        }), this.opts.autosaveDebounceMs);
        // Don't hold the event loop open just for a debounced write.
        if (typeof timer.unref === 'function') {
            timer.unref();
        }
        this.timers.set(key, timer);
    }
    /**
     * Atomically write a record to disk: write to <path>.tmp then rename().
     * rename() is atomic on POSIX within a single filesystem.
     */
    _writeRecord(record) {
        return __awaiter(this, void 0, void 0, function* () {
            const filePath = sessionFilePath(this.opts.rootDir, record.workspaceId, record.id);
            const tmpPath = `${filePath}.tmp`;
            const json = JSON.stringify(record, null, 2);
            yield fsp.mkdir(path.dirname(filePath), { recursive: true });
            yield fsp.writeFile(tmpPath, json, 'utf-8');
            yield fsp.rename(tmpPath, filePath);
            logger.debug('[SessionStore] Wrote session', { id: record.id, path: filePath });
        });
    }
    _writeRecordSync(record) {
        const filePath = sessionFilePath(this.opts.rootDir, record.workspaceId, record.id);
        const tmpPath = `${filePath}.tmp`;
        mkdirSync(path.dirname(filePath), { recursive: true });
        const json = JSON.stringify(record, null, 2);
        writeFileSync(tmpPath, json, 'utf-8');
        renameSync(tmpPath, filePath);
    }
}

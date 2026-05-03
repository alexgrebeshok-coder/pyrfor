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
/** A single message within a chat or run session. */
export interface SessionMessage {
    id: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        name: string;
        arguments: unknown;
    }>;
    /** ISO-8601 timestamp; auto-set by appendMessage if absent. */
    createdAt: string;
    metadata?: Record<string, unknown>;
}
/** Full persisted record for a session. */
export interface SessionRecord {
    /** Unique session identifier. */
    id: string;
    workspaceId: string;
    title: string;
    mode: 'chat' | 'edit' | 'autonomous' | 'pm';
    runId?: string;
    parentSessionId?: string;
    /** ISO-8601 creation timestamp. */
    createdAt: string;
    /** ISO-8601 last-updated timestamp. */
    updatedAt: string;
    messages: SessionMessage[];
    /** Optional rolling summary for long sessions. */
    summary?: string;
    archived?: boolean;
    metadata?: Record<string, unknown>;
}
/** Options accepted by the SessionStore constructor. */
export interface SessionStoreOptions {
    /**
     * Root directory where sessions are persisted.
     * Layout: <rootDir>/<workspaceId>/<sessionId>.json
     */
    /** Root dir (required for new API; legacy callers may use undefined with default). */
    rootDir?: string;
    /** Debounce window for autosaves in ms. Default: 200. */
    autosaveDebounceMs?: number;
    /**
     * @deprecated Alias for autosaveDebounceMs. Used by legacy callers.
     * If both are supplied autosaveDebounceMs wins.
     */
    debounceMs?: number;
    /**
     * Soft hint for callers: maximum messages to keep in memory before
     * summarisation. Not enforced by the store. Default: 5000.
     */
    maxMessagesInMemory?: number;
}
/** @deprecated Legacy persisted session shape; used by the old channel-based store. */
export interface PersistedSession {
    schemaVersion: number;
    id: string;
    channel: string;
    userId: string;
    chatId: string;
    systemPrompt: string;
    messages: Array<{
        role: string;
        content: string;
        timestamp?: string;
    }>;
    tokenCount: number;
    maxTokens: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
/** Structural shape of the legacy Session object (mirrors session.ts). */
interface LegacySession {
    id: string;
    channel: 'telegram' | 'cli' | 'tma' | 'web';
    userId: string;
    chatId: string;
    systemPrompt: string;
    messages: Array<{
        role: 'user' | 'system' | 'assistant';
        content: string;
    }>;
    tokenCount: number;
    maxTokens: number;
    summary?: string;
    metadata: Record<string, unknown>;
    createdAt: Date;
    lastActivityAt: Date;
}
/**
 * @deprecated Converts a PersistedSession back to a legacy session shape.
 * Used by index.ts to hydrate sessions on startup.
 */
export declare function reviveSession(p: PersistedSession): LegacySession;
export declare function reviveSessionRecord(record: SessionRecord): LegacySession;
/**
 * Return the absolute file path for a session JSON file.
 * Layout: <rootDir>/<workspaceId>/<sessionId>.json
 */
export declare function sessionFilePath(rootDir: string, workspaceId: string, sessionId: string): string;
/**
 * Strip path-traversal sequences and filesystem-unsafe characters from an id
 * so it is safe to use as a path segment.
 */
export declare function sanitizeId(s: string): string;
/**
 * Build a deterministic rolling summary of messages by concatenating
 * "role: content" pairs and truncating to maxChars.
 * Deterministic: same input always produces the same output.
 */
export declare function summarizeMessages(messages: SessionMessage[], maxChars: number): string;
/** Generate a new session id (UUID v4). */
export declare function newSessionId(): string;
/**
 * Persists chat/run sessions to disk as JSON files, one file per session.
 * In-memory cache is the source of truth for hot reads.
 * Mutations are debounce-autosaved to disk atomically.
 */
export declare class SessionStore {
    private readonly opts;
    /** workspaceId/sessionId → SessionRecord */
    private readonly cache;
    /** Keys of records that have unsaved mutations. */
    private readonly dirty;
    /** Active debounce timers keyed by cache key. */
    private readonly timers;
    private _flushes;
    private _writeErrors;
    constructor(opts: SessionStoreOptions);
    /**
     * Create a new session record, write it to disk immediately, and return it.
     */
    create(input: Pick<SessionRecord, 'workspaceId' | 'title' | 'mode'> & Partial<Pick<SessionRecord, 'runId' | 'parentSessionId' | 'metadata'>>): Promise<SessionRecord>;
    /**
     * Get a session by workspaceId + sessionId.
     * Returns null if the session does not exist on disk or in cache.
     * Populates the cache on first disk read.
     */
    get(workspaceId: string, sessionId: string): Promise<SessionRecord | null>;
    /**
     * List sessions for a workspace.
     * Scans <rootDir>/<workspaceId>/*.json; uses in-memory cache when available.
     * Sorting is done by reading createdAt/updatedAt fields from each record.
     *
     * Default behaviour: excludes archived sessions (archived !== true).
     */
    list(workspaceId: string, opts?: {
        archived?: boolean;
        mode?: SessionRecord['mode'];
        limit?: number;
        offset?: number;
        orderBy?: 'createdAt' | 'updatedAt';
        direction?: 'asc' | 'desc';
    }): Promise<SessionRecord[]>;
    /**
     * Append a message to a session.
     * Auto-assigns id (UUID v4) and createdAt (ISO) if absent on the input.
     * Marks session dirty and schedules a debounced flush.
     */
    appendMessage(workspaceId: string, sessionId: string, msg: Omit<SessionMessage, 'id' | 'createdAt'> & {
        id?: string;
        createdAt?: string;
    }): Promise<SessionMessage>;
    /**
     * Patch specific fields on a session and bump updatedAt.
     * Returns null if session not found.
     */
    update(workspaceId: string, sessionId: string, patch: Partial<Pick<SessionRecord, 'title' | 'mode' | 'runId' | 'summary' | 'archived' | 'metadata'>>): Promise<SessionRecord | null>;
    /**
     * Set archived=true on a session.
     * Returns false if session not found, true otherwise.
     */
    archive(workspaceId: string, sessionId: string): Promise<boolean>;
    /**
     * Delete a session by workspaceId + sessionId (new API).
     * Removes the file and evicts from cache.
     * Cancels any pending debounced save for that session.
     * Returns false if the file did not exist.
     */
    delete(workspaceId: string, sessionId: string): Promise<boolean>;
    /**
     * @deprecated Delete a session using a legacy Session-like object (old API).
     * No-op in the new API — callers should migrate to delete(workspaceId, sessionId).
     */
    delete(session: {
        id: string;
    }): Promise<boolean>;
    /**
     * Return a pretty-printed JSON string of the session record.
     * Throws if session not found.
     */
    exportToJson(workspaceId: string, sessionId: string): Promise<string>;
    /**
     * Parse a JSON string, validate required fields, persist to disk, and add to cache.
     * Throws on invalid JSON or missing required fields.
     */
    importFromJson(json: string): Promise<SessionRecord>;
    /**
     * Force all pending dirty sessions to be written to disk immediately.
     * Cancels outstanding debounce timers.
     * Increments the flushes counter regardless of errors.
     * Rethrows the first write error if any occur.
     */
    flush(): Promise<void>;
    /**
     * Flush any pending writes, then clear all timers and state.
     * Should be called on graceful shutdown.
     */
    close(): Promise<void>;
    /** Return a snapshot of internal cache and write statistics. */
    getCacheStats(): {
        loaded: number;
        dirty: number;
        flushes: number;
        writeErrors: number;
    };
    /**
     * @deprecated Bridge for legacy session.ts callers.
     * New API: mutations are autosaved via appendMessage/update.
     */
    save(_session: LegacySession): void;
    /**
     * Persist a legacy session synchronously.
     *
     * Used for initial session creation so a crash immediately after create()
     * does not lose the session identity or first-turn continuity anchor.
     */
    saveImmediate(_session: LegacySession): void;
    /**
     * @deprecated No-op bridge for legacy index.ts callers.
     * New API: sessions are loaded lazily; no explicit init required.
     */
    init(): Promise<void>;
    /**
     * @deprecated Bridge for legacy index.ts callers. Always returns [].
     * New API: use list() per workspace.
     */
    loadAll(): Promise<PersistedSession[]>;
    /**
     * @deprecated Alias for flush(). Used by legacy index.ts callers.
     */
    flushAll(): Promise<void>;
    /**
     * Schedule a debounced write for a session.
     * Multiple calls within the window collapse into one write at the end.
     * Write errors are counted and logged; they do NOT rethrow here.
     */
    private _scheduleSave;
    /**
     * Atomically write a record to disk: write to <path>.tmp then rename().
     * rename() is atomic on POSIX within a single filesystem.
     */
    private _writeRecord;
    private _writeRecordSync;
}
export {};
//# sourceMappingURL=session-store.d.ts.map
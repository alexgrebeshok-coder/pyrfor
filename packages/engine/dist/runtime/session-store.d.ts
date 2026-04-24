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
import type { Session, Channel } from './session';
import type { Message } from '../ai/providers/base';
export declare const SCHEMA_VERSION = 1;
export interface PersistedMessage {
    role: Message['role'];
    content: string;
    timestamp: string;
}
export interface PersistedSession {
    schemaVersion: number;
    id: string;
    channel: Channel;
    userId: string;
    chatId: string;
    systemPrompt: string;
    messages: PersistedMessage[];
    tokenCount: number;
    maxTokens: number;
    metadata: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}
export interface SessionStoreOptions {
    /** Root directory. Default: `~/.pyrfor/sessions` */
    rootDir?: string;
    /** Debounce window for writes per session, in ms. Default 5000. */
    debounceMs?: number;
}
export declare class SessionStore {
    private readonly rootDir;
    private readonly debounceMs;
    private readonly timers;
    /** Sessions awaiting debounced flush, keyed by sessionId. */
    private readonly pending;
    /** Map sessionId → file path (set on save/load). */
    private readonly pathBySessionId;
    private closed;
    constructor(options?: SessionStoreOptions);
    getRootDir(): string;
    /** Ensure base directories exist. Idempotent. */
    init(): Promise<void>;
    /**
     * Schedule a debounced save of the session.
     * Multiple calls within the debounce window collapse into one write.
     */
    save(session: Session): void;
    /** Force-write a single session immediately, bypassing debounce. */
    saveNow(session: Session): Promise<void>;
    /** Flush all pending writes synchronously (await all). */
    flushAll(): Promise<void>;
    /** Delete a session's persisted file. */
    delete(session: Pick<Session, 'id' | 'channel' | 'userId' | 'chatId'>): Promise<void>;
    /**
     * Load all persisted sessions from disk.
     * Skips files that fail to parse / have wrong schema version.
     */
    loadAll(): Promise<PersistedSession[]>;
    /** Stop all timers; no more writes will be scheduled. */
    close(): void;
    private writeAtomic;
}
/**
 * Convert a PersistedSession back into a runtime Session.
 * Timestamps on individual messages are dropped (Message type has no field).
 */
export declare function reviveSession(p: PersistedSession): Session;
//# sourceMappingURL=session-store.d.ts.map
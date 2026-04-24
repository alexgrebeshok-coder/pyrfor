/**
 * Session Manager — In-memory session storage with token management
 *
 * Features:
 * - Create/destroy sessions
 * - Add messages, track token count (rough: chars/3.5 for Russian, chars/4 for English)
 * - Rollover when >80% of maxTokens (keep system prompt + last N messages)
 * - In-memory Map (persist to SQLite later)
 */
import type { Message } from '../ai/providers/base';
import type { SessionStore } from './session-store';
export type Channel = 'telegram' | 'cli' | 'tma' | 'web';
export interface Session {
    id: string;
    channel: Channel;
    userId: string;
    chatId: string;
    messages: Message[];
    systemPrompt: string;
    createdAt: Date;
    lastActivityAt: Date;
    tokenCount: number;
    maxTokens: number;
    metadata: Record<string, unknown>;
}
export interface SessionCreateOptions {
    channel: Channel;
    userId: string;
    chatId: string;
    systemPrompt?: string;
    maxTokens?: number;
    metadata?: Record<string, unknown>;
}
export { estimateTokens } from '../utils/tokens';
/**
 * Calculate total tokens for a message array
 * @deprecated Use calculateMessageTokens from utils/tokens
 */
export declare function calculateSessionTokens(messages: Message[]): number;
export declare class SessionManager {
    private sessions;
    private readonly defaultMaxTokens;
    private readonly rolloverThreshold;
    private store;
    /** Attach a persistence backend. Pass null to disable. */
    setStore(store: SessionStore | null): void;
    /** Re-hydrate a session loaded from disk without triggering a save. */
    restore(session: Session): void;
    /**
     * Create a new session
     */
    create(options: SessionCreateOptions): Session;
    /**
     * Get session by ID
     */
    get(sessionId: string): Session | undefined;
    /**
     * Find session by user + channel + chat combination
     */
    findByContext(userId: string, channel: Channel, chatId: string): Session | undefined;
    /**
     * Add a message to a session
     * Returns true if rollover was triggered
     */
    addMessage(sessionId: string, message: Message): {
        success: boolean;
        rollover: boolean;
        error?: string;
    };
    /** Schedule a debounced persistence flush for this session. */
    private persist;
    /**
     * Add multiple messages at once
     */
    addMessages(sessionId: string, messages: Message[]): {
        success: boolean;
        rollover: boolean;
        error?: string;
    };
    /**
     * Rollover: keep system prompt + last N messages
     * This is called internally when token threshold is hit
     */
    private rollover;
    /**
     * Update session metadata
     */
    updateMetadata(sessionId: string, metadata: Record<string, unknown>): boolean;
    /**
     * Destroy a session
     */
    destroy(sessionId: string): boolean;
    /**
     * Get all active sessions (for stats/debugging)
     */
    getAll(): Session[];
    /**
     * Get session count
     */
    get count(): number;
    /**
     * Clean up old sessions (older than maxAgeMs)
     */
    cleanup(maxAgeMs?: number): number;
    /**
     * Get session stats
     */
    getStats(): {
        totalSessions: number;
        byChannel: Record<Channel, number>;
        totalTokens: number;
        averageTokens: number;
    };
    /**
     * Generate unique session ID
     */
    private generateSessionId;
}
export declare const sessionManager: SessionManager;
//# sourceMappingURL=session.d.ts.map
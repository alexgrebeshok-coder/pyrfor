/**
 * Session Manager — In-memory session storage with token management
 *
 * Features:
 * - Create/destroy sessions
 * - Add messages, track token count (rough: chars/3.5 for Russian, chars/4 for English)
 * - Rollover when >80% of maxTokens (keep system prompt + last N messages)
 * - In-memory Map (persist to SQLite later)
 */
import { calculateMessageTokens } from '../utils/tokens.js';
import { logger } from '../observability/logger.js';
// ============================================
// Token estimation
// ============================================
// Re-export from shared util for backward compatibility
export { estimateTokens } from '../utils/tokens.js';
/**
 * Calculate total tokens for a message array
 * @deprecated Use calculateMessageTokens from utils/tokens
 */
export function calculateSessionTokens(messages) {
    return calculateMessageTokens(messages);
}
// ============================================
// Session Manager
// ============================================
export class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.defaultMaxTokens = 128000; // 128K context window
        this.rolloverThreshold = 0.8; // 80%
        this.store = null;
        /** Per-session promise chain used to serialise concurrent async mutations. */
        this.mutexes = new Map();
    }
    /** Attach a persistence backend. Pass null to disable. */
    setStore(store) {
        this.store = store;
    }
    /**
     * Serialise async work for a single session.
     * Each call for the same sessionId is chained behind the previous one so
     * concurrent callers cannot interleave mutations.
     *
     * @example
     *   await sm.withSessionLock(sessionId, async () => {
     *     const session = sm.get(sessionId)!;
     *     await heavyAsyncWork(session);
     *     sm.addMessage(sessionId, result);
     *   });
     */
    withSessionLock(sessionId, fn) {
        var _a;
        const prev = (_a = this.mutexes.get(sessionId)) !== null && _a !== void 0 ? _a : Promise.resolve();
        const next = prev.then(() => fn());
        // Absorb errors so a rejected fn doesn't poison the mutex chain.
        this.mutexes.set(sessionId, next.catch(() => undefined));
        return next;
    }
    /** Re-hydrate a session loaded from disk without triggering a save. */
    restore(session) {
        this.sessions.set(session.id, session);
        logger.debug('Session restored', {
            id: session.id,
            userId: session.userId,
            channel: session.channel,
            messageCount: session.messages.length,
        });
    }
    /**
     * Create a new session
     */
    create(options) {
        var _a;
        const id = this.generateSessionId();
        const now = new Date();
        const session = {
            id,
            channel: options.channel,
            userId: options.userId,
            chatId: options.chatId,
            messages: [],
            systemPrompt: options.systemPrompt || '',
            createdAt: now,
            lastActivityAt: now,
            tokenCount: 0,
            maxTokens: options.maxTokens || this.defaultMaxTokens,
            metadata: options.metadata || {},
        };
        // Add system prompt as first message if provided
        if (options.systemPrompt) {
            session.messages.push({
                role: 'system',
                content: options.systemPrompt,
            });
            session.tokenCount = calculateSessionTokens(session.messages);
        }
        this.sessions.set(id, session);
        logger.info('Session created', { id, userId: options.userId, channel: options.channel });
        // Persist immediately so the session survives a crash before first message.
        (_a = this.store) === null || _a === void 0 ? void 0 : _a.save(session);
        return session;
    }
    /**
     * Get session by ID
     */
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * Find session by user + channel + chat combination
     */
    findByContext(userId, channel, chatId) {
        for (const session of this.sessions.values()) {
            if (session.userId === userId &&
                session.channel === channel &&
                session.chatId === chatId) {
                return session;
            }
        }
        return undefined;
    }
    /**
     * Add a message to a session
     * Returns true if rollover was triggered
     */
    addMessage(sessionId, message) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return { success: false, rollover: false, error: 'Session not found' };
        }
        // Update last activity
        session.lastActivityAt = new Date();
        // Add message
        session.messages.push(message);
        // Recalculate tokens
        session.tokenCount = calculateSessionTokens(session.messages);
        // Check if we need to rollover (keep 80% threshold, but warn at 70%)
        const tokenRatio = session.tokenCount / session.maxTokens;
        let rollover = false;
        if (tokenRatio > this.rolloverThreshold) {
            logger.warn('Session token threshold exceeded, rolling over', {
                sessionId,
                tokenCount: session.tokenCount,
                maxTokens: session.maxTokens,
            });
            this.rollover(session);
            rollover = true;
        }
        else if (tokenRatio > 0.7) {
            logger.debug('Session approaching token limit', {
                sessionId,
                tokenCount: session.tokenCount,
                maxTokens: session.maxTokens,
                ratio: tokenRatio.toFixed(2),
            });
        }
        this.persist(session);
        return { success: true, rollover };
    }
    /** Schedule a debounced persistence flush for this session. */
    persist(session) {
        var _a;
        (_a = this.store) === null || _a === void 0 ? void 0 : _a.save(session);
    }
    /**
     * Add multiple messages at once
     */
    addMessages(sessionId, messages) {
        var _a;
        const results = messages.map(msg => this.addMessage(sessionId, msg));
        const anyRollover = results.some(r => r.rollover);
        const firstError = (_a = results.find(r => r.error)) === null || _a === void 0 ? void 0 : _a.error;
        return {
            success: results.every(r => r.success),
            rollover: anyRollover,
            error: firstError,
        };
    }
    /**
     * Rollover: keep system prompt + last N messages
     * This is called internally when token threshold is hit
     */
    rollover(session) {
        const systemMessages = session.messages.filter(m => m.role === 'system');
        const nonSystemMessages = session.messages.filter(m => m.role !== 'system');
        // Keep last 10 non-system messages + all system messages
        const messagesToKeep = [
            ...systemMessages,
            ...nonSystemMessages.slice(-10),
        ];
        // If we still exceed, aggressively trim
        session.messages = messagesToKeep;
        session.tokenCount = calculateSessionTokens(session.messages);
        // If still over limit, keep only last 5
        if (session.tokenCount > session.maxTokens * 0.8) {
            const sys = session.messages.filter(m => m.role === 'system');
            const nonSys = session.messages.filter(m => m.role !== 'system');
            session.messages = [...sys, ...nonSys.slice(-5)];
            session.tokenCount = calculateSessionTokens(session.messages);
        }
        logger.info('Session rolled over', {
            sessionId: session.id,
            newTokenCount: session.tokenCount,
            messageCount: session.messages.length,
        });
    }
    /**
     * Update session metadata
     */
    updateMetadata(sessionId, metadata) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return false;
        session.metadata = Object.assign(Object.assign({}, session.metadata), metadata);
        session.lastActivityAt = new Date();
        this.persist(session);
        return true;
    }
    /**
     * Destroy a session
     */
    destroy(sessionId) {
        var _a;
        const session = this.sessions.get(sessionId);
        const existed = this.sessions.delete(sessionId);
        if (existed && session) {
            logger.info('Session destroyed', { sessionId });
            // Fire-and-forget delete; failures are logged inside SessionStore.
            void ((_a = this.store) === null || _a === void 0 ? void 0 : _a.delete(session));
        }
        return existed;
    }
    /**
     * Get all active sessions (for stats/debugging)
     */
    getAll() {
        return Array.from(this.sessions.values());
    }
    /**
     * Get session count
     */
    get count() {
        return this.sessions.size;
    }
    /**
     * Clean up old sessions (older than maxAgeMs)
     */
    cleanup(maxAgeMs = 24 * 60 * 60 * 1000) {
        var _a;
        const now = Date.now();
        let removed = 0;
        for (const [id, session] of this.sessions) {
            if (now - session.lastActivityAt.getTime() > maxAgeMs) {
                this.sessions.delete(id);
                void ((_a = this.store) === null || _a === void 0 ? void 0 : _a.delete(session));
                removed++;
            }
        }
        if (removed > 0) {
            logger.info('Cleaned up old sessions', { removed, remaining: this.sessions.size });
        }
        return removed;
    }
    /**
     * Get session stats
     */
    getStats() {
        const sessions = this.getAll();
        const byChannel = {
            telegram: 0,
            cli: 0,
            tma: 0,
            web: 0,
        };
        let totalTokens = 0;
        for (const session of sessions) {
            byChannel[session.channel]++;
            totalTokens += session.tokenCount;
        }
        return {
            totalSessions: sessions.length,
            byChannel,
            totalTokens,
            averageTokens: sessions.length > 0 ? Math.round(totalTokens / sessions.length) : 0,
        };
    }
    /**
     * Generate unique session ID
     */
    generateSessionId() {
        return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
}
// ============================================
// Singleton instance
// ============================================
export const sessionManager = new SessionManager();

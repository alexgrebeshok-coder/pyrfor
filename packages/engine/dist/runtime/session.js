"use strict";
/**
 * Session Manager — In-memory session storage with token management
 *
 * Features:
 * - Create/destroy sessions
 * - Add messages, track token count (rough: chars/3.5 for Russian, chars/4 for English)
 * - Rollover when >80% of maxTokens (keep system prompt + last N messages)
 * - In-memory Map (persist to SQLite later)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = exports.SessionManager = exports.estimateTokens = void 0;
exports.calculateSessionTokens = calculateSessionTokens;
const tokens_1 = require("../utils/tokens");
const logger_1 = require("../observability/logger");
// ============================================
// Token estimation
// ============================================
// Re-export from shared util for backward compatibility
var tokens_2 = require("../utils/tokens");
Object.defineProperty(exports, "estimateTokens", { enumerable: true, get: function () { return tokens_2.estimateTokens; } });
/**
 * Calculate total tokens for a message array
 * @deprecated Use calculateMessageTokens from utils/tokens
 */
function calculateSessionTokens(messages) {
    return (0, tokens_1.calculateMessageTokens)(messages);
}
// ============================================
// Session Manager
// ============================================
class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.defaultMaxTokens = 128000; // 128K context window
        this.rolloverThreshold = 0.8; // 80%
    }
    /**
     * Create a new session
     */
    create(options) {
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
        logger_1.logger.info('Session created', { id, userId: options.userId, channel: options.channel });
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
            logger_1.logger.warn('Session token threshold exceeded, rolling over', {
                sessionId,
                tokenCount: session.tokenCount,
                maxTokens: session.maxTokens,
            });
            this.rollover(session);
            rollover = true;
        }
        else if (tokenRatio > 0.7) {
            logger_1.logger.debug('Session approaching token limit', {
                sessionId,
                tokenCount: session.tokenCount,
                maxTokens: session.maxTokens,
                ratio: tokenRatio.toFixed(2),
            });
        }
        return { success: true, rollover };
    }
    /**
     * Add multiple messages at once
     */
    addMessages(sessionId, messages) {
        const results = messages.map(msg => this.addMessage(sessionId, msg));
        const anyRollover = results.some(r => r.rollover);
        const firstError = results.find(r => r.error)?.error;
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
        logger_1.logger.info('Session rolled over', {
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
        session.metadata = { ...session.metadata, ...metadata };
        session.lastActivityAt = new Date();
        return true;
    }
    /**
     * Destroy a session
     */
    destroy(sessionId) {
        const existed = this.sessions.delete(sessionId);
        if (existed) {
            logger_1.logger.info('Session destroyed', { sessionId });
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
        const now = Date.now();
        let removed = 0;
        for (const [id, session] of this.sessions) {
            if (now - session.lastActivityAt.getTime() > maxAgeMs) {
                this.sessions.delete(id);
                removed++;
            }
        }
        if (removed > 0) {
            logger_1.logger.info('Cleaned up old sessions', { removed, remaining: this.sessions.size });
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
exports.SessionManager = SessionManager;
// ============================================
// Singleton instance
// ============================================
exports.sessionManager = new SessionManager();

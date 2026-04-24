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
import { logger } from '../observability/logger';

// ============================================
// Types
// ============================================

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
  maxTokens: number;  // context window
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

// ============================================
// Token estimation
// ============================================

/**
 * Rough token estimation:
 * - Russian: chars / 3.5 (Cyrillic is denser)
 * - English: chars / 4
 * - Mixed: use average 3.75
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Count Cyrillic characters
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const totalChars = text.length;
  const latinCount = totalChars - cyrillicCount;

  // Weighted estimate
  const cyrillicTokens = cyrillicCount / 3.5;
  const latinTokens = latinCount / 4;

  return Math.ceil(cyrillicTokens + latinTokens);
}

/**
 * Calculate total tokens for a message array
 */
export function calculateSessionTokens(messages: Message[]): number {
  return messages.reduce((total, msg) => {
    // Role overhead: ~4 tokens
    return total + 4 + estimateTokens(msg.content);
  }, 0);
}

// ============================================
// Session Manager
// ============================================

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private readonly defaultMaxTokens = 8192;
  private readonly rolloverThreshold = 0.8; // 80%

  /**
   * Create a new session
   */
  create(options: SessionCreateOptions): Session {
    const id = this.generateSessionId();
    const now = new Date();

    const session: Session = {
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

    return session;
  }

  /**
   * Get session by ID
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Find session by user + channel + chat combination
   */
  findByContext(userId: string, channel: Channel, chatId: string): Session | undefined {
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
  addMessage(sessionId: string, message: Message): { success: boolean; rollover: boolean; error?: string } {
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
    } else if (tokenRatio > 0.7) {
      logger.debug('Session approaching token limit', {
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
  addMessages(sessionId: string, messages: Message[]): { success: boolean; rollover: boolean; error?: string } {
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
  private rollover(session: Session): void {
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
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.metadata = { ...session.metadata, ...metadata };
    session.lastActivityAt = new Date();
    return true;
  }

  /**
   * Destroy a session
   */
  destroy(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    if (existed) {
      logger.info('Session destroyed', { sessionId });
    }
    return existed;
  }

  /**
   * Get all active sessions (for stats/debugging)
   */
  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  get count(): number {
    return this.sessions.size;
  }

  /**
   * Clean up old sessions (older than maxAgeMs)
   */
  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt.getTime() > maxAgeMs) {
        this.sessions.delete(id);
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
  getStats(): {
    totalSessions: number;
    byChannel: Record<Channel, number>;
    totalTokens: number;
    averageTokens: number;
  } {
    const sessions = this.getAll();
    const byChannel: Record<Channel, number> = {
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
  private generateSessionId(): string {
    return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

// ============================================
// Singleton instance
// ============================================

export const sessionManager = new SessionManager();

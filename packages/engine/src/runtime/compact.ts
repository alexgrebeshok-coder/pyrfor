/**
 * Auto-Compact — Automatic message summarization for long sessions
 *
 * Features:
 * - When session >70% tokens → summarize old messages using AI
 * - Keep system prompt + last 10 messages + summary
 * - Language-aware: detect Russian, keep summary in same language
 */

import type { Session } from './session';
import type { Message } from '../ai/providers/base';
import { ProviderRouter } from './provider-router';
import { logger } from '../observability/logger';

// ============================================
// Types
// ============================================

export interface CompactOptions {
  /** Token threshold to trigger compact (default: 70% of maxTokens) */
  threshold?: number;
  /** Number of messages to keep at the end (default: 10) */
  keepRecentCount?: number;
  /** Provider to use for summarization */
  provider?: string;
  /** Model to use for summarization */
  model?: string;
}

export interface CompactResult {
  success: boolean;
  originalCount: number;
  newCount: number;
  summaryLength: number;
  tokensSaved: number;
  error?: string;
}

// ============================================
// Language Detection
// ============================================

/**
 * Detect if text is primarily Russian/Cyrillic
 */
function detectRussian(text: string): boolean {
  if (!text) return false;
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const totalLetters = (text.match(/[a-zA-Z\u0400-\u04FF]/g) || []).length;

  if (totalLetters === 0) return false;
  return cyrillicCount / totalLetters > 0.5;
}

/**
 * Detect primary language of messages
 */
function detectLanguage(messages: Message[]): 'ru' | 'en' {
  const allText = messages.map(m => m.content).join(' ');
  return detectRussian(allText) ? 'ru' : 'en';
}

// ============================================
// Auto-Compact
// ============================================

export class AutoCompact {
  private router: ProviderRouter;
  private readonly defaultThreshold = 0.7; // 70%
  private readonly defaultKeepRecent = 10;

  constructor(router: ProviderRouter) {
    this.router = router;
  }

  /**
   * Check if session needs compaction and perform it
   */
  async maybeCompact(session: Session, options?: CompactOptions): Promise<CompactResult | null> {
    const threshold = options?.threshold ?? this.defaultThreshold;
    const maxTokens = session.maxTokens;
    const currentTokens = session.tokenCount;
    const tokenRatio = currentTokens / maxTokens;

    // Check if below threshold
    if (tokenRatio < threshold) {
      return null; // No compaction needed
    }

    logger.info('Auto-compacting session', {
      sessionId: session.id,
      tokenRatio: tokenRatio.toFixed(2),
      currentTokens,
      maxTokens,
    });

    return this.compact(session, options);
  }

  /**
   * Force compaction of a session
   */
  async compact(session: Session, options?: CompactOptions): Promise<CompactResult> {
    const keepRecentCount = options?.keepRecentCount ?? this.defaultKeepRecent;

    try {
      // Separate messages
      const systemMessages = session.messages.filter(m => m.role === 'system');
      const nonSystemMessages = session.messages.filter(m => m.role !== 'system');

      if (nonSystemMessages.length <= keepRecentCount) {
        return {
          success: true,
          originalCount: session.messages.length,
          newCount: session.messages.length,
          summaryLength: 0,
          tokensSaved: 0,
          error: 'Not enough messages to compact',
        };
      }

      // Messages to summarize (excluding recent ones we keep)
      const messagesToSummarize = nonSystemMessages.slice(0, -keepRecentCount);
      const recentMessages = nonSystemMessages.slice(-keepRecentCount);

      // Detect language
      const language = detectLanguage(messagesToSummarize);

      // Generate summary
      const summary = await this.generateSummary(messagesToSummarize, language, options);

      // Calculate tokens before
      const tokensBefore = session.tokenCount;

      // Rebuild session messages
      const summaryMessage: Message = {
        role: 'system',
        content: `[Summary of earlier conversation]\n${summary}`,
      };

      session.messages = [
        ...systemMessages,
        summaryMessage,
        ...recentMessages,
      ];

      // Recalculate tokens
      const { calculateSessionTokens } = await import('./session');
      session.tokenCount = calculateSessionTokens(session.messages);
      const tokensSaved = tokensBefore - session.tokenCount;

      logger.info('Session compacted', {
        sessionId: session.id,
        originalCount: session.messages.length + messagesToSummarize.length - 1,
        newCount: session.messages.length,
        tokensSaved,
      });

      return {
        success: true,
        originalCount: messagesToSummarize.length + recentMessages.length + systemMessages.length,
        newCount: session.messages.length,
        summaryLength: summary.length,
        tokensSaved,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to compact session', { sessionId: session.id, error: errorMsg });

      return {
        success: false,
        originalCount: session.messages.length,
        newCount: session.messages.length,
        summaryLength: 0,
        tokensSaved: 0,
        error: errorMsg,
      };
    }
  }

  /**
   * Generate summary of messages using AI
   */
  private async generateSummary(
    messages: Message[],
    language: 'ru' | 'en',
    options?: CompactOptions
  ): Promise<string> {
    // Build prompt for summarization
    const conversation = messages
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const prompts = {
      ru: `Пожалуйста, кратко изложи суть следующей беседы. Выдели ключевые темы, решения и контекст, которые могут понадобиться для продолжения диалога. Ответь на русском языке.\n\n${conversation}`,
      en: `Please provide a brief summary of the following conversation. Highlight key topics, decisions, and context that may be needed to continue the dialogue.\n\n${conversation}`,
    };

    const summary = await this.router.chat(
      [{ role: 'user', content: prompts[language] }],
      {
        provider: options?.provider,
        model: options?.model,
        maxTokens: 500,
        temperature: 0.3, // Low temperature for deterministic summary
      }
    );

    return summary.trim();
  }

  /**
   * Get compact stats for a session
   */
  getStats(session: Session): {
    shouldCompact: boolean;
    tokenRatio: number;
    estimatedSavings: number;
  } {
    const nonSystemCount = session.messages.filter(m => m.role !== 'system').length;
    const messagesToSummarize = Math.max(0, nonSystemCount - this.defaultKeepRecent);
    const estimatedSavings = messagesToSummarize * 50; // Rough estimate: 50 tokens per message

    return {
      shouldCompact: session.tokenCount / session.maxTokens >= this.defaultThreshold,
      tokenRatio: session.tokenCount / session.maxTokens,
      estimatedSavings,
    };
  }
}

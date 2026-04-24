/**
 * Auto-Compact — Automatic message summarization for long sessions
 *
 * Features:
 * - When session >70% tokens → summarize old messages using AI
 * - Keep system prompt + last 10 messages + summary
 * - Language-aware: detect Russian, keep summary in same language
 */
import type { Session } from './session';
import { ProviderRouter } from './provider-router';
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
export declare class AutoCompact {
    private router;
    private readonly defaultThreshold;
    private readonly defaultKeepRecent;
    constructor(router: ProviderRouter);
    /**
     * Check if session needs compaction and perform it
     */
    maybeCompact(session: Session, options?: CompactOptions): Promise<CompactResult | null>;
    /**
     * Force compaction of a session
     */
    compact(session: Session, options?: CompactOptions): Promise<CompactResult>;
    /**
     * Generate summary of messages using AI
     */
    private generateSummary;
    /**
     * Get compact stats for a session
     */
    getStats(session: Session): {
        shouldCompact: boolean;
        tokenRatio: number;
        estimatedSavings: number;
    };
}

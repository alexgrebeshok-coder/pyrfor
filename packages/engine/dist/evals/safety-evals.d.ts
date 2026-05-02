/**
 * safety-evals.ts — Sprint 4 eval module: safety & adversarial prompt evals.
 *
 * Scores whether an agent refuses or correctly handles unsafe / disallowed
 * prompts — including prompt-injection attempts, secret-exfiltration tries,
 * and destructive tool calls. This module is purely evaluative — it never
 * drives the agent. The caller supplies a SafetyRunner that executes the agent
 * and returns the resulting events plus timing information.
 *
 * @module safety-evals
 */
import type { LedgerEvent } from '../runtime/event-ledger.js';
export type SafetyExpectation = 'refuse' | 'sanitize_and_continue' | 'tool_blocked' | 'no_secret_leak';
export interface SafetyCase {
    id: string;
    prompt: string;
    expectation: SafetyExpectation;
    /** For 'refuse': keywords that signal a refusal. Default list used if omitted. */
    refusalKeywords?: string[];
    /** Generic deny-list applied to final text + tool args (all expectations). */
    forbiddenSubstrings?: string[];
    /** For 'tool_blocked': the tool name that must be blocked. */
    blockedTool?: string;
    /** For 'no_secret_leak': tokens that must not appear in output or tool args. */
    secretTokens?: string[];
    /** Contribution to report score. Defaults to 1. */
    weight?: number;
}
export interface AgentRunResult {
    events: LedgerEvent[];
    finalText?: string;
    durationMs: number;
}
export type SafetyRunner = (c: SafetyCase, opts: {
    signal: AbortSignal;
}) => Promise<AgentRunResult>;
export interface SafetyCaseScore {
    caseId: string;
    expectation: SafetyExpectation;
    passed: boolean;
    /** Actual score earned: weight when passed, 0 when failed. */
    score: number;
    /** Maximum achievable score (= weight). */
    weight: number;
    /** Every signal that contributed, positive or negative. */
    reasons: string[];
    durationMs: number;
    /** Set when the runner threw or was aborted. */
    error?: string;
}
export interface SafetyReport {
    totalCases: number;
    passed: number;
    failed: number;
    /** Average of (score / weight) across all cases, clamped 0–1. */
    averageRatio: number;
    /** ISO 8601 timestamp of when runSafetyEvals was invoked. */
    startedAt: string;
    /** ISO 8601 timestamp of when runSafetyEvals returned. */
    finishedAt: string;
    scores: SafetyCaseScore[];
}
export interface RunSafetyOptions {
    cases: SafetyCase[];
    runner: SafetyRunner;
    /** Milliseconds before the runner is aborted per case. Defaults to 60 000. */
    timeoutMs?: number;
    /** Called after each case completes (pass or fail). */
    onCase?: (s: SafetyCaseScore) => void;
}
/**
 * Search `text` for any of the provided `keywords` (case-insensitive).
 * Returns the first matched keyword string, or null if none matched or the
 * list is empty.
 */
export declare function findRefusal(text: string, keywords: string[]): string | null;
/**
 * Return the subset of `forbidden` substrings that appear in `text`
 * (case-sensitive, deliberate). Empty array when no matches.
 */
export declare function containsAnyForbidden(text: string, forbidden: string[]): string[];
/**
 * Return true if a `tool.executed` event for the named tool exists in the
 * ledger. Matches on the `tool` field of `ToolExecutedEvent`.
 */
export declare function toolWasInvoked(events: LedgerEvent[], tool: string): boolean;
/**
 * Return true if the tool was blocked by the permission engine.
 *
 * Defensively matches any of the following signals in the ledger:
 *  - `type === 'tool.denied'` with matching tool
 *  - `type === 'approval.denied'` with matching tool
 *  - any event whose type includes "permission" or "denied"
 *  - any event that has `data.outcome === 'denied'` for the matching tool
 */
export declare function toolWasBlocked(events: LedgerEvent[], tool: string): boolean;
/**
 * Score a single safety case against a completed agent run result.
 *
 * Pure function — no side effects, no I/O.
 */
export declare function evaluateSafetyCase(c: SafetyCase, run: AgentRunResult): SafetyCaseScore;
/**
 * Run each safety case sequentially, score results, and return a full report.
 *
 * Each case gets its own AbortController wired to `opts.timeoutMs` (default
 * 60 000 ms). If the runner throws or is aborted, SafetyCaseScore.error is set
 * and score is 0.
 */
export declare function runSafetyEvals(opts: RunSafetyOptions): Promise<SafetyReport>;
/**
 * Load and parse a SafetyCase[] from a JSON file on disk.
 * Throws if the file is missing or contains invalid JSON.
 */
export declare function loadSafetyCasesFromFile(path: string): Promise<SafetyCase[]>;
//# sourceMappingURL=safety-evals.d.ts.map
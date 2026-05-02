/**
 * Test-Fixer Subagent
 *
 * Single-purpose subagent that receives a failing-test report (parsed JSON from
 * a test runner), classifies each failure into a well-known category using
 * heuristic signal matching, and emits a structured fix plan without touching
 * any source files.  The plan is consumed by downstream agents or human
 * engineers.
 *
 * Usage:
 *   import { runTestFixer } from './test-fixer.js';
 *   const plan = await runTestFixer({ failures });
 *
 * @module test-fixer
 */
export interface FailingTest {
    /** e.g. "src/foo.test.ts > suite > case" */
    id: string;
    /** Path to the test file */
    filePath: string;
    name: string;
    errorMessage: string;
    errorStack?: string;
    durationMs?: number;
}
export type FailureCategory = 'assertion_mismatch' | 'thrown_error' | 'timeout' | 'snapshot_mismatch' | 'import_error' | 'unhandled_rejection' | 'unknown';
export interface FailureClassification {
    testId: string;
    category: FailureCategory;
    /** 0..1 heuristic confidence */
    confidence: number;
    /** Matched substrings / regex descriptions */
    signals: string[];
}
export interface FixProposal {
    testId: string;
    category: FailureCategory;
    /** One short paragraph of rationale */
    rationale: string;
    suggestedActions: Array<{
        kind: 'update_assertion';
        targetFile: string;
        hint: string;
    } | {
        kind: 'fix_source';
        targetFile: string;
        hint: string;
    } | {
        kind: 'increase_timeout';
        targetFile: string;
        newMs: number;
    } | {
        kind: 'regenerate_snapshot';
        targetFile: string;
    } | {
        kind: 'install_dep';
        pkg: string;
    } | {
        kind: 'investigate';
        hint: string;
    }>;
    riskLevel: 'low' | 'medium' | 'high';
}
export interface TestFixerInput {
    failures: FailingTest[];
    /** Repository root — for context only, not used to read files */
    repoRoot?: string;
    /** Maximum number of proposals to emit. Default = failures.length */
    maxProposals?: number;
}
export interface TestFixerOutput {
    /** ISO 8601 timestamp */
    generatedAt: string;
    totalFailures: number;
    classifications: FailureClassification[];
    proposals: FixProposal[];
    summary: {
        byCategory: Record<FailureCategory, number>;
        byRisk: Record<'low' | 'medium' | 'high', number>;
    };
}
/**
 * Parse an explicit timeout value (in ms) from an error message, if present.
 * Returns null when no numeric ms value is found.
 */
export declare function parseTimeoutMs(message: string): number | null;
/**
 * Extract the module name from a "Cannot find module '…'" error message.
 * Returns null when the pattern is not present.
 */
export declare function extractModuleName(message: string): string | null;
/**
 * Classify a single failing test using heuristic signal matching.
 *
 * Rules (evaluated in priority order):
 *  1. timeout         – /timeout|exceeded N ms|did not complete within/
 *  2. snapshot_mismatch – /snapshot/ AND /(does not match|obsolete|mismatch)/
 *  3. import_error    – /Cannot find module|MODULE_NOT_FOUND|Unexpected token|SyntaxError/
 *  4. unhandled_rejection – /UnhandledPromiseRejection|Unhandled rejection/
 *  5. assertion_mismatch – /toEqual|toBe|to(strict)?equal|expected .* received/
 *  6. thrown_error    – has errorStack and still unclassified
 *  7. unknown         – none of the above
 *
 * Confidence:
 *  - 0.9  exactly one rule fired
 *  - 0.6  two rules competed (both recorded in signals)
 *  - 0.3  fell through to unknown
 */
export declare function classifyFailure(t: FailingTest): FailureClassification;
/**
 * Produce a structured fix proposal for a classified failure.
 * Pure — no I/O; all decisions are based on the inputs only.
 */
export declare function proposeFix(t: FailingTest, c: FailureClassification): FixProposal;
/**
 * Run the test-fixer pipeline:
 *  1. Classify each failure.
 *  2. Propose a fix for each.
 *  3. Aggregate summary counts.
 *  4. Apply maxProposals truncation (classifications are never truncated).
 */
export declare function runTestFixer(input: TestFixerInput): Promise<TestFixerOutput>;
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export declare function subagentSpec(): {
    name: 'test-fixer';
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
};
//# sourceMappingURL=test-fixer.d.ts.map
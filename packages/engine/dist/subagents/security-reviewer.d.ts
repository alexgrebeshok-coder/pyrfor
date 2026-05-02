/**
 * Security-Reviewer Subagent
 *
 * Single-purpose subagent that receives a set of source-file blobs from the
 * caller (content is passed in — we never read the disk, keeping this module
 * pure and testable), runs a battery of regex-based heuristics against each
 * file, and returns a structured report of potential security issues with
 * severity ratings and remediation hints.
 *
 * This is a fast first-pass reviewer.  Its findings are intended to be
 * triaged by a downstream agent or human engineer before any action is taken.
 *
 * Usage:
 *   import { runSecurityReviewer } from './security-reviewer.js';
 *   const report = await runSecurityReviewer({ files });
 *
 * @module security-reviewer
 */
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type FindingKind = 'hardcoded_secret' | 'sql_injection_risk' | 'command_injection_risk' | 'path_traversal_risk' | 'insecure_random' | 'weak_crypto' | 'eval_use' | 'unsafe_yaml_load' | 'cors_wildcard' | 'http_url_in_prod' | 'todo_security_marker';
export interface SourceFileInput {
    path: string;
    content: string;
    language?: 'ts' | 'js' | 'py' | 'go' | 'rs' | 'json' | 'yaml' | 'unknown';
}
export interface Finding {
    /** Stable identifier: "<path>:<line>:<kind>" */
    id: string;
    filePath: string;
    /** 1-based line number */
    line: number;
    /** 1-based column, optional */
    column?: number;
    kind: FindingKind;
    severity: Severity;
    message: string;
    /** Matched line, trimmed and truncated to 200 chars (appends "…" if cut) */
    snippet: string;
    remediation: string;
    /** Heuristic confidence, 0..1 */
    confidence: number;
}
export interface SecurityReviewerInput {
    files: SourceFileInput[];
    /** Glob-ish substrings; if any matches a file path (substring), the file is skipped */
    ignorePatterns?: string[];
    /** Maximum number of findings to return. Default = unlimited */
    maxFindings?: number;
    /** Suppress findings whose severity rank is below this level */
    severityFloor?: Severity;
}
export interface SecurityReviewerOutput {
    /** ISO 8601 timestamp of when the report was generated */
    generatedAt: string;
    filesScanned: number;
    filesSkipped: number;
    findings: Finding[];
    /**
     * Summary counts.
     * NOTE: Both bySeverity and byKind reflect the findings array AFTER
     * maxFindings truncation and severityFloor filtering — not the raw totals.
     */
    summary: {
        bySeverity: Record<Severity, number>;
        byKind: Record<FindingKind, number>;
    };
}
/**
 * Map a Severity to a comparable numeric rank.
 * critical=4, high=3, medium=2, low=1
 */
export declare function severityRank(s: Severity): number;
/**
 * Return true when `path` should be excluded from scanning.
 * A file is skipped when ANY element of `patterns` is a substring of `path`
 * (case-sensitive).  An empty patterns array never skips any file.
 */
export declare function shouldSkip(path: string, patterns: string[]): boolean;
/**
 * Scan a single source file and return all findings.
 *
 * The function walks lines exactly once.  Multiple pattern kinds may match a
 * single line — one Finding is emitted per (line, kind) pair.  When two
 * patterns share the same kind and both match the same line, the first match
 * (highest confidence) wins and the duplicate is suppressed.
 *
 * Pure: no I/O, no side-effects; deterministic for the same input.
 */
export declare function scanFile(file: SourceFileInput): Finding[];
/**
 * Run the security-reviewer pipeline across all provided files:
 *  1. Skip files that match any ignorePattern.
 *  2. Scan each remaining file with scanFile().
 *  3. Filter findings by severityFloor (if set).
 *  4. Truncate to maxFindings (if set).
 *  5. Build summary counts from the final (possibly truncated) findings array.
 *
 * NOTE: summary.bySeverity and summary.byKind reflect the findings array
 * AFTER severityFloor filtering and maxFindings truncation.  If maxFindings
 * cuts the list, the summary will under-count the true totals.  This is
 * intentional — the summary describes what the caller received, not what
 * was internally discovered.
 */
export declare function runSecurityReviewer(input: SecurityReviewerInput): Promise<SecurityReviewerOutput>;
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export declare function subagentSpec(): {
    name: 'security-reviewer';
    description: string;
    inputSchema: unknown;
    outputSchema: unknown;
};
//# sourceMappingURL=security-reviewer.d.ts.map
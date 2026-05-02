/**
 * tool-determinism.ts — Sprint 4 regression eval module.
 *
 * Deterministically executes a fixed set of tool-calls against a ToolRunnerLike
 * and asserts that outputs are byte-identical across N iterations (after scrubbing
 * well-known volatile fields like timestamps and generated ids). Any divergence
 * is captured as a structured diff so CI can surface it clearly.
 *
 * Usage:
 *   const runner = { invoke: myEngine.invoke.bind(myEngine) };
 *   const cases  = await loadCasesFromFile('./evals/__fixtures__/tool-determinism-cases.json');
 *   const report = await runDeterminism({ cases, runner });
 */
export interface ToolCallCase {
    /** Stable, human-readable identifier for this eval case. */
    id: string;
    /** Name of the registered tool to invoke. */
    tool: string;
    /** Arguments to pass verbatim to the tool. */
    args: Record<string, unknown>;
    /**
     * Dot-notation paths whose values will be replaced with "[REDACTED]" before
     * comparison. Examples: "result.id", "result.timestamp", "meta.createdAt".
     */
    redactPaths?: string[];
    /** How many times to invoke the tool. Defaults to 3. */
    iterations?: number;
    /** Optional pinned expected output (post-redaction). Case fails if it differs. */
    expected?: unknown;
}
export interface IterationDiff {
    iteration: number;
    reason: string;
    expected?: unknown;
    actual?: unknown;
}
export interface CaseResult {
    caseId: string;
    passed: boolean;
    iterations: number;
    diffs: IterationDiff[];
    durationMs: number;
}
export interface DeterminismReport {
    totalCases: number;
    passed: number;
    failed: number;
    cases: CaseResult[];
    startedAt: string;
    finishedAt: string;
}
/** Minimal structural interface — avoids coupling to the full ToolEngine surface. */
export interface ToolRunnerLike {
    invoke(name: string, args: Record<string, unknown>, opts?: {
        abortSignal?: AbortSignal;
    }): Promise<unknown>;
}
export interface RunDeterminismOptions {
    cases: ToolCallCase[];
    runner: ToolRunnerLike;
    /** Override per-case default iteration count. Defaults to 3. */
    defaultIterations?: number;
    /** Called synchronously after each case completes. */
    onCase?: (r: CaseResult) => void;
}
/**
 * redact — walks `paths` (dot-notation) on a deep clone of `value` and
 * replaces each matched leaf with the literal string "[REDACTED]".
 * Missing paths are silently ignored (no-op).
 */
export declare function redact(value: unknown, paths: string[]): unknown;
/**
 * deepEqualCanonical — compares two values for deep equality.
 * Object key order is normalised (sorted) so `{ b:1, a:2 }` equals `{ a:2, b:1 }`.
 * Array order is preserved (matters).
 * `null` and `undefined` are treated as distinct.
 */
export declare function deepEqualCanonical(a: unknown, b: unknown): boolean;
/**
 * loadCasesFromFile — reads a JSON file at `filePath` and parses it as
 * `ToolCallCase[]`. Throws a descriptive error if the file is missing or
 * if the content is not a JSON array.
 */
export declare function loadCasesFromFile(filePath: string): Promise<ToolCallCase[]>;
/**
 * runDeterminism — executes each case sequentially (never in parallel, so
 * potential race conditions in the runner are not masked) and collects results
 * into a DeterminismReport.
 *
 * A case passes iff:
 *   1. All iterations return the same post-redaction output.
 *   2. If `expected` is provided, the output also equals `expected`.
 */
export declare function runDeterminism(opts: RunDeterminismOptions): Promise<DeterminismReport>;
//# sourceMappingURL=tool-determinism.d.ts.map
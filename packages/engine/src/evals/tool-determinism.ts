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

import fs from 'node:fs/promises';

// ===== Public types ==========================================================

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
  invoke(
    name: string,
    args: Record<string, unknown>,
    opts?: { abortSignal?: AbortSignal },
  ): Promise<unknown>;
}

export interface RunDeterminismOptions {
  cases: ToolCallCase[];
  runner: ToolRunnerLike;
  /** Override per-case default iteration count. Defaults to 3. */
  defaultIterations?: number;
  /** Called synchronously after each case completes. */
  onCase?: (r: CaseResult) => void;
}

// ===== Pure helpers ==========================================================

/**
 * redact — walks `paths` (dot-notation) on a deep clone of `value` and
 * replaces each matched leaf with the literal string "[REDACTED]".
 * Missing paths are silently ignored (no-op).
 */
export function redact(value: unknown, paths: string[]): unknown {
  if (paths.length === 0) return value;

  // Deep clone via JSON round-trip so we never mutate the original.
  const clone: unknown = JSON.parse(JSON.stringify(value));

  for (const path of paths) {
    const segments = path.split('.');
    _setAtPath(clone, segments, '[REDACTED]');
  }

  return clone;
}

function _setAtPath(
  node: unknown,
  segments: string[],
  replacement: string,
): void {
  if (segments.length === 0 || node === null || typeof node !== 'object') {
    return;
  }

  const [head, ...tail] = segments;
  const obj = node as Record<string, unknown>;

  if (!(head in obj)) return; // missing path — no-op

  if (tail.length === 0) {
    obj[head] = replacement;
  } else {
    _setAtPath(obj[head], tail, replacement);
  }
}

/**
 * deepEqualCanonical — compares two values for deep equality.
 * Object key order is normalised (sorted) so `{ b:1, a:2 }` equals `{ a:2, b:1 }`.
 * Array order is preserved (matters).
 * `null` and `undefined` are treated as distinct.
 */
export function deepEqualCanonical(a: unknown, b: unknown): boolean {
  return JSON.stringify(_canonicalise(a)) === JSON.stringify(_canonicalise(b));
}

function _canonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map(_canonicalise);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = _canonicalise(obj[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * loadCasesFromFile — reads a JSON file at `filePath` and parses it as
 * `ToolCallCase[]`. Throws a descriptive error if the file is missing or
 * if the content is not a JSON array.
 */
export async function loadCasesFromFile(
  filePath: string,
): Promise<ToolCallCase[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `tool-determinism: cannot read cases file "${filePath}": ${(err as NodeJS.ErrnoException).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `tool-determinism: cases file "${filePath}" is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `tool-determinism: cases file "${filePath}" must contain a JSON array, got ${typeof parsed}`,
    );
  }

  return parsed as ToolCallCase[];
}

// ===== Core runner ===========================================================

/**
 * runDeterminism — executes each case sequentially (never in parallel, so
 * potential race conditions in the runner are not masked) and collects results
 * into a DeterminismReport.
 *
 * A case passes iff:
 *   1. All iterations return the same post-redaction output.
 *   2. If `expected` is provided, the output also equals `expected`.
 */
export async function runDeterminism(
  opts: RunDeterminismOptions,
): Promise<DeterminismReport> {
  const { cases, runner, defaultIterations = 3, onCase } = opts;
  const startedAt = new Date().toISOString();

  const caseResults: CaseResult[] = [];

  for (const tc of cases) {
    const result = await _runCase(tc, runner, defaultIterations);
    caseResults.push(result);
    onCase?.(result);
  }

  const passed = caseResults.filter((r) => r.passed).length;
  const finishedAt = new Date().toISOString();

  return {
    totalCases: cases.length,
    passed,
    failed: cases.length - passed,
    cases: caseResults,
    startedAt,
    finishedAt,
  };
}

// ===== Internal case executor ================================================

async function _runCase(
  tc: ToolCallCase,
  runner: ToolRunnerLike,
  defaultIterations: number,
): Promise<CaseResult> {
  const iterations = tc.iterations ?? defaultIterations;
  const paths = tc.redactPaths ?? [];
  const diffs: IterationDiff[] = [];

  const t0 = Date.now();

  // Collect outputs across all iterations.
  const outputs: unknown[] = [];

  for (let i = 0; i < iterations; i++) {
    let raw: unknown;
    try {
      raw = await runner.invoke(tc.tool, tc.args);
    } catch (err) {
      diffs.push({
        iteration: i,
        reason: `threw: ${(err as Error).message}`,
      });
      continue;
    }

    outputs.push(redact(raw, paths));
  }

  // Check mutual equality of all successful outputs.
  if (outputs.length > 0) {
    const baseline = outputs[0];

    for (let i = 1; i < outputs.length; i++) {
      if (!deepEqualCanonical(baseline, outputs[i])) {
        diffs.push({
          iteration: i,
          reason: 'output differs from iteration 0',
          expected: baseline,
          actual: outputs[i],
        });
      }
    }

    // Check against pinned expected value (if provided), using the baseline output.
    if (tc.expected !== undefined) {
      const redactedExpected = redact(tc.expected, paths);
      if (!deepEqualCanonical(baseline, redactedExpected)) {
        diffs.push({
          iteration: 0,
          reason: 'output does not match pinned expected value',
          expected: redactedExpected,
          actual: baseline,
        });
      }
    }
  }

  return {
    caseId: tc.id,
    passed: diffs.length === 0,
    iterations,
    diffs,
    durationMs: Date.now() - t0,
  };
}

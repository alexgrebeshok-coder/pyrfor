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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import fs from 'node:fs/promises';
// ===== Pure helpers ==========================================================
/**
 * redact — walks `paths` (dot-notation) on a deep clone of `value` and
 * replaces each matched leaf with the literal string "[REDACTED]".
 * Missing paths are silently ignored (no-op).
 */
export function redact(value, paths) {
    if (paths.length === 0)
        return value;
    // Deep clone via JSON round-trip so we never mutate the original.
    const clone = JSON.parse(JSON.stringify(value));
    for (const path of paths) {
        const segments = path.split('.');
        _setAtPath(clone, segments, '[REDACTED]');
    }
    return clone;
}
function _setAtPath(node, segments, replacement) {
    if (segments.length === 0 || node === null || typeof node !== 'object') {
        return;
    }
    const [head, ...tail] = segments;
    const obj = node;
    if (!(head in obj))
        return; // missing path — no-op
    if (tail.length === 0) {
        obj[head] = replacement;
    }
    else {
        _setAtPath(obj[head], tail, replacement);
    }
}
/**
 * deepEqualCanonical — compares two values for deep equality.
 * Object key order is normalised (sorted) so `{ b:1, a:2 }` equals `{ a:2, b:1 }`.
 * Array order is preserved (matters).
 * `null` and `undefined` are treated as distinct.
 */
export function deepEqualCanonical(a, b) {
    return JSON.stringify(_canonicalise(a)) === JSON.stringify(_canonicalise(b));
}
function _canonicalise(value) {
    if (value === null || value === undefined)
        return value;
    if (Array.isArray(value)) {
        return value.map(_canonicalise);
    }
    if (typeof value === 'object') {
        const obj = value;
        const sorted = {};
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
export function loadCasesFromFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        let raw;
        try {
            raw = yield fs.readFile(filePath, 'utf-8');
        }
        catch (err) {
            throw new Error(`tool-determinism: cannot read cases file "${filePath}": ${err.message}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        }
        catch (err) {
            throw new Error(`tool-determinism: cases file "${filePath}" is not valid JSON: ${err.message}`);
        }
        if (!Array.isArray(parsed)) {
            throw new Error(`tool-determinism: cases file "${filePath}" must contain a JSON array, got ${typeof parsed}`);
        }
        return parsed;
    });
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
export function runDeterminism(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const { cases, runner, defaultIterations = 3, onCase } = opts;
        const startedAt = new Date().toISOString();
        const caseResults = [];
        for (const tc of cases) {
            const result = yield _runCase(tc, runner, defaultIterations);
            caseResults.push(result);
            onCase === null || onCase === void 0 ? void 0 : onCase(result);
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
    });
}
// ===== Internal case executor ================================================
function _runCase(tc, runner, defaultIterations) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const iterations = (_a = tc.iterations) !== null && _a !== void 0 ? _a : defaultIterations;
        const paths = (_b = tc.redactPaths) !== null && _b !== void 0 ? _b : [];
        const diffs = [];
        const t0 = Date.now();
        // Collect outputs across all iterations.
        const outputs = [];
        for (let i = 0; i < iterations; i++) {
            let raw;
            try {
                raw = yield runner.invoke(tc.tool, tc.args);
            }
            catch (err) {
                diffs.push({
                    iteration: i,
                    reason: `threw: ${err.message}`,
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
    });
}

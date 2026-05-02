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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// ====== Constants ======
/** All known categories, used to initialise zero-counts. */
const ALL_CATEGORIES = [
    'assertion_mismatch',
    'thrown_error',
    'timeout',
    'snapshot_mismatch',
    'import_error',
    'unhandled_rejection',
    'unknown',
];
// ====== Signal helpers ======
const RE_TIMEOUT = /timeout|timed out|exceeded \d+ ?ms|did not complete within/i;
const RE_ASSERTION = /toEqual|toBe|to(?:strict)?equal|expected .* received/i;
const RE_SNAPSHOT_BODY = /snapshot/i;
const RE_SNAPSHOT_QUAL = /does not match|obsolete|mismatch/i;
const RE_IMPORT = /Cannot find module|MODULE_NOT_FOUND|Unexpected token|SyntaxError/;
const RE_UNHANDLED = /UnhandledPromiseRejection|Unhandled rejection/i;
const RE_MODULE_NAME = /Cannot find module ['"]([^'"]+)['"]/;
const RE_TIMEOUT_MS = /(\d+)\s*ms/i;
// ====== Pure Helpers ======
/**
 * Parse an explicit timeout value (in ms) from an error message, if present.
 * Returns null when no numeric ms value is found.
 */
export function parseTimeoutMs(message) {
    const m = message.match(RE_TIMEOUT_MS);
    return m ? parseInt(m[1], 10) : null;
}
/**
 * Extract the module name from a "Cannot find module '…'" error message.
 * Returns null when the pattern is not present.
 */
export function extractModuleName(message) {
    const m = message.match(RE_MODULE_NAME);
    return m ? m[1] : null;
}
// ====== Core logic ======
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
export function classifyFailure(t) {
    var _a;
    const haystack = `${t.errorMessage}\n${(_a = t.errorStack) !== null && _a !== void 0 ? _a : ''}`;
    const matched = [];
    if (RE_TIMEOUT.test(haystack)) {
        matched.push({ category: 'timeout', signal: 'timeout/exceeded Nms/did not complete within' });
    }
    if (RE_SNAPSHOT_BODY.test(haystack) && RE_SNAPSHOT_QUAL.test(haystack)) {
        matched.push({ category: 'snapshot_mismatch', signal: 'snapshot + does not match/obsolete/mismatch' });
    }
    if (RE_IMPORT.test(haystack)) {
        matched.push({ category: 'import_error', signal: 'Cannot find module/MODULE_NOT_FOUND/Unexpected token/SyntaxError' });
    }
    if (RE_UNHANDLED.test(haystack)) {
        matched.push({ category: 'unhandled_rejection', signal: 'UnhandledPromiseRejection/Unhandled rejection' });
    }
    if (RE_ASSERTION.test(haystack)) {
        matched.push({ category: 'assertion_mismatch', signal: 'toEqual/toBe/toStrictEqual/expected.*received' });
    }
    if (matched.length === 0 && t.errorStack) {
        matched.push({ category: 'thrown_error', signal: 'errorStack present' });
    }
    if (matched.length === 0) {
        return {
            testId: t.id,
            category: 'unknown',
            confidence: 0.3,
            signals: [],
        };
    }
    if (matched.length === 1) {
        return {
            testId: t.id,
            category: matched[0].category,
            confidence: 0.9,
            signals: [matched[0].signal],
        };
    }
    // Two or more rules competed — pick the first (priority order) and record all signals.
    return {
        testId: t.id,
        category: matched[0].category,
        confidence: 0.6,
        signals: matched.map(m => m.signal),
    };
}
/**
 * Produce a structured fix proposal for a classified failure.
 * Pure — no I/O; all decisions are based on the inputs only.
 */
export function proposeFix(t, c) {
    switch (c.category) {
        case 'assertion_mismatch':
            return {
                testId: t.id,
                category: c.category,
                rationale: 'The assertion received a value that did not match the expectation. ' +
                    'Either the source implementation changed its output or the test expectation ' +
                    'is stale. Review the diff between expected and received values to determine ' +
                    'whether the source or the assertion needs updating.',
                suggestedActions: [
                    { kind: 'update_assertion', targetFile: t.filePath, hint: 'Align the expected value with the current source behaviour, or revert the source change.' },
                    { kind: 'investigate', hint: `Inspect assertion diff in ${t.filePath} for test "${t.name}".` },
                ],
                riskLevel: 'low',
            };
        case 'thrown_error':
            return {
                testId: t.id,
                category: c.category,
                rationale: 'An unexpected exception was thrown during the test. This usually means ' +
                    'the source function throws in a code path that was previously not reached, ' +
                    'or a dependency changed its error-handling contract.',
                suggestedActions: [
                    { kind: 'fix_source', targetFile: t.filePath, hint: 'Locate the throw site in the stack trace and add guard/error handling.' },
                    { kind: 'investigate', hint: `Review the full stack trace for test "${t.name}" to identify the throw origin.` },
                ],
                riskLevel: 'medium',
            };
        case 'timeout': {
            const parsed = parseTimeoutMs(t.errorMessage);
            const newMs = parsed !== null ? parsed * 2 : 10000;
            return {
                testId: t.id,
                category: c.category,
                rationale: 'The test exceeded its configured time limit. This may indicate an async ' +
                    'operation that never resolves, an accidentally missing await, or a genuine ' +
                    'performance regression in the subject under test.',
                suggestedActions: [
                    { kind: 'increase_timeout', targetFile: t.filePath, newMs },
                    { kind: 'investigate', hint: `Check for unresolved promises or slow I/O in test "${t.name}".` },
                ],
                riskLevel: 'low',
            };
        }
        case 'snapshot_mismatch':
            return {
                testId: t.id,
                category: c.category,
                rationale: 'The rendered output no longer matches the stored snapshot. If the change ' +
                    'is intentional, regenerate the snapshot. If not, revert the source change.',
                suggestedActions: [
                    { kind: 'regenerate_snapshot', targetFile: t.filePath },
                    { kind: 'investigate', hint: `Confirm the snapshot diff is intentional for test "${t.name}" before regenerating.` },
                ],
                riskLevel: 'low',
            };
        case 'import_error': {
            const pkg = extractModuleName(t.errorMessage);
            return {
                testId: t.id,
                category: c.category,
                rationale: 'A module could not be resolved at import time. This is typically caused ' +
                    'by a missing dependency, a wrong import path, or a TypeScript/bundler ' +
                    'misconfiguration.',
                suggestedActions: pkg
                    ? [
                        { kind: 'install_dep', pkg },
                        { kind: 'fix_source', targetFile: t.filePath, hint: `Verify the import path for "${pkg}" is correct and the package is listed in dependencies.` },
                    ]
                    : [
                        { kind: 'fix_source', targetFile: t.filePath, hint: 'Resolve the import/module error — check paths and tsconfig paths mappings.' },
                    ],
                riskLevel: 'high',
            };
        }
        case 'unhandled_rejection':
            return {
                testId: t.id,
                category: c.category,
                rationale: 'A promise was rejected without a handler. This typically means an async ' +
                    'function throws and the caller did not await or catch it. Ensure all async ' +
                    'paths are properly awaited and wrapped in try/catch where appropriate.',
                suggestedActions: [
                    { kind: 'fix_source', targetFile: t.filePath, hint: 'Add await/catch to all async call sites in the affected code path.' },
                    { kind: 'investigate', hint: `Trace the unhandled rejection origin for test "${t.name}".` },
                ],
                riskLevel: 'high',
            };
        default:
            return {
                testId: t.id,
                category: 'unknown',
                rationale: 'The failure could not be classified by any known heuristic. Manual ' +
                    'investigation is required to understand the root cause.',
                suggestedActions: [
                    { kind: 'investigate', hint: `Manually review the error message and stack for test "${t.name}".` },
                ],
                riskLevel: 'medium',
            };
    }
}
// ====== Aggregate helpers ======
/**
 * Build a zero-filled byCategory summary map.
 */
function zeroCategoryMap() {
    return Object.fromEntries(ALL_CATEGORIES.map(c => [c, 0]));
}
/**
 * Build a zero-filled byRisk summary map.
 */
function zeroRiskMap() {
    return { low: 0, medium: 0, high: 0 };
}
// ====== Main entry point ======
/**
 * Run the test-fixer pipeline:
 *  1. Classify each failure.
 *  2. Propose a fix for each.
 *  3. Aggregate summary counts.
 *  4. Apply maxProposals truncation (classifications are never truncated).
 */
export function runTestFixer(input) {
    return __awaiter(this, void 0, void 0, function* () {
        const { failures, maxProposals } = input;
        const cap = maxProposals !== undefined ? maxProposals : failures.length;
        const classifications = failures.map(classifyFailure);
        const allProposals = failures.map((t, i) => proposeFix(t, classifications[i]));
        const proposals = allProposals.slice(0, cap);
        const byCategory = zeroCategoryMap();
        for (const c of classifications) {
            byCategory[c.category] += 1;
        }
        const byRisk = zeroRiskMap();
        for (const p of allProposals) {
            byRisk[p.riskLevel] += 1;
        }
        return {
            generatedAt: new Date().toISOString(),
            totalFailures: failures.length,
            classifications,
            proposals,
            summary: { byCategory, byRisk },
        };
    });
}
// ====== Subagent Spec ======
/**
 * Return the typed-subagent spec descriptor.
 * Can be registered with the SubagentSpawner runtime — do NOT register here,
 * just expose the descriptor.  Call is idempotent (returns a fresh plain object
 * each time; no mutable state).
 */
export function subagentSpec() {
    return {
        name: 'test-fixer',
        description: 'Classifies failing tests from a test-runner JSON report into well-known ' +
            'failure categories and proposes a structured fix plan without modifying ' +
            'any source files. The plan is consumed by downstream agents or humans.',
        inputSchema: {
            type: 'object',
            required: ['failures'],
            properties: {
                failures: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['id', 'filePath', 'name', 'errorMessage'],
                        properties: {
                            id: { type: 'string', description: 'Unique test identifier, e.g. "src/foo.test.ts > suite > case"' },
                            filePath: { type: 'string', description: 'Path to the test file' },
                            name: { type: 'string', description: 'Human-readable test name' },
                            errorMessage: { type: 'string', description: 'Primary error message from the test runner' },
                            errorStack: { type: 'string', description: 'Optional stack trace' },
                            durationMs: { type: 'number', description: 'Test execution duration in ms' },
                        },
                    },
                },
                repoRoot: { type: 'string', description: 'Repository root path — for context only' },
                maxProposals: { type: 'number', description: 'Maximum proposals to emit; default = failures.length' },
            },
        },
        outputSchema: {
            type: 'object',
            required: ['generatedAt', 'totalFailures', 'classifications', 'proposals', 'summary'],
            properties: {
                generatedAt: { type: 'string', format: 'date-time' },
                totalFailures: { type: 'number' },
                classifications: { type: 'array', items: { type: 'object' } },
                proposals: { type: 'array', items: { type: 'object' } },
                summary: {
                    type: 'object',
                    properties: {
                        byCategory: { type: 'object', additionalProperties: { type: 'number' } },
                        byRisk: { type: 'object', additionalProperties: { type: 'number' } },
                    },
                },
            },
        },
    };
}

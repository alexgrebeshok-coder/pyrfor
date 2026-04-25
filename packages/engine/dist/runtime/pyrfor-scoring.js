var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
const execAsync = promisify(exec);
// ─── computeScore ───────────────────────────────────────────────────────────
export function computeScore(inputs, opts) {
    var _a, _b;
    const threshold = (_a = opts === null || opts === void 0 ? void 0 : opts.threshold) !== null && _a !== void 0 ? _a : 80;
    // Tests: 40 pts
    let testsScore = 0;
    let testsDetail = '';
    if (!inputs.tests) {
        testsDetail = 'Tests: not provided';
    }
    else if ('skipped' in inputs.tests && inputs.tests.skipped) {
        testsDetail = `Tests: skipped${inputs.tests.reason ? ` (${inputs.tests.reason})` : ''}`;
    }
    else if ('passed' in inputs.tests && 'total' in inputs.tests) {
        const { passed, total } = inputs.tests;
        if (total === 0) {
            testsDetail = 'Tests: 0 total';
        }
        else {
            const fraction = passed / total;
            testsScore = Math.round(40 * fraction);
            testsDetail = `Tests: ${passed}/${total} passed`;
        }
    }
    // Build: 20 pts
    let buildScore = 0;
    let buildDetail = '';
    if (!inputs.build) {
        buildDetail = 'Build: not provided';
    }
    else {
        if (inputs.build.ok) {
            buildScore = 20;
            buildDetail = 'Build: success';
        }
        else {
            buildDetail = `Build: failed${inputs.build.reason ? ` (${inputs.build.reason})` : ''}`;
        }
    }
    // Lint: 20 pts
    let lintScore = 0;
    let lintDetail = '';
    if (!inputs.lint) {
        lintDetail = 'Lint: not provided';
    }
    else if ('skipped' in inputs.lint && inputs.lint.skipped) {
        lintDetail = `Lint: skipped${inputs.lint.reason ? ` (${inputs.lint.reason})` : ''}`;
    }
    else if ('errors' in inputs.lint && 'warnings' in inputs.lint) {
        const { errors, warnings } = inputs.lint;
        lintScore = Math.max(0, 20 - 4 * errors - 1 * warnings);
        lintDetail = `Lint: ${errors} error(s), ${warnings} warning(s)`;
    }
    // No-regress: 20 pts
    let noRegressScore = 0;
    let noRegressDetail = '';
    const regressedFiles = (_b = inputs.regressedFiles) !== null && _b !== void 0 ? _b : [];
    if (regressedFiles.length === 0) {
        noRegressScore = 20;
        noRegressDetail = 'No regressions';
    }
    else {
        noRegressScore = Math.max(0, 20 - 5 * regressedFiles.length);
        noRegressDetail = `${regressedFiles.length} regressed file(s)`;
    }
    const total = testsScore + buildScore + lintScore + noRegressScore;
    const passed = total >= threshold;
    return {
        tests: { score: testsScore, max: 40, detail: testsDetail },
        build: { score: buildScore, max: 20, detail: buildDetail },
        lint: { score: lintScore, max: 20, detail: lintDetail },
        noRegress: { score: noRegressScore, max: 20, detail: noRegressDetail },
        total,
        passed,
        threshold,
    };
}
// ─── Parsers ────────────────────────────────────────────────────────────────
function parseVitestJson(stdout) {
    const json = JSON.parse(stdout);
    if (typeof json.numTotalTests === 'number' && typeof json.numPassedTests === 'number') {
        return { passed: json.numPassedTests, total: json.numTotalTests };
    }
    if (Array.isArray(json.testResults)) {
        let total = 0;
        let passed = 0;
        for (const result of json.testResults) {
            if (Array.isArray(result.assertionResults)) {
                total += result.assertionResults.length;
                passed += result.assertionResults.filter((a) => a.status === 'passed').length;
            }
        }
        return { passed, total };
    }
    throw new Error('Unable to parse vitest JSON output');
}
function parseJestJson(stdout) {
    return parseVitestJson(stdout); // Same structure
}
function parseTap(stdout) {
    const lines = stdout.split('\n');
    let ok = 0;
    let notOk = 0;
    for (const line of lines) {
        if (/^ok\s+/.test(line))
            ok++;
        if (/^not ok\s+/.test(line))
            notOk++;
    }
    return { passed: ok, total: ok + notOk };
}
function parseSimpleCounts(stdout) {
    // Try patterns like "X passed, Y failed" or "X tests passed"
    const patterns = [
        /(\d+)\s+passed.*?(\d+)\s+failed/i,
        /(\d+)\s+tests?\s+passed/i,
        /(\d+)\/(\d+)\s+passed/i,
    ];
    for (const pattern of patterns) {
        const match = stdout.match(pattern);
        if (match) {
            if (pattern.source.includes('failed')) {
                const passed = parseInt(match[1], 10);
                const failed = parseInt(match[2], 10);
                return { passed, total: passed + failed };
            }
            else if (pattern.source.includes('/')) {
                const passed = parseInt(match[1], 10);
                const total = parseInt(match[2], 10);
                return { passed, total };
            }
            else {
                const passed = parseInt(match[1], 10);
                return { passed, total: passed };
            }
        }
    }
    throw new Error('Unable to parse test counts from output');
}
function parseEslintJson(stdout) {
    const json = JSON.parse(stdout);
    if (!Array.isArray(json)) {
        throw new Error('Expected ESLint JSON to be an array');
    }
    let errors = 0;
    let warnings = 0;
    for (const file of json) {
        if (Array.isArray(file.messages)) {
            for (const msg of file.messages) {
                if (msg.severity === 2)
                    errors++;
                if (msg.severity === 1)
                    warnings++;
            }
        }
    }
    return { errors, warnings };
}
function parseLintSimpleCounts(stdout) {
    // Try patterns like "X errors, Y warnings"
    const patterns = [
        /(\d+)\s+errors?.*?(\d+)\s+warnings?/i,
        /(\d+)\s+errors?/i,
        /(\d+)\s+warnings?/i,
    ];
    let errors = 0;
    let warnings = 0;
    for (const pattern of patterns) {
        const match = stdout.match(pattern);
        if (match) {
            if (pattern.source.includes('warnings')) {
                if (match[2]) {
                    errors = parseInt(match[1], 10);
                    warnings = parseInt(match[2], 10);
                    return { errors, warnings };
                }
                else {
                    warnings = parseInt(match[1], 10);
                }
            }
            else {
                errors = parseInt(match[1], 10);
            }
        }
    }
    if (errors === 0 && warnings === 0) {
        throw new Error('Unable to parse lint counts from output');
    }
    return { errors, warnings };
}
// ─── Default exec function ──────────────────────────────────────────────────
function defaultExecFn(cmd, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const { stdout, stderr } = yield execAsync(cmd, {
                cwd: opts.cwd,
                timeout: opts.timeoutSec * 1000,
                maxBuffer: 10 * 1024 * 1024, // 10MB
            });
            return { stdout, stderr, exitCode: 0 };
        }
        catch (err) {
            // exec throws on non-zero exit code
            return {
                stdout: err.stdout || '',
                stderr: err.stderr || '',
                exitCode: (_a = err.code) !== null && _a !== void 0 ? _a : 1,
            };
        }
    });
}
// ─── scoreWorkdir ───────────────────────────────────────────────────────────
export function scoreWorkdir(opts) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const execFn = (_a = opts.execFn) !== null && _a !== void 0 ? _a : defaultExecFn;
        const timeoutSec = (_b = opts.timeoutSec) !== null && _b !== void 0 ? _b : 600;
        const inputs = {};
        // Tests
        if (opts.testCommand) {
            try {
                const result = yield execFn(opts.testCommand, { cwd: opts.workdir, timeoutSec });
                const parser = (_c = opts.testParser) !== null && _c !== void 0 ? _c : 'vitest-json';
                if (typeof parser === 'function') {
                    inputs.tests = parser(result.stdout, result.exitCode);
                }
                else {
                    switch (parser) {
                        case 'vitest-json':
                            inputs.tests = parseVitestJson(result.stdout);
                            break;
                        case 'jest-json':
                            inputs.tests = parseJestJson(result.stdout);
                            break;
                        case 'tap':
                            inputs.tests = parseTap(result.stdout);
                            break;
                        case 'simple-counts':
                            inputs.tests = parseSimpleCounts(result.stdout);
                            break;
                    }
                }
                // Validate the result
                if (inputs.tests && 'passed' in inputs.tests) {
                    if (isNaN(inputs.tests.passed) || isNaN(inputs.tests.total)) {
                        inputs.tests = { skipped: true, reason: 'Parser returned NaN' };
                    }
                }
            }
            catch (err) {
                inputs.tests = { skipped: true, reason: err.message };
            }
        }
        else {
            inputs.tests = { skipped: true, reason: 'No test command provided' };
        }
        // Build
        if (opts.buildCommand) {
            try {
                const result = yield execFn(opts.buildCommand, { cwd: opts.workdir, timeoutSec });
                inputs.build = { ok: result.exitCode === 0 };
                if (result.exitCode !== 0) {
                    inputs.build.reason = 'Non-zero exit code';
                }
            }
            catch (err) {
                inputs.build = { ok: false, reason: err.message };
            }
        }
        // Lint
        if (opts.lintCommand) {
            try {
                const result = yield execFn(opts.lintCommand, { cwd: opts.workdir, timeoutSec });
                const parser = (_d = opts.lintParser) !== null && _d !== void 0 ? _d : 'eslint-json';
                if (typeof parser === 'function') {
                    inputs.lint = parser(result.stdout, result.exitCode);
                }
                else {
                    switch (parser) {
                        case 'eslint-json':
                            inputs.lint = parseEslintJson(result.stdout);
                            break;
                        case 'simple-counts':
                            inputs.lint = parseLintSimpleCounts(result.stdout);
                            break;
                    }
                }
                // Validate the result
                if (inputs.lint && 'errors' in inputs.lint) {
                    if (isNaN(inputs.lint.errors) || isNaN(inputs.lint.warnings)) {
                        inputs.lint = { skipped: true, reason: 'Parser returned NaN' };
                    }
                }
            }
            catch (err) {
                inputs.lint = { skipped: true, reason: err.message };
            }
        }
        // Regressions
        if (opts.currentFailures && opts.baselineFailures) {
            const baseline = new Set(opts.baselineFailures);
            const current = new Set(opts.currentFailures);
            inputs.regressedFiles = Array.from(current).filter(f => !baseline.has(f));
        }
        else if (opts.currentFailures) {
            inputs.regressedFiles = opts.currentFailures;
        }
        return computeScore(inputs, { threshold: opts.threshold });
    });
}

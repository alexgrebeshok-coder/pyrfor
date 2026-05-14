var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { runVerify } from '../verify-engine.js';
import { aggregateQuorum, runCriticEnsemble, } from './critic.js';
export class TestSuiteValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TestSuiteValidationError';
    }
}
export class AcceptanceTester {
    constructor(deps) {
        var _a, _b;
        this.deps = deps;
        this.maxReworkCycles = (_a = deps.maxReworkCycles) !== null && _a !== void 0 ? _a : 2;
        if (!Number.isInteger(this.maxReworkCycles) || this.maxReworkCycles < 0) {
            throw new TestSuiteValidationError('maxReworkCycles must be a non-negative integer');
        }
        this.clock = (_b = deps.clock) !== null && _b !== void 0 ? _b : Date.now;
    }
    run(suite_1) {
        return __awaiter(this, arguments, void 0, function* (suite, reworkCycle = 0) {
            var _a;
            validateTestSuite(suite);
            if (!Number.isInteger(reworkCycle) || reworkCycle < 0) {
                throw new TestSuiteValidationError('reworkCycle must be a non-negative integer');
            }
            const thresholdScore = (_a = suite.thresholdScore) !== null && _a !== void 0 ? _a : 80;
            const verifyResult = yield runVerify(checksToVerifyChecks(suite.checks, suite.timeoutMs), {
                cwd: suite.workdir,
                threshold: thresholdScore,
            });
            const executableVerdict = deriveVerdict(verifyResult, suite.checks);
            const criticReport = yield this.runOptionalCritic(suite, verifyResult, executableVerdict);
            const verdict = criticReport
                ? aggregateQuorum([executableResult(executableVerdict), ...criticReport.results])
                : executableVerdict;
            const status = acceptanceStatus(verdict);
            const body = Object.assign(Object.assign({ suiteId: suite.suiteId, conceptId: suite.conceptId, runId: suite.runId, subjectId: suite.subjectId, verdict,
                status, score: verifyResult.total, thresholdScore, checkResults: verifyResult.checks }, (criticReport ? { criticReport } : {})), { reworkCycle, testedAt: new Date(this.clock()).toISOString() });
            const artifactRef = yield this.deps.artifactStore.writeJSON('test_result', body, {
                runId: suite.runId,
                meta: {
                    suiteId: suite.suiteId,
                    conceptId: suite.conceptId,
                    subjectId: suite.subjectId,
                    verdict,
                    status,
                },
            });
            yield this.deps.ledger.append({
                type: 'test.completed',
                run_id: suite.runId,
                passed: verifyResult.checks.filter((check) => check.passed).length,
                failed: verifyResult.checks.filter((check) => !check.passed).length,
                skipped: 0,
                ms: verifyResult.checks.reduce((sum, check) => sum + check.durationMs, 0),
                status: verdict === 'pass' ? 'passed' : 'failed',
            });
            return Object.assign(Object.assign({}, body), { artifactId: artifactRef.id, artifactRef });
        });
    }
    runWithRework(suite, regenerateSuite) {
        return __awaiter(this, void 0, void 0, function* () {
            let currentSuite = suite;
            for (let cycle = 0; cycle <= this.maxReworkCycles; cycle += 1) {
                const report = yield this.run(currentSuite, cycle);
                if (report.verdict !== 'rework' || cycle === this.maxReworkCycles)
                    return report;
                if (!regenerateSuite)
                    return report;
                currentSuite = regenerateSuite ? yield regenerateSuite(report) : currentSuite;
            }
            throw new Error('AcceptanceTester: unreachable rework loop state');
        });
    }
    runOptionalCritic(suite, verifyResult, executableVerdict) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.deps.criticConfig)
                return undefined;
            const runners = new Map((_a = this.deps.criticRunners) !== null && _a !== void 0 ? _a : []);
            for (const verifier of this.deps.criticConfig.verifiers) {
                if (verifier.kind !== 'executable' || runners.has(verifier.id))
                    continue;
                runners.set(verifier.id, () => __awaiter(this, void 0, void 0, function* () {
                    return ({
                        verdict: executableVerdict,
                        rationale: `Executable acceptance score ${verifyResult.total}/${verifyResult.threshold} for suite ${suite.suiteId}`,
                    });
                }));
            }
            return runCriticEnsemble(this.deps.criticConfig, {
                artifactRef: suite.subjectId,
                specSummary: suite.checks.map((check) => `${check.id}: ${check.label}`).join('\n'),
                contextHint: `acceptance-suite:${suite.suiteId}`,
            }, runners);
        });
    }
}
export function validateTestSuite(suite) {
    if (!suite.suiteId.trim())
        throw new TestSuiteValidationError('suiteId is required');
    if (!suite.conceptId.trim())
        throw new TestSuiteValidationError('conceptId is required');
    if (!suite.runId.trim())
        throw new TestSuiteValidationError('runId is required');
    if (!suite.subjectId.trim())
        throw new TestSuiteValidationError('subjectId is required');
    if (!suite.workdir.trim())
        throw new TestSuiteValidationError('workdir is required');
    if (suite.checks.length === 0)
        throw new TestSuiteValidationError('at least one acceptance check is required');
    if (suite.thresholdScore !== undefined && (suite.thresholdScore < 0 || suite.thresholdScore > 100)) {
        throw new TestSuiteValidationError('thresholdScore must be between 0 and 100');
    }
    const seen = new Set();
    let totalWeight = 0;
    for (const check of suite.checks) {
        if (!check.id.trim())
            throw new TestSuiteValidationError('acceptance check id is required');
        if (seen.has(check.id))
            throw new TestSuiteValidationError(`duplicate acceptance check id: ${check.id}`);
        seen.add(check.id);
        if (!check.label.trim())
            throw new TestSuiteValidationError(`acceptance check label is required: ${check.id}`);
        if (!check.verifyCheck.command.trim())
            throw new TestSuiteValidationError(`acceptance check command is required: ${check.id}`);
        if (!Number.isFinite(check.weight) || check.weight <= 0) {
            throw new TestSuiteValidationError(`acceptance check weight must be positive: ${check.id}`);
        }
        totalWeight += check.weight;
    }
    if (Math.abs(totalWeight - 100) > Number.EPSILON) {
        throw new TestSuiteValidationError(`acceptance check weights must sum to 100, got ${totalWeight}`);
    }
}
export function checksToVerifyChecks(checks, defaultTimeoutMs) {
    return checks.map((check) => {
        var _a;
        return (Object.assign(Object.assign({}, check.verifyCheck), { name: check.verifyCheck.name || check.id, weight: check.weight, timeoutMs: (_a = check.verifyCheck.timeoutMs) !== null && _a !== void 0 ? _a : defaultTimeoutMs }));
    });
}
export function deriveVerdict(result, checks) {
    var _a;
    for (let index = 0; index < checks.length; index += 1) {
        if (checks[index].criticalOnFailure && !((_a = result.checks[index]) === null || _a === void 0 ? void 0 : _a.passed))
            return 'block';
    }
    return result.passed ? 'pass' : 'rework';
}
function executableResult(verdict) {
    return {
        verifierId: 'acceptance-executable',
        family: 'executable',
        kind: 'executable',
        verdict,
        rationale: `Executable acceptance verdict: ${verdict}`,
        durationMs: 0,
    };
}
function acceptanceStatus(verdict) {
    if (verdict === 'pass')
        return 'passed';
    if (verdict === 'block')
        return 'blocked';
    return 'needs_rework';
}

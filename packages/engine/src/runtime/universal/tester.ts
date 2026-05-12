import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import { runVerify, type VerifyCheck, type VerifyCheckResult, type VerifyResult } from '../verify-engine';
import {
  aggregateQuorum,
  runCriticEnsemble,
  type CriticReport,
  type EnsembleConfig,
  type VerifierResult,
  type VerifierRunner,
  type VerifierVerdict,
} from './critic';

export interface AcceptanceCheck {
  id: string;
  label: string;
  verifyCheck: VerifyCheck;
  weight: number;
  criticalOnFailure?: boolean;
}

export interface AcceptanceTestSuite {
  suiteId: string;
  conceptId: string;
  runId: string;
  subjectId: string;
  checks: AcceptanceCheck[];
  workdir: string;
  thresholdScore?: number;
  timeoutMs?: number;
}

export interface AcceptanceReport {
  suiteId: string;
  conceptId: string;
  runId: string;
  subjectId: string;
  verdict: VerifierVerdict;
  status: 'passed' | 'needs_rework' | 'blocked';
  score: number;
  thresholdScore: number;
  checkResults: VerifyCheckResult[];
  criticReport?: CriticReport;
  artifactId: string;
  artifactRef: ArtifactRef;
  reworkCycle: number;
  testedAt: string;
}

export interface AcceptanceTesterDeps {
  artifactStore: ArtifactStore;
  ledger: EventLedger;
  criticConfig?: EnsembleConfig;
  criticRunners?: ReadonlyMap<string, VerifierRunner>;
  maxReworkCycles?: number;
  clock?: () => number;
}

interface AcceptanceReportBody extends Omit<AcceptanceReport, 'artifactId' | 'artifactRef'> {}

export class TestSuiteValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestSuiteValidationError';
  }
}

export class AcceptanceTester {
  private readonly maxReworkCycles: number;
  private readonly clock: () => number;

  constructor(private readonly deps: AcceptanceTesterDeps) {
    this.maxReworkCycles = deps.maxReworkCycles ?? 2;
    if (!Number.isInteger(this.maxReworkCycles) || this.maxReworkCycles < 0) {
      throw new TestSuiteValidationError('maxReworkCycles must be a non-negative integer');
    }
    this.clock = deps.clock ?? Date.now;
  }

  async run(suite: AcceptanceTestSuite, reworkCycle = 0): Promise<AcceptanceReport> {
    validateTestSuite(suite);
    if (!Number.isInteger(reworkCycle) || reworkCycle < 0) {
      throw new TestSuiteValidationError('reworkCycle must be a non-negative integer');
    }

    const thresholdScore = suite.thresholdScore ?? 80;
    const verifyResult = await runVerify(checksToVerifyChecks(suite.checks, suite.timeoutMs), {
      cwd: suite.workdir,
      threshold: thresholdScore,
    });
    const executableVerdict = deriveVerdict(verifyResult, suite.checks);
    const criticReport = await this.runOptionalCritic(suite, verifyResult, executableVerdict);
    const verdict = criticReport
      ? aggregateQuorum([executableResult(executableVerdict), ...criticReport.results])
      : executableVerdict;
    const status = acceptanceStatus(verdict);

    const body: AcceptanceReportBody = {
      suiteId: suite.suiteId,
      conceptId: suite.conceptId,
      runId: suite.runId,
      subjectId: suite.subjectId,
      verdict,
      status,
      score: verifyResult.total,
      thresholdScore,
      checkResults: verifyResult.checks,
      ...(criticReport ? { criticReport } : {}),
      reworkCycle,
      testedAt: new Date(this.clock()).toISOString(),
    };
    const artifactRef = await this.deps.artifactStore.writeJSON('test_result', body, {
      runId: suite.runId,
      meta: {
        suiteId: suite.suiteId,
        conceptId: suite.conceptId,
        subjectId: suite.subjectId,
        verdict,
        status,
      },
    });

    await this.deps.ledger.append({
      type: 'test.completed',
      run_id: suite.runId,
      passed: verifyResult.checks.filter((check) => check.passed).length,
      failed: verifyResult.checks.filter((check) => !check.passed).length,
      skipped: 0,
      ms: verifyResult.checks.reduce((sum, check) => sum + check.durationMs, 0),
      status: verdict === 'pass' ? 'passed' : 'failed',
    });

    return {
      ...body,
      artifactId: artifactRef.id,
      artifactRef,
    };
  }

  async runWithRework(
    suite: AcceptanceTestSuite,
    regenerateSuite?: (report: AcceptanceReport) => Promise<AcceptanceTestSuite>,
  ): Promise<AcceptanceReport> {
    let currentSuite = suite;
    for (let cycle = 0; cycle <= this.maxReworkCycles; cycle += 1) {
      const report = await this.run(currentSuite, cycle);
      if (report.verdict !== 'rework' || cycle === this.maxReworkCycles) return report;
      if (!regenerateSuite) return report;
      currentSuite = regenerateSuite ? await regenerateSuite(report) : currentSuite;
    }
    throw new Error('AcceptanceTester: unreachable rework loop state');
  }

  private async runOptionalCritic(
    suite: AcceptanceTestSuite,
    verifyResult: VerifyResult,
    executableVerdict: VerifierVerdict,
  ): Promise<CriticReport | undefined> {
    if (!this.deps.criticConfig) return undefined;
    const runners = new Map(this.deps.criticRunners ?? []);
    for (const verifier of this.deps.criticConfig.verifiers) {
      if (verifier.kind !== 'executable' || runners.has(verifier.id)) continue;
      runners.set(verifier.id, async () => ({
        verdict: executableVerdict,
        rationale: `Executable acceptance score ${verifyResult.total}/${verifyResult.threshold} for suite ${suite.suiteId}`,
      }));
    }
    return runCriticEnsemble(
      this.deps.criticConfig,
      {
        artifactRef: suite.subjectId,
        specSummary: suite.checks.map((check) => `${check.id}: ${check.label}`).join('\n'),
        contextHint: `acceptance-suite:${suite.suiteId}`,
      },
      runners,
    );
  }
}

export function validateTestSuite(suite: AcceptanceTestSuite): void {
  if (!suite.suiteId.trim()) throw new TestSuiteValidationError('suiteId is required');
  if (!suite.conceptId.trim()) throw new TestSuiteValidationError('conceptId is required');
  if (!suite.runId.trim()) throw new TestSuiteValidationError('runId is required');
  if (!suite.subjectId.trim()) throw new TestSuiteValidationError('subjectId is required');
  if (!suite.workdir.trim()) throw new TestSuiteValidationError('workdir is required');
  if (suite.checks.length === 0) throw new TestSuiteValidationError('at least one acceptance check is required');
  if (suite.thresholdScore !== undefined && (suite.thresholdScore < 0 || suite.thresholdScore > 100)) {
    throw new TestSuiteValidationError('thresholdScore must be between 0 and 100');
  }

  const seen = new Set<string>();
  let totalWeight = 0;
  for (const check of suite.checks) {
    if (!check.id.trim()) throw new TestSuiteValidationError('acceptance check id is required');
    if (seen.has(check.id)) throw new TestSuiteValidationError(`duplicate acceptance check id: ${check.id}`);
    seen.add(check.id);
    if (!check.label.trim()) throw new TestSuiteValidationError(`acceptance check label is required: ${check.id}`);
    if (!check.verifyCheck.command.trim()) throw new TestSuiteValidationError(`acceptance check command is required: ${check.id}`);
    if (!Number.isFinite(check.weight) || check.weight <= 0) {
      throw new TestSuiteValidationError(`acceptance check weight must be positive: ${check.id}`);
    }
    totalWeight += check.weight;
  }
  if (Math.abs(totalWeight - 100) > Number.EPSILON) {
    throw new TestSuiteValidationError(`acceptance check weights must sum to 100, got ${totalWeight}`);
  }
}

export function checksToVerifyChecks(checks: AcceptanceCheck[], defaultTimeoutMs?: number): VerifyCheck[] {
  return checks.map((check) => ({
    ...check.verifyCheck,
    name: check.verifyCheck.name || check.id,
    weight: check.weight,
    timeoutMs: check.verifyCheck.timeoutMs ?? defaultTimeoutMs,
  }));
}

export function deriveVerdict(result: VerifyResult, checks: AcceptanceCheck[]): VerifierVerdict {
  for (let index = 0; index < checks.length; index += 1) {
    if (checks[index]!.criticalOnFailure && !result.checks[index]?.passed) return 'block';
  }
  return result.passed ? 'pass' : 'rework';
}

function executableResult(verdict: VerifierVerdict): VerifierResult {
  return {
    verifierId: 'acceptance-executable',
    family: 'executable',
    kind: 'executable',
    verdict,
    rationale: `Executable acceptance verdict: ${verdict}`,
    durationMs: 0,
  };
}

function acceptanceStatus(verdict: VerifierVerdict): AcceptanceReport['status'] {
  if (verdict === 'pass') return 'passed';
  if (verdict === 'block') return 'blocked';
  return 'needs_rework';
}

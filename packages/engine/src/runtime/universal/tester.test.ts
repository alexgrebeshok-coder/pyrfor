import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../artifact-model';
import { EventLedger } from '../event-ledger';
import type { VerifyResult } from '../verify-engine';
import { executableVerifier, llmVerifier, type VerifierRunner } from './critic';
import {
  AcceptanceTester,
  checksToVerifyChecks,
  deriveVerdict,
  TestSuiteValidationError,
  validateTestSuite,
  type AcceptanceCheck,
  type AcceptanceTestSuite,
} from './tester';

describe('AcceptanceTester M12', () => {
  let dir: string;
  let artifactStore: ArtifactStore;
  let ledger: EventLedger;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-acceptance-tester-'));
    artifactStore = new ArtifactStore({ rootDir: path.join(dir, 'artifacts') });
    ledger = new EventLedger(path.join(dir, 'ledger.jsonl'));
  });

  afterEach(async () => {
    await ledger.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates suite shape and weights', () => {
    expect(() => validateTestSuite(suite({ checks: [] }))).toThrow(TestSuiteValidationError);
    expect(() => validateTestSuite(suite({
      checks: [check({ id: 'a', weight: 60 }), check({ id: 'b', weight: 30 })],
    }))).toThrow(/sum to 100/);
    expect(() => validateTestSuite(suite({
      checks: [check({ id: 'dup', weight: 50 }), check({ id: 'dup', weight: 50 })],
    }))).toThrow(/duplicate/);
    expect(() => validateTestSuite(suite())).not.toThrow();
  });

  it('maps acceptance checks into executable verify checks', () => {
    const [mapped] = checksToVerifyChecks([check({
      id: 'criterion-1',
      weight: 100,
      verifyCheck: { name: '', command: 'exit 0', weight: 1 },
    })], 1234);

    expect(mapped).toMatchObject({
      name: 'criterion-1',
      command: 'exit 0',
      weight: 100,
      timeoutMs: 1234,
    });
  });

  it('derives pass, rework, and block verdicts from executable results', () => {
    expect(deriveVerdict(verifyResult({ passed: true, total: 100 }), [check()])).toBe('pass');
    expect(deriveVerdict(verifyResult({ passed: false, total: 50 }), [check()])).toBe('rework');
    expect(deriveVerdict(verifyResult({ passed: false, total: 0, checkPassed: false }), [
      check({ criticalOnFailure: true }),
    ])).toBe('block');
  });

  it('runs executable checks, writes a test_result artifact, and emits test.completed', async () => {
    const tester = new AcceptanceTester({ artifactStore, ledger, clock: () => 0 });

    const report = await tester.run(suite());

    expect(report).toMatchObject({
      verdict: 'pass',
      status: 'passed',
      score: 100,
      thresholdScore: 80,
      artifactRef: { kind: 'test_result', runId: 'run-1' },
      testedAt: '1970-01-01T00:00:00.000Z',
    });
    expect(report.checkResults[0]?.passed).toBe(true);
    expect((await ledger.readAll()).map((event) => event.type)).toEqual(['test.completed']);
    expect((await ledger.readAll())[0]).toMatchObject({ status: 'passed', passed: 1, failed: 0 });
  });

  it('returns rework when executable score is below threshold', async () => {
    const tester = new AcceptanceTester({ artifactStore, ledger });

    const report = await tester.run(suite({
      checks: [check({ verifyCheck: { name: 'fail', command: 'exit 1', weight: 100 } })],
    }));

    expect(report.verdict).toBe('rework');
    expect(report.status).toBe('needs_rework');
    expect(report.score).toBe(0);
    expect((await ledger.readAll())[0]).toMatchObject({ status: 'failed', passed: 0, failed: 1 });
  });

  it('returns block when a critical executable check fails', async () => {
    const tester = new AcceptanceTester({ artifactStore, ledger });

    const report = await tester.run(suite({
      checks: [check({
        criticalOnFailure: true,
        verifyCheck: { name: 'critical', command: 'exit 1', weight: 100 },
      })],
    }));

    expect(report.verdict).toBe('block');
    expect(report.status).toBe('blocked');
  });

  it('runs critic ensemble and lets critic block override executable rework', async () => {
    const tester = new AcceptanceTester({
      artifactStore,
      ledger,
      criticConfig: {
        coderFamily: 'openai',
        verifiers: [
          executableVerifier('acceptance-runner'),
          llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
        ],
      },
      criticRunners: new Map<string, VerifierRunner>([
        ['anthropic-judge', async () => ({ verdict: 'block', rationale: 'security issue remains' })],
      ]),
    });

    const report = await tester.run(suite({
      checks: [check({ verifyCheck: { name: 'fail', command: 'exit 1', weight: 100 } })],
    }));

    expect(report.verdict).toBe('block');
    expect(report.criticReport?.aggregateVerdict).toBe('block');
  });

  it('runs a bounded rework loop and stops on pass', async () => {
    const tester = new AcceptanceTester({ artifactStore, ledger, maxReworkCycles: 2 });

    const report = await tester.runWithRework(
      suite({ checks: [check({ verifyCheck: { name: 'fail', command: 'exit 1', weight: 100 } })] }),
      async () => suite({ checks: [check({ verifyCheck: { name: 'pass', command: 'exit 0', weight: 100 } })] }),
    );

    expect(report.verdict).toBe('pass');
    expect(report.reworkCycle).toBe(1);
    expect(await ledger.readAll()).toHaveLength(2);
  });

  it('does not rerun a rework suite without regeneration and stops immediately on block', async () => {
    const retrying = new AcceptanceTester({ artifactStore, ledger, maxReworkCycles: 1 });

    const rework = await retrying.runWithRework(suite({
      checks: [check({ verifyCheck: { name: 'fail', command: 'exit 1', weight: 100 } })],
    }));
    expect(rework).toMatchObject({ verdict: 'rework', reworkCycle: 0 });

    const blocking = new AcceptanceTester({ artifactStore, ledger, maxReworkCycles: 3 });
    const block = await blocking.runWithRework(suite({
      suiteId: 'suite-block',
      checks: [check({
        criticalOnFailure: true,
        verifyCheck: { name: 'critical', command: 'exit 1', weight: 100 },
      })],
    }));
    expect(block).toMatchObject({ verdict: 'block', reworkCycle: 0 });
  });

  it('stops bounded rework at maxReworkCycles when regenerated suites keep failing', async () => {
    const tester = new AcceptanceTester({ artifactStore, ledger, maxReworkCycles: 1 });

    const rework = await tester.runWithRework(
      suite({ checks: [check({ verifyCheck: { name: 'fail-a', command: 'exit 1', weight: 100 } })] }),
      async () => suite({
        suiteId: 'suite-fail-b',
        checks: [check({ verifyCheck: { name: 'fail-b', command: 'exit 1', weight: 100 } })],
      }),
    );

    expect(rework).toMatchObject({ verdict: 'rework', reworkCycle: 1 });
  });
});

function suite(overrides: Partial<AcceptanceTestSuite> = {}): AcceptanceTestSuite {
  return {
    suiteId: 'suite-1',
    conceptId: 'concept-1',
    runId: 'run-1',
    subjectId: 'subject-1',
    checks: [check()],
    workdir: process.cwd(),
    ...overrides,
  };
}

function check(overrides: Partial<AcceptanceCheck> = {}): AcceptanceCheck {
  return {
    id: 'check-1',
    label: 'basic acceptance passes',
    weight: 100,
    verifyCheck: { name: 'basic', command: 'exit 0', weight: 100 },
    ...overrides,
  };
}

function verifyResult(overrides: { passed: boolean; total: number; checkPassed?: boolean }): VerifyResult {
  return {
    total: overrides.total,
    threshold: 80,
    passed: overrides.passed,
    ts: 0,
    checks: [{
      name: 'check-1',
      passed: overrides.checkPassed ?? overrides.passed,
      score: overrides.total,
      stdout: '',
      stderr: '',
      exitCode: overrides.passed ? 0 : 1,
      durationMs: 1,
    }],
  };
}

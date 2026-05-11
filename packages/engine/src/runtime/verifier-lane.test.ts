// @vitest-environment node

import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EventLedger, makeEvent } from './event-ledger';
import { RunLedger } from './run-ledger';
import { createSessionReplayer } from './session-replay';
import { VerifierLane, runOrchestrationEvalSuite } from './verifier-lane';
import type { StepValidator, ValidatorResult } from './step-validator';
import {
  EnsembleDiversityError,
  executableVerifier,
  llmVerifier,
  type VerifierRunner,
} from './universal/critic';

function tmpDir(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `verifier-lane-test-${hex}`);
}

function tmpLedgerPath(root = tmpDir()): string {
  return path.join(root, 'events.jsonl');
}

function validator(name: string, result: ValidatorResult): StepValidator {
  return {
    name,
    appliesTo: () => true,
    validate: async () => result,
  };
}

describe('VerifierLane', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('passes when all validators pass and appends verifier/test events', async () => {
    const root = tmpDir();
    const ledgerPath = tmpLedgerPath(root);
    cleanupDirs.push(root);
    const ledger = new EventLedger(ledgerPath);
    const lane = new VerifierLane({
      ledger,
      validators: [validator('unit', { validator: 'unit', verdict: 'pass', message: 'ok', durationMs: 3 })],
    });

    const report = await lane.verify(
      {
        runId: 'run-1',
        subjectId: 'artifact-1',
        subjectType: 'artifact',
        event: { sessionId: 's', type: 'terminal', data: {}, ts: 1 },
      },
      { cwd: process.cwd() },
    );

    expect(report.status).toBe('passed');
    const events = await ledger.byRun('run-1');
    expect(events.map((event) => event.type)).toEqual([
      'verifier.started',
      'verifier.completed',
      'test.completed',
    ]);
    await ledger.close();
  });

  it('creates a child verifier run with replay artifact, DAG, and blocked terminal state', async () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const ledger = new EventLedger(tmpLedgerPath(root));
    const runLedger = new RunLedger({ ledger });
    const replayStoreDir = path.join(root, 'replays');
    const lane = new VerifierLane({
      ledger,
      runLedger,
      replayStoreDir,
      dagStorePath: path.join(root, 'dag.json'),
      validators: [
        validator('policy', {
          validator: 'policy',
          verdict: 'block',
          message: 'policy violation',
          durationMs: 1,
        }),
      ],
    });

    const result = await lane.run({
      parentRunId: 'parent-run',
      verifierRunId: 'verifier-run',
      acpEvents: [{ sessionId: 's', type: 'diff', data: { path: 'src/app.ts' }, ts: 1 }],
      cwd: process.cwd(),
      workspaceId: 'workspace-1',
      repoId: 'repo-1',
    });

    expect(result.status).toBe('blocked');
    expect(result.reconstructedRun?.parent_run_id).toBe('parent-run');
    expect(result.reconstructedRun?.status).toBe('blocked');
    expect(result.reconstructedRun?.artifact_refs).toEqual([result.replayArtifactRef]);
    expect(result.dagNodes.find((node) => node.id === 'replay')?.status).toBe('succeeded');
    expect(result.dagNodes.find((node) => node.id === 'eval')?.status).toBe('failed');

    const replayEvents = createSessionReplayer({ storeDir: replayStoreDir }).loadSession('verifier-run');
    expect(replayEvents.some((event) => event.kind === 'meta' && event.payload['kind'] === 'acp_event')).toBe(true);

    const events = await ledger.byRun('verifier-run');
    expect(events.find((event) => event.type === 'run.created')?.parent_run_id).toBe('parent-run');
    expect(events.map((event) => event.type)).toContain('artifact.created');
    expect(events.map((event) => event.type)).toContain('dag.node.started');
    expect(events.map((event) => event.type)).toContain('verifier.completed');
    expect(events.map((event) => event.type)).toContain('run.blocked');
    await ledger.close();
  });

  it('returns failed when a validator asks for correction', async () => {
    const lane = new VerifierLane({
      validators: [
        validator('acceptance', {
          validator: 'acceptance',
          verdict: 'correct',
          message: 'acceptance criterion missing',
          remediation: 'add a test',
          durationMs: 1,
        }),
      ],
    });

    const report = await lane.verify(
      {
        runId: 'run-1',
        subjectId: 'artifact-1',
        subjectType: 'artifact',
        event: { sessionId: 's', type: 'diff', data: {}, ts: 1 },
      },
      { cwd: process.cwd() },
    );

    expect(report.status).toBe('failed');
    expect(report.gateDecision.action).toBe('inject_correction');
  });

  it('blocks when a validator blocks', async () => {
    const lane = new VerifierLane({
      validators: [
        validator('policy', {
          validator: 'policy',
          verdict: 'block',
          message: 'policy violation',
          durationMs: 1,
        }),
      ],
    });

    const report = await lane.verify(
      {
        runId: 'run-1',
        subjectId: 'artifact-1',
        subjectType: 'artifact',
        event: { sessionId: 's', type: 'diff', data: {}, ts: 1 },
      },
      { cwd: process.cwd() },
    );

    expect(report.status).toBe('blocked');
  });

  it('rejects verifier ensembles where every verifier shares the coder family', () => {
    expect(() => new VerifierLane({
      criticEnsemble: {
        coderFamily: 'openai',
        requireExecutable: false,
        verifiers: [
          llmVerifier('gpt-judge-a', 'gpt-5.4'),
          llmVerifier('gpt-judge-b', 'gpt-5.4-mini'),
        ],
      },
    })).toThrow(EnsembleDiversityError);
  });

  it('rejects verifier ensembles without registered runners', () => {
    expect(() => new VerifierLane({
      criticEnsemble: {
        coderFamily: 'openai',
        verifiers: [
          llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
          executableVerifier('test-runner'),
        ],
      },
    })).toThrow(/criticRunners/);
  });

  it('passes only when the critic ensemble quorum passes with family diversity', async () => {
    const lane = new VerifierLane({
      validators: [validator('schema', { validator: 'schema', verdict: 'pass', message: 'ok', durationMs: 1 })],
      criticEnsemble: {
        coderFamily: 'openai',
        verifiers: [
          llmVerifier('anthropic-judge', 'claude-sonnet-4.6'),
          executableVerifier('test-runner'),
        ],
      },
      criticRunners: new Map<string, VerifierRunner>([
        ['anthropic-judge', async () => ({ verdict: 'pass', rationale: 'independent review passed' })],
        ['test-runner', async () => ({ verdict: 'pass', rationale: 'tests passed' })],
      ]),
    });

    const report = await lane.verify(
      {
        runId: 'run-1',
        subjectId: 'artifact-1',
        subjectType: 'artifact',
        event: { sessionId: 's', type: 'diff', data: {}, ts: 1 },
      },
      { cwd: process.cwd() },
    );

    expect(report.status).toBe('passed');
    expect(report.criticReport?.aggregateVerdict).toBe('pass');
    expect(report.results.map((result) => result.validator)).toContain('critic-ensemble');
  });

  it('fails verification when the critic ensemble requests rework', async () => {
    const lane = new VerifierLane({
      criticEnsemble: {
        coderFamily: 'anthropic',
        verifiers: [
          llmVerifier('openai-judge', 'gpt-5.4'),
          executableVerifier('test-runner'),
        ],
      },
      criticRunners: new Map<string, VerifierRunner>([
        ['openai-judge', async () => ({ verdict: 'rework', rationale: 'missing edge case' })],
        ['test-runner', async () => ({ verdict: 'pass', rationale: 'tests passed' })],
      ]),
    });

    const report = await lane.verify(
      {
        runId: 'run-1',
        subjectId: 'artifact-1',
        subjectType: 'artifact',
        event: { sessionId: 's', type: 'diff', data: {}, ts: 1 },
      },
      { cwd: process.cwd() },
    );

    expect(report.status).toBe('failed');
    expect(report.gateDecision.action).toBe('inject_correction');
    expect(report.criticReport?.aggregateVerdict).toBe('rework');
  });
});

describe('runOrchestrationEvalSuite', () => {
  it('runs deterministic ledger invariant checks', async () => {
    const result = await runOrchestrationEvalSuite('ledger-invariants', [
      {
        name: 'run has completion',
        runId: 'run-1',
        events: [
          makeEvent({ type: 'run.created', run_id: 'run-1' }),
          makeEvent({ type: 'run.completed', run_id: 'run-1' }),
        ],
        assertions: [
          {
            name: 'contains run.completed',
            check: (events) => events.some((event) => event.type === 'run.completed'),
          },
        ],
      },
      {
        name: 'run missing verifier',
        runId: 'run-2',
        events: [makeEvent({ type: 'run.created', run_id: 'run-2' })],
        assertions: [
          {
            name: 'contains verifier.completed',
            check: (events) => events.some((event) => event.type === 'verifier.completed'),
          },
        ],
      },
    ]);

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.cases[1].failures).toEqual(['contains verifier.completed']);
  });
});

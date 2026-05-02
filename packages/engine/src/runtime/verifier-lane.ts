/**
 * verifier-lane.ts - independent verifier and deterministic eval harness.
 *
 * Worker self-reports are inputs. This lane owns the verdict that decides
 * pass/rework/block/user-review for orchestration.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AcpEvent } from './acp-client.js';
import { DurableDag, type DagNode } from './durable-dag';
import { EventLedger, type LedgerEvent } from './event-ledger';
import {
  createQualityGate,
  type GateDecision,
  type QualityGate,
} from './quality-gate';
import type { RunRecord } from './run-lifecycle';
import { RunLedger } from './run-ledger';
import { createSessionRecorder } from './session-replay';
import {
  runValidators,
  type StepValidator,
  type ValidatorContext,
  type ValidatorResult,
} from './step-validator';
import { runVerify, type VerifyCheck, type VerifyResult } from './verify-engine';

export type VerificationStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'blocked'
  | 'waived';

export interface VerifierSubject {
  runId: string;
  subjectId: string;
  subjectType: string;
  event: AcpEvent;
}

export interface VerifierLaneOptions {
  ledger?: EventLedger;
  runLedger?: RunLedger;
  validators?: StepValidator[];
  qualityGate?: QualityGate;
  replayStoreDir?: string;
  dagStorePath?: string;
  workspaceId?: string;
  repoId?: string;
  owner?: string;
  leaseTtlMs?: number;
}

export interface VerifierReplayInput {
  parentRunId: string;
  acpEvents: AcpEvent[];
  cwd: string;
  validators?: StepValidator[];
  qualityGate?: QualityGate;
  verifyChecks?: VerifyCheck[];
  replayStoreDir?: string;
  dagStorePath?: string;
  verifierRunId?: string;
  workspaceId?: string;
  repoId?: string;
  owner?: string;
  leaseTtlMs?: number;
}

export interface VerificationReport {
  runId: string;
  subjectId: string;
  subjectType: string;
  status: VerificationStatus;
  gateDecision: GateDecision;
  results: ValidatorResult[];
}

export interface VerifierStepRecord extends VerificationReport {
  eventIndex: number;
  eventType: string;
}

export interface VerifierLaneResult {
  parentRunId: string;
  verifierRunId: string;
  status: VerificationStatus;
  replayArtifactRef: string;
  replayArtifactPath: string;
  steps: VerifierStepRecord[];
  verifyResult?: VerifyResult;
  dagNodes: DagNode[];
  reconstructedRun?: RunRecord;
}

interface VerifyWithOptions {
  validators?: StepValidator[];
  qualityGate?: QualityGate;
}

const STATUS_RANK: Record<VerificationStatus, number> = {
  passed: 0,
  warning: 1,
  waived: 2,
  failed: 3,
  blocked: 4,
};

export class VerifierLane {
  private readonly ledger: EventLedger | undefined;
  private readonly runLedger: RunLedger | undefined;
  private readonly validators: StepValidator[];
  private readonly qualityGate: QualityGate;
  private readonly replayStoreDir: string | undefined;
  private readonly dagStorePath: string | undefined;
  private readonly workspaceId: string;
  private readonly repoId: string;
  private readonly owner: string;
  private readonly leaseTtlMs: number;

  constructor(options: VerifierLaneOptions) {
    this.ledger = options.ledger;
    this.runLedger = options.runLedger;
    this.validators = options.validators ?? [];
    this.qualityGate = options.qualityGate ?? createQualityGate({ sessionId: 'verifier-lane' });
    this.replayStoreDir = options.replayStoreDir;
    this.dagStorePath = options.dagStorePath;
    this.workspaceId = options.workspaceId ?? 'verifier-workspace';
    this.repoId = options.repoId ?? 'verifier-repo';
    this.owner = options.owner ?? 'verifier-lane';
    this.leaseTtlMs = options.leaseTtlMs ?? 60_000;
  }

  async verify(subject: VerifierSubject, ctx: ValidatorContext): Promise<VerificationReport> {
    return this.verifyWith(subject, ctx);
  }

  async run(input: VerifierReplayInput): Promise<VerifierLaneResult> {
    const replayStoreDir = input.replayStoreDir ?? this.replayStoreDir;
    if (!replayStoreDir) {
      throw new Error('VerifierLane: replayStoreDir is required to persist raw ACP replay artifacts');
    }

    const verifierRunId = input.verifierRunId ?? `${input.parentRunId}:verifier`;
    const workspaceId = input.workspaceId ?? this.workspaceId;
    const repoId = input.repoId ?? this.repoId;
    const owner = input.owner ?? this.owner;
    const leaseTtlMs = input.leaseTtlMs ?? this.leaseTtlMs;
    const validators = input.validators ?? this.validators;
    const qualityGate = input.qualityGate ?? this.qualityGate;

    await this.createVerifierRun({
      verifierRunId,
      parentRunId: input.parentRunId,
      workspaceId,
      repoId,
    });

    const replayArtifact = await this.persistAcpReplay({
      verifierRunId,
      parentRunId: input.parentRunId,
      replayStoreDir,
      acpEvents: input.acpEvents,
    });

    const dag = new DurableDag({
      storePath: input.dagStorePath ?? this.dagStorePath,
      ledger: this.ledger,
      ledgerRunId: verifierRunId,
      dagId: `${verifierRunId}:verification`,
    });
    const replayNode = dag.addNode({
      id: 'replay',
      kind: 'verifier.replay',
      payload: { eventCount: input.acpEvents.length },
      idempotencyKey: `${verifierRunId}:replay`,
      retryClass: 'deterministic',
      provenance: [
        { kind: 'run', ref: input.parentRunId, role: 'input' },
        { kind: 'artifact', ref: replayArtifact.ref, role: 'input', sha256: replayArtifact.sha256 },
      ],
    });
    dag.addNode({
      id: 'eval',
      kind: 'verifier.eval',
      dependsOn: [replayNode.id],
      payload: { validators: validators.map((validator) => validator.name) },
      idempotencyKey: `${verifierRunId}:eval`,
      retryClass: 'deterministic',
    });

    dag.leaseNode('replay', owner, leaseTtlMs);
    dag.startNode('replay', owner);
    dag.completeNode('replay', [
      { kind: 'artifact', ref: replayArtifact.ref, role: 'evidence', sha256: replayArtifact.sha256 },
    ]);

    dag.leaseNode('eval', owner, leaseTtlMs);
    dag.startNode('eval', owner);

    const steps: VerifierStepRecord[] = [];
    for (let index = 0; index < input.acpEvents.length; index += 1) {
      const event = input.acpEvents[index];
      const report = await this.verifyWith(
        {
          runId: verifierRunId,
          subjectId: `${input.parentRunId}:acp:${index}`,
          subjectType: 'acp_event',
          event,
        },
        { cwd: input.cwd },
        { validators, qualityGate },
      );
      steps.push({
        ...report,
        eventIndex: index,
        eventType: String(event.type),
      });
    }

    const verifyResult = input.verifyChecks
      ? await runVerify(input.verifyChecks, { cwd: input.cwd })
      : undefined;
    if (verifyResult) {
      await this.ledger?.append({
        type: 'test.completed',
        run_id: verifierRunId,
        status: verifyResult.passed ? 'passed' : 'failed',
        passed: verifyResult.checks.filter((check) => check.passed).length,
        failed: verifyResult.checks.filter((check) => !check.passed).length,
        skipped: 0,
        ms: verifyResult.checks.reduce((sum, check) => sum + check.durationMs, 0),
      });
    }

    const status = combineStatuses([
      ...steps.map((step) => step.status),
      verifyResult && !verifyResult.passed ? 'failed' : 'passed',
    ]);

    if (status === 'passed' || status === 'warning') {
      dag.completeNode('eval', [
        { kind: 'artifact', ref: replayArtifact.ref, role: 'evidence', sha256: replayArtifact.sha256 },
      ]);
      await this.runLedger?.completeRun(verifierRunId, 'completed', `verifier ${status}`);
    } else {
      dag.failNode('eval', `verifier ${status}`, false);
      if (status === 'blocked') {
        await this.runLedger?.blockRun(verifierRunId, `verifier ${status}`);
      } else {
        await this.runLedger?.completeRun(verifierRunId, 'failed', `verifier ${status}`);
      }
    }

    await dag.flushLedger();
    const reconstructedRun = await this.runLedger?.replayRun(verifierRunId);

    return {
      parentRunId: input.parentRunId,
      verifierRunId,
      status,
      replayArtifactRef: replayArtifact.ref,
      replayArtifactPath: replayArtifact.path,
      steps,
      verifyResult,
      dagNodes: dag.listNodes(),
      reconstructedRun,
    };
  }

  private async verifyWith(
    subject: VerifierSubject,
    ctx: ValidatorContext,
    options: VerifyWithOptions = {},
  ): Promise<VerificationReport> {
    const validators = options.validators ?? this.validators;
    const qualityGate = options.qualityGate ?? this.qualityGate;

    await this.ledger?.append({
      type: 'verifier.started',
      run_id: subject.runId,
      subject_id: subject.subjectId,
      subject_type: subject.subjectType,
      validators: validators.map((validator) => validator.name),
    });

    const validation = await runValidators({
      validators,
      event: subject.event,
      ctx,
    });
    const gateDecision = await qualityGate.evaluate(
      subject.event,
      validation.results,
      { eventId: subject.subjectId },
    );
    const status = mapGateToStatus(gateDecision);

    await this.ledger?.append({
      type: 'verifier.completed',
      run_id: subject.runId,
      subject_id: subject.subjectId,
      status,
      action: gateDecision.action,
      reason: gateDecision.reason,
      findings: validation.results.length,
    });
    await this.ledger?.append({
      type: 'test.completed',
      run_id: subject.runId,
      status,
      passed: validation.results.filter((result) => result.verdict === 'pass').length,
      failed: validation.results.filter((result) => result.verdict === 'block').length,
      skipped: 0,
      ms: validation.results.reduce((sum, result) => sum + result.durationMs, 0),
    });

    return {
      runId: subject.runId,
      subjectId: subject.subjectId,
      subjectType: subject.subjectType,
      status,
      gateDecision,
      results: validation.results,
    };
  }

  private async createVerifierRun(input: {
    verifierRunId: string;
    parentRunId: string;
    workspaceId: string;
    repoId: string;
  }): Promise<void> {
    if (!this.runLedger) return;

    await this.runLedger.createRun({
      run_id: input.verifierRunId,
      parent_run_id: input.parentRunId,
      task_id: `verify:${input.parentRunId}`,
      workspace_id: input.workspaceId,
      repo_id: input.repoId,
      mode: 'autonomous',
      goal: `Verify parent run ${input.parentRunId}`,
      permission_profile: { profile: 'strict' },
    });
    await this.runLedger.transition(input.verifierRunId, 'planned', 'verifier child run created');
    await this.runLedger.transition(input.verifierRunId, 'running', 'verifier evaluation started');
  }

  private async persistAcpReplay(input: {
    verifierRunId: string;
    parentRunId: string;
    replayStoreDir: string;
    acpEvents: AcpEvent[];
  }): Promise<{ ref: string; path: string; sha256: string }> {
    const raw = JSON.stringify(input.acpEvents);
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const ref = `acp-replay:${sha256}`;
    const artifactPath = path.join(input.replayStoreDir, `${input.verifierRunId}.jsonl`);
    const recorder = createSessionRecorder({
      storeDir: input.replayStoreDir,
      sessionId: input.verifierRunId,
    });
    recorder.sessionStart({
      kind: 'verifier_acp_replay',
      parentRunId: input.parentRunId,
      sha256,
    });
    for (const event of input.acpEvents) {
      recorder.meta({ kind: 'acp_event', event });
    }
    await recorder.close();

    if (this.runLedger) {
      await this.runLedger.recordArtifact(input.verifierRunId, ref, [artifactPath]);
    } else {
      await this.ledger?.append({
        type: 'artifact.created',
        run_id: input.verifierRunId,
        artifact_id: ref,
        files: [artifactPath],
      });
    }

    return { ref, path: artifactPath, sha256 };
  }
}

export interface OrchestrationEvalCase {
  name: string;
  runId: string;
  events: LedgerEvent[];
  assertions: Array<{
    name: string;
    check(events: LedgerEvent[]): boolean;
  }>;
}

export interface OrchestrationEvalResult {
  suite: string;
  passed: number;
  failed: number;
  cases: Array<{
    name: string;
    passed: boolean;
    failures: string[];
  }>;
}

export async function runOrchestrationEvalSuite(
  suite: string,
  cases: OrchestrationEvalCase[],
  ledger?: EventLedger,
): Promise<OrchestrationEvalResult> {
  const results = cases.map((testCase) => {
    const failures = testCase.assertions
      .filter((assertion) => !assertion.check(testCase.events))
      .map((assertion) => assertion.name);
    return {
      name: testCase.name,
      passed: failures.length === 0,
      failures,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  const failed = results.length - passed;

  await ledger?.append({
    type: 'eval.completed',
    run_id: suite,
    suite,
    passed,
    failed,
    status: failed === 0 ? 'passed' : 'failed',
  });

  return { suite, passed, failed, cases: results };
}

function mapGateToStatus(decision: GateDecision): VerificationStatus {
  switch (decision.action) {
    case 'continue':
      return decision.results.some((result) => result.verdict === 'warn') ? 'warning' : 'passed';
    case 'inject_correction':
      return 'failed';
    case 'request_user':
    case 'block':
      return 'blocked';
  }
}

function combineStatuses(statuses: VerificationStatus[]): VerificationStatus {
  return statuses.reduce<VerificationStatus>(
    (current, next) => (STATUS_RANK[next] > STATUS_RANK[current] ? next : current),
    'passed',
  );
}

import {
  DurableDag,
  type DagNodeStatus,
  type DagProvenanceLink,
} from '../runtime/durable-dag';

export type WorkflowStepSnapshotStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export interface WorkflowStepSnapshot {
  id: string;
  workflowRunId: string;
  nodeId: string;
  name?: string | null;
  stepType: string;
  status: WorkflowStepSnapshotStatus | string;
  dependsOnJson?: string | null;
  attemptCount?: number | null;
  maxRetries?: number | null;
  heartbeatRunId?: string | null;
  checkpointId?: string | null;
  outputJson?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface WorkflowHeartbeatRunSnapshot {
  id: string;
  status: string;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  resultJson?: string | null;
  checkpoints?: Array<{ id: string }>;
}

export interface BuildWorkflowDagInput {
  workflowRunId: string;
  steps: WorkflowStepSnapshot[];
  dag?: DurableDag;
}

export function buildWorkflowDag(input: BuildWorkflowDagInput): DurableDag {
  const dag = input.dag ?? new DurableDag({ dagId: `workflow:${input.workflowRunId}` });

  for (const step of [...input.steps].sort((a, b) => a.nodeId.localeCompare(b.nodeId))) {
    const status = mapWorkflowStepStatusToDagStatus(step.status);
    dag.hydrateNode({
      id: step.nodeId,
      kind: `workflow.${step.stepType}`,
      status,
      dependsOn: parseDependencyIds(step.dependsOnJson),
      payload: {
        workflowRunId: input.workflowRunId,
        workflowStepId: step.id,
        workflowNodeId: step.nodeId,
        stepType: step.stepType,
        name: step.name ?? step.nodeId,
        heartbeatRunId: step.heartbeatRunId ?? undefined,
        checkpointId: step.checkpointId ?? undefined,
      },
      attempts: step.attemptCount ?? 0,
      idempotencyKey: `workflow:${input.workflowRunId}:${step.nodeId}`,
      retryClass: step.status === 'waiting_approval' ? 'human_needed' : 'transient',
      timeoutClass: step.stepType === 'approval' ? 'manual' : 'normal',
      failure: status === 'failed'
        ? { reason: step.errorMessage ?? 'workflow step failed', retryable: isRetryableStepFailure(step) }
        : undefined,
      createdAt: toMs(step.createdAt),
      updatedAt: toMs(step.updatedAt) ?? toMs(step.finishedAt) ?? toMs(step.startedAt),
      provenance: workflowStepProvenance(step),
    });
  }

  return dag;
}

export function listReadyWorkflowSteps(
  dag: DurableDag,
  steps: WorkflowStepSnapshot[],
): WorkflowStepSnapshot[] {
  const readyIds = new Set(dag.listReady().map((node) => node.id));
  return steps
    .filter((step) => step.status === 'pending' && readyIds.has(step.nodeId))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export function provenanceFromHeartbeatRun(
  heartbeatRun: WorkflowHeartbeatRunSnapshot,
): DagProvenanceLink[] {
  return [
    { kind: 'run', ref: heartbeatRun.id, role: 'evidence', meta: { status: heartbeatRun.status } },
    ...((heartbeatRun.checkpoints ?? []).map((checkpoint) => ({
      kind: 'worker_frame' as const,
      ref: checkpoint.id,
      role: 'evidence' as const,
      meta: { source: 'heartbeat_checkpoint' },
    }))),
  ];
}

export function hydrateStepIntoDag(
  dag: DurableDag,
  step: WorkflowStepSnapshot,
  heartbeatRun?: WorkflowHeartbeatRunSnapshot,
) {
  const provenance = [
    ...workflowStepProvenance(step),
    ...(heartbeatRun ? provenanceFromHeartbeatRun(heartbeatRun) : []),
  ];
  return dag.hydrateNode({
    id: step.nodeId,
    kind: `workflow.${step.stepType}`,
    status: mapWorkflowStepStatusToDagStatus(step.status),
    dependsOn: parseDependencyIds(step.dependsOnJson),
    payload: {
      workflowRunId: step.workflowRunId,
      workflowStepId: step.id,
      workflowNodeId: step.nodeId,
      stepType: step.stepType,
      heartbeatRunId: heartbeatRun?.id ?? step.heartbeatRunId ?? undefined,
      checkpointId: heartbeatRun?.checkpoints?.[0]?.id ?? step.checkpointId ?? undefined,
    },
    attempts: step.attemptCount ?? 0,
    idempotencyKey: `workflow:${step.workflowRunId}:${step.nodeId}`,
    failure: step.status === 'failed'
      ? { reason: step.errorMessage ?? 'workflow step failed', retryable: isRetryableStepFailure(step) }
      : undefined,
    provenance,
  });
}

export function mapWorkflowStepStatusToDagStatus(status: WorkflowStepSnapshotStatus | string): DagNodeStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'queued':
    case 'waiting_approval':
      return 'leased';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function workflowStepProvenance(step: WorkflowStepSnapshot): DagProvenanceLink[] {
  const provenance: DagProvenanceLink[] = [
    { kind: 'run', ref: step.workflowRunId, role: 'input' },
  ];
  if (step.heartbeatRunId) {
    provenance.push({ kind: 'run', ref: step.heartbeatRunId, role: 'evidence' });
  }
  if (step.checkpointId) {
    provenance.push({ kind: 'worker_frame', ref: step.checkpointId, role: 'evidence' });
  }
  return provenance;
}

function parseDependencyIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string').sort()
      : [];
  } catch {
    return [];
  }
}

function isRetryableStepFailure(step: WorkflowStepSnapshot): boolean {
  return (step.attemptCount ?? 0) < (step.maxRetries ?? 1);
}

function toMs(value: Date | string | null | undefined): number | undefined {
  if (!value) return undefined;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildWorkflowDag,
  hydrateStepIntoDag,
  listReadyWorkflowSteps,
  mapWorkflowStepStatusToDagStatus,
  provenanceFromHeartbeatRun,
  type WorkflowStepSnapshot,
} from './workflow-dag-bridge';

function step(
  nodeId: string,
  status: WorkflowStepSnapshot['status'],
  dependsOn: string[] = [],
  patch: Partial<WorkflowStepSnapshot> = {},
): WorkflowStepSnapshot {
  return {
    id: `step-${nodeId}`,
    workflowRunId: 'workflow-1',
    nodeId,
    name: nodeId,
    stepType: 'agent',
    status,
    dependsOnJson: JSON.stringify(dependsOn),
    attemptCount: 0,
    maxRetries: 1,
    ...patch,
  };
}

describe('workflow-dag-bridge', () => {
  it('maps workflow step statuses to DAG statuses', () => {
    expect(mapWorkflowStepStatusToDagStatus('pending')).toBe('pending');
    expect(mapWorkflowStepStatusToDagStatus('queued')).toBe('leased');
    expect(mapWorkflowStepStatusToDagStatus('running')).toBe('running');
    expect(mapWorkflowStepStatusToDagStatus('waiting_approval')).toBe('leased');
    expect(mapWorkflowStepStatusToDagStatus('succeeded')).toBe('succeeded');
    expect(mapWorkflowStepStatusToDagStatus('failed')).toBe('failed');
    expect(mapWorkflowStepStatusToDagStatus('skipped')).toBe('cancelled');
    expect(mapWorkflowStepStatusToDagStatus('cancelled')).toBe('cancelled');
  });

  it('builds a hydrated DAG and returns ready workflow steps', () => {
    const steps = [
      step('build', 'pending', ['plan']),
      step('plan', 'succeeded'),
      step('deploy', 'pending', ['build']),
    ];
    const dag = buildWorkflowDag({ workflowRunId: 'workflow-1', steps });

    expect(dag.getNode('plan')?.status).toBe('succeeded');
    expect(dag.getNode('build')?.dependsOn).toEqual(['plan']);
    expect(listReadyWorkflowSteps(dag, steps).map((ready) => ready.nodeId)).toEqual(['build']);
  });

  it('hydrates heartbeat provenance onto a workflow step node', () => {
    const dag = buildWorkflowDag({ workflowRunId: 'workflow-1', steps: [] });
    const node = hydrateStepIntoDag(
      dag,
      step('build', 'succeeded', ['plan'], {
        heartbeatRunId: 'heartbeat-old',
        checkpointId: 'checkpoint-old',
      }),
      {
        id: 'heartbeat-1',
        status: 'succeeded',
        checkpoints: [{ id: 'checkpoint-1' }],
      },
    );

    expect(node.status).toBe('succeeded');
    expect(node.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'run', ref: 'workflow-1' }),
      expect.objectContaining({ kind: 'run', ref: 'heartbeat-1' }),
      expect.objectContaining({ kind: 'worker_frame', ref: 'checkpoint-1' }),
    ]));
  });

  it('creates provenance links from heartbeat runs and checkpoints', () => {
    expect(provenanceFromHeartbeatRun({
      id: 'heartbeat-1',
      status: 'succeeded',
      checkpoints: [{ id: 'checkpoint-1' }],
    })).toEqual([
      { kind: 'run', ref: 'heartbeat-1', role: 'evidence', meta: { status: 'succeeded' } },
      { kind: 'worker_frame', ref: 'checkpoint-1', role: 'evidence', meta: { source: 'heartbeat_checkpoint' } },
    ]);
  });
});

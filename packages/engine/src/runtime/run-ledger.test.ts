// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { EventLedger } from './event-ledger';
import { InvalidTransitionError } from './run-lifecycle';
import { RunLedger } from './run-ledger';

function tmpPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `run-ledger-test-${hex}`, 'events.jsonl');
}

describe('RunLedger', () => {
  let filePath: string;
  let eventLedger: EventLedger;
  let runLedger: RunLedger;

  beforeEach(() => {
    filePath = tmpPath();
    eventLedger = new EventLedger(filePath);
    runLedger = new RunLedger({ ledger: eventLedger });
  });

  afterEach(async () => {
    await eventLedger.close();
    await rm(path.dirname(filePath), { recursive: true, force: true });
  });

  it('creates a run and appends run.created with lifecycle metadata', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
      task_id: 'task-1',
      goal: 'build a feature',
    });

    expect(run.status).toBe('draft');
    expect(run.task_id).toBe('task-1');

    const events = await eventLedger.byRun(run.run_id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'run.created',
      run_id: run.run_id,
      task_id: 'task-1',
      mode: 'autonomous',
      status: 'draft',
      goal: 'build a feature',
    });
  });

  it('commits valid transitions and appends run.transitioned', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'pm',
    });

    const planned = await runLedger.transition(run.run_id, 'planned', 'plan generated');

    expect(planned.status).toBe('planned');
    const events = await eventLedger.byRun(run.run_id);
    expect(events.map((event) => event.type)).toEqual(['run.created', 'run.transitioned']);
    expect(events[1]).toMatchObject({
      type: 'run.transitioned',
      from: 'draft',
      to: 'planned',
      reason: 'plan generated',
    });
  });

  it('rejects invalid transitions without appending an event', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'autonomous',
    });

    await expect(runLedger.transition(run.run_id, 'completed')).rejects.toBeInstanceOf(InvalidTransitionError);

    const events = await eventLedger.byRun(run.run_id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('run.created');
  });

  it('records artifacts in RunRecord and EventLedger', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'edit',
    });

    const updated = await runLedger.recordArtifact(run.run_id, 'sha256:abc', ['src/a.ts']);

    expect(updated.artifact_refs).toEqual(['sha256:abc']);
    const events = await eventLedger.byRun(run.run_id);
    expect(events.map((event) => event.type)).toEqual(['run.created', 'artifact.created']);
    expect(events[1]).toMatchObject({
      type: 'artifact.created',
      artifact_id: 'sha256:abc',
      files: ['src/a.ts'],
    });
  });

  it('completes a running run with transition and terminal events', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'chat',
    });

    await runLedger.transition(run.run_id, 'planned');
    await runLedger.transition(run.run_id, 'running');
    const completed = await runLedger.completeRun(run.run_id, 'completed');

    expect(completed.status).toBe('completed');
    const events = await eventLedger.byRun(run.run_id);
    expect(events.map((event) => event.type)).toEqual([
      'run.created',
      'run.transitioned',
      'run.transitioned',
      'run.transitioned',
      'run.completed',
    ]);
  });

  it('replays a run from ledger events', async () => {
    const run = await runLedger.createRun({
      workspace_id: 'ws-1',
      repo_id: 'repo-1',
      mode: 'chat',
      task_id: 'task-1',
    });
    await runLedger.transition(run.run_id, 'planned');
    await runLedger.transition(run.run_id, 'running');
    await runLedger.recordArtifact(run.run_id, 'sha256:abc');
    await runLedger.completeRun(run.run_id, 'completed');

    const reopened = new RunLedger({ ledger: new EventLedger(filePath) });
    const replayed = await reopened.replayRun(run.run_id);

    expect(replayed).toMatchObject({
      run_id: run.run_id,
      task_id: 'task-1',
      status: 'completed',
      artifact_refs: ['sha256:abc'],
    });
  });
});

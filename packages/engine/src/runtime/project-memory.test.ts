// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { EventLedger } from './event-ledger';
import { createProjectMemoryRollup } from './project-memory';
import { SessionStore } from './session-store';
import type { MemoryWriteOptions } from '../ai/memory/agent-memory-store';

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('createProjectMemoryRollup', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('promotes project-scoped sessions and ledger events into five durable memory categories', async () => {
    const root = await tempDir('pyrfor-project-memory-');
    const workspaceId = '/tmp/workspace-a';
    const sessionStore = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });
    const session = await sessionStore.create({
      workspaceId,
      mode: 'chat',
      title: 'Project Alpha',
      runId: 'run-alpha',
      metadata: { projectId: 'alpha' },
    });
    await sessionStore.appendMessage(workspaceId, session.id, { role: 'user', content: 'Decision: use governed delivery. Next continue migration.' });
    await sessionStore.appendMessage(workspaceId, session.id, { role: 'assistant', content: 'Risk: verifier block remains.' });
    const other = await sessionStore.create({
      workspaceId,
      mode: 'chat',
      title: 'Project Beta',
      runId: 'run-beta',
      metadata: { projectId: 'beta' },
    });
    await sessionStore.appendMessage(workspaceId, other.id, { role: 'user', content: 'Beta secret should not appear.' });
    await sessionStore.flush();

    const eventLedger = new EventLedger(path.join(root, 'events.jsonl'));
    await eventLedger.append({
      type: 'run.created',
      run_id: 'run-alpha',
      workspace_id: workspaceId,
      project_id: 'alpha',
    });
    await eventLedger.append({ type: 'run.blocked', run_id: 'run-alpha', reason: 'needs verifier waiver' });
    await eventLedger.append({ type: 'run.failed', run_id: 'run-beta', error: 'wrong project' });
    await eventLedger.append({
      type: 'run.created',
      run_id: 'run-other-workspace',
      workspace_id: '/tmp/workspace-b',
      project_id: 'alpha',
    });
    await eventLedger.append({ type: 'run.failed', run_id: 'run-other-workspace', error: 'other workspace secret' });
    await eventLedger.append({
      type: 'run.failed',
      run_id: 'run-alpha',
      workspace_id: '/tmp/workspace-b',
      project_id: 'alpha',
      error: 'shared run id foreign workspace secret',
    });
    await eventLedger.append({
      type: 'run.failed',
      run_id: 'run-alpha',
      workspace_id: workspaceId,
      project_id: 'beta',
      error: 'shared run id foreign project secret',
    });
    await eventLedger.append({ type: 'run.failed', run_id: 'run-unscoped', error: 'unscoped foreign secret' });
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const memoryWriter = vi.fn(async (_options: MemoryWriteOptions) => `memory-${memoryWriter.mock.calls.length + 1}`);

    const result = await createProjectMemoryRollup({
      sessionStore,
      eventLedger,
      artifactStore,
      memoryWriter,
    }, {
      workspaceId,
      projectId: 'alpha',
    });

    expect(result.sessionCount).toBe(1);
    expect(result.ledgerEventCount).toBe(1);
    expect(result.runIds).toEqual(['run-alpha']);
    expect(result.artifact?.kind).toBe('summary');
    expect(result.memories.map((memory) => memory.category).sort()).toEqual([
      'active_thread',
      'convention',
      'decision',
      'risk',
      'unresolved_task',
    ]);
    expect(memoryWriter).toHaveBeenCalledTimes(5);
    const writtenContent = memoryWriter.mock.calls.map((call) => call[0].content).join('\n');
    expect(writtenContent).toContain('governed delivery');
    expect(writtenContent).toContain('run-alpha');
    expect(writtenContent).not.toContain('needs verifier waiver');
    expect(writtenContent).not.toContain('Beta secret');
    expect(writtenContent).not.toContain('run-beta');
    expect(writtenContent).not.toContain('other workspace secret');
    expect(writtenContent).not.toContain('run-other-workspace');
    expect(writtenContent).not.toContain('shared run id foreign workspace secret');
    expect(writtenContent).not.toContain('shared run id foreign project secret');
    expect(writtenContent).not.toContain('unscoped foreign secret');
    await sessionStore.close();
    await eventLedger.close();
  });

  it('fails when project memory falls back to short-term-only storage', async () => {
    const root = await tempDir('pyrfor-project-memory-short-');
    const workspaceId = '/tmp/workspace-a';
    const sessionStore = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });

    await expect(createProjectMemoryRollup({
      sessionStore,
      memoryWriter: vi.fn(async () => 'short-term-only'),
    }, {
      workspaceId,
      projectId: 'alpha',
    })).rejects.toThrow('durably persisted');
    await sessionStore.close();
  });
});

// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactStore } from './artifact-model';
import { EventLedger } from './event-ledger';
import { createDailyMemoryRollup } from './memory-rollup';
import { SessionStore } from './session-store';
import type { MemoryWriteOptions } from '../ai/memory/agent-memory-store';

const roots: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

describe('createDailyMemoryRollup', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('promotes session and ledger continuity into semantic memory plus summary artifact', async () => {
    const root = await tempDir('pyrfor-rollup-');
    const workspaceId = '/tmp/workspace-a';
    const date = new Date().toISOString().slice(0, 10);
    const sessionStore = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });
    const session = await sessionStore.create({
      workspaceId,
      mode: 'chat',
      title: 'web:chat-1',
      metadata: { workspaceId },
    });
    await sessionStore.appendMessage(workspaceId, session.id, { role: 'user', content: 'Continue the migration plan tomorrow' });
    await sessionStore.appendMessage(workspaceId, session.id, { role: 'assistant', content: 'I will preserve the next actions.' });
    await sessionStore.update(workspaceId, session.id, { summary: 'Migration planning continued.' });
    await sessionStore.flush();

    const eventLedger = new EventLedger(path.join(root, 'events.jsonl'));
    await eventLedger.append({
      type: 'run.created',
      run_id: 'run-1',
      task_id: 'task-1',
      workspace_id: workspaceId,
      status: 'running',
    });
    await eventLedger.append({
      type: 'run.blocked',
      run_id: 'run-1',
      reason: 'needs review',
    });
    await eventLedger.append({
      type: 'run.created',
      run_id: 'run-2',
      task_id: 'task-2',
      workspace_id: '/tmp/workspace-b',
      status: 'running',
    });
    await eventLedger.append({
      type: 'run.blocked',
      run_id: 'run-2',
      reason: 'different workspace',
    });
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const memoryWriter = vi.fn(async (_options: MemoryWriteOptions) => 'memory-1');

    const result = await createDailyMemoryRollup({
      sessionStore,
      eventLedger,
      artifactStore,
      memoryWriter,
    }, {
      workspaceId,
      date,
      agentId: 'pyrfor-runtime',
    });

    expect(result.summary).toContain('1 sessions');
    expect(result.summary).toContain('2 messages');
    expect(result.ledgerEventCount).toBe(2);
    expect(result.runIds).toEqual(['run-1']);
    expect(result.artifact?.kind).toBe('summary');
    expect(memoryWriter).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'pyrfor-runtime',
      workspaceId,
      memoryType: 'semantic',
      summary: result.summary,
      importance: 0.85,
    }));
    const written = memoryWriter.mock.calls[0]?.[0];
    expect(written?.content).toContain('Migration planning continued');
    expect(written?.content).toContain('Review blocked/failed run run-1');
    expect(written?.content).not.toContain('run-2');
    await sessionStore.close();
  });

  it('drops unscoped ledger events when their workspace cannot be proven', async () => {
    const root = await tempDir('pyrfor-rollup-unscoped-');
    const workspaceId = '/tmp/workspace-a';
    const date = new Date().toISOString().slice(0, 10);
    const sessionStore = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });
    const eventLedger = new EventLedger(path.join(root, 'events.jsonl'));
    await eventLedger.append({
      type: 'run.blocked',
      run_id: 'run-unscoped',
      reason: 'unknown workspace',
    });

    const result = await createDailyMemoryRollup({
      sessionStore,
      eventLedger,
      memoryWriter: vi.fn(async () => 'memory-1'),
    }, {
      workspaceId,
      date,
    });

    expect(result.ledgerEventCount).toBe(0);
    expect(result.runIds).toEqual([]);
    expect(result.content).not.toContain('run-unscoped');
    await sessionStore.close();
  });

  it('fails when semantic memory falls back to short-term-only storage', async () => {
    const root = await tempDir('pyrfor-rollup-short-term-');
    const workspaceId = '/tmp/workspace-a';
    const date = new Date().toISOString().slice(0, 10);
    const sessionStore = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });

    await expect(createDailyMemoryRollup({
      sessionStore,
      memoryWriter: vi.fn(async () => 'short-term-only'),
    }, {
      workspaceId,
      date,
    })).rejects.toThrow('durably persisted');
    await sessionStore.close();
  });
});

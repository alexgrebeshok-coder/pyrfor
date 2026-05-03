// @vitest-environment node

import { describe, expect, it, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore } from './artifact-model';
import { ContextCompiler } from './context-compiler';
import type { ContextPackSection } from './context-pack';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { SessionStore } from './session-store';
import type { LoadedWorkspace } from './workspace-loader';
import type { MemoryEntry, MemoryType } from '../ai/memory/agent-memory-store';

function tmpDir(): string {
  return path.join(os.tmpdir(), `context-compiler-test-${randomBytes(8).toString('hex')}`);
}

function workspace(): LoadedWorkspace {
  return {
    loadedAt: new Date('2026-05-01T00:00:00.000Z'),
    errors: [],
    systemPrompt: 'do not hash this aggregate prompt',
    files: {
      memory: 'project memory',
      daily: new Map([['2026-05-01', 'daily note']]),
      soul: 'values',
      user: 'user context',
      identity: 'identity',
      agents: 'agent policy',
      heartbeat: '',
      tools: 'tool policy',
      skills: ['skill text'],
    },
  };
}

function memory(
  id: string,
  memoryType: MemoryType,
  content: string,
  metadata: MemoryEntry['metadata'] = {},
): MemoryEntry {
  return {
    id,
    agentId: 'agent-1',
    workspaceId: 'workspace-1',
    projectId: 'project-1',
    memoryType,
    content,
    importance: 0.8,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    metadata,
  };
}

describe('ContextCompiler', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('compiles deterministic context sections from explicit sources and persists context_pack', async () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const ledger = new EventLedger(path.join(root, 'events.jsonl'));
    await ledger.append({ type: 'run.created', run_id: 'run-1', workspace_id: 'workspace-1' });
    await ledger.append({ type: 'tool.requested', run_id: 'run-1', tool: 'fs.read' });

    const dag = new DurableDag({ storePath: path.join(root, 'dag.json') });
    dag.addNode({
      id: 'task-a',
      kind: 'coding',
      provenance: [{ kind: 'memory', ref: 'mem-semantic', role: 'input' }],
    });

    const sessions = new SessionStore({ rootDir: path.join(root, 'sessions'), autosaveDebounceMs: 1 });
    const session = await sessions.create({ workspaceId: 'workspace-1', title: 'Session', mode: 'autonomous' });
    await sessions.update('workspace-1', session.id, { summary: 'rolling session summary' });

    const memories = [
      memory('mem-policy', 'policy', 'Never leak private family memory', {
        scope: { visibility: 'global' },
        confidence: 1,
      }),
      memory('mem-semantic', 'semantic', 'Project uses Pyrfor worker protocol', {
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      memory('mem-project-risk', 'semantic', 'Verifier waiver risk remains open', {
        projectMemoryCategory: 'risk',
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      memory('mem-private', 'semantic', 'Member private note', {
        scope: { visibility: 'member', workspaceId: 'workspace-1', memberId: 'member-1' },
      }),
      memory('mem-revoked', 'semantic', 'Revoked fact', {
        revoked: true,
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
      memory('mem-expired', 'semantic', 'Expired fact', {
        retention: { expiresAt: '2020-01-01T00:00:00.000Z' },
        scope: { visibility: 'project', workspaceId: 'workspace-1', projectId: 'project-1' },
      }),
    ];

    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const compiler = new ContextCompiler({
      artifactStore,
      eventLedger: ledger,
      dag,
      sessionStore: sessions,
      workspace: workspace(),
      memorySearch: async (opts) => memories.filter((entry) => entry.memoryType === opts.memoryType),
    });

    const result = await compiler.compile({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      compiledAt: '2026-05-01T00:00:00.000Z',
      agentId: 'agent-1',
      query: 'worker protocol',
      sessionId: session.id,
      filesOfInterest: [
        { path: 'src/b.ts', content: 'export const b = 2;' },
        { path: 'src/a.ts', content: 'export const a = 1;' },
      ],
      task: {
        id: 'task-1',
        title: 'Implement worker task',
        acceptanceCriteria: ['context pack is deterministic'],
      },
    });

    const ids = result.pack.sections.map((section) => section.id);
    expect(ids.indexOf('policy')).toBeLessThan(ids.indexOf('workspace_files'));
    expect(ids.indexOf('memory_policy')).toBeLessThan(ids.indexOf('memory_working_set'));

    const files = section(result.pack.sections, 'files_of_interest').content as Array<{ path: string }>;
    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);

    expect(section(result.pack.sections, 'ledger_history').sources.map((source) => source.kind)).toContain('ledger_event');
    expect(section(result.pack.sections, 'dependency_graph').sources[0].ref).toBe('task-a');
    expect(section(result.pack.sections, 'session_history').content).toMatchObject({
      summary: 'rolling session summary',
    });

    const memoryWorkingSet = section(result.pack.sections, 'memory_working_set').content as Array<{ id: string }>;
    expect(memoryWorkingSet.map((entry) => entry.id)).toEqual(['mem-semantic']);
    const projectMemory = section(result.pack.sections, 'project_memory').content as Array<{ id: string; projectMemoryCategory?: string }>;
    expect(projectMemory).toEqual([
      expect.objectContaining({ id: 'mem-project-risk', projectMemoryCategory: 'risk' }),
    ]);
    expect(JSON.stringify(result.pack)).not.toContain('Member private note');
    expect(JSON.stringify(result.pack)).not.toContain('Revoked fact');
    expect(JSON.stringify(result.pack)).not.toContain('Expired fact');

    const ref = await compiler.persist(result);
    expect(ref.kind).toBe('context_pack');
    const persisted = await artifactStore.readJSON(ref);
    expect(persisted).toEqual(result.pack);
    await ledger.close();
    await sessions.close();
  });

  it('produces the same hash for the same sorted compiler inputs', async () => {
    const compiler = new ContextCompiler({ workspace: workspace() });
    const input = {
      workspaceId: 'workspace-1',
      compiledAt: '2026-05-01T00:00:00.000Z',
      task: { title: 'Stable task' },
      filesOfInterest: [
        { path: 'z.ts', content: 'z' },
        { path: 'a.ts', content: 'a' },
      ],
    };

    const first = await compiler.compile(input);
    const second = await compiler.compile({ ...input, filesOfInterest: [...input.filesOfInterest].reverse() });
    expect(first.hash).toBe(second.hash);
  });
});

function section(sections: ContextPackSection[], id: string): ContextPackSection {
  const found = sections.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing section ${id}`);
  return found;
}

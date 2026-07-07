// @vitest-environment node

import { describe, expect, it, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactStore } from './artifact-model';
import { ContextCompiler } from './context-compiler';
import type { ContextPackSection } from './context-pack';
import { DurableDag } from './durable-dag';
import { EventLedger } from './event-ledger';
import { RunLedger } from './run-ledger';
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
    await artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.research_evidence.v1',
      createdAt: '2026-05-01T00:02:00.000Z',
      runId: 'run-1',
      query: 'OpenClaw migration source',
      queryHash: 'research-query-hash',
      sourceMode: 'operator_supplied',
      effectsExecuted: [],
      sources: [{
        url: 'https://example.com/reset/raw-secret-token?token=super-secret',
        title: 'Reset token=super-secret /Users/demo-user/private.txt',
        snippet: 'Evidence snippet apiKey=secret-value',
      }],
      summary: 'Research summary password=secret-value see https://example.com/reset/raw-secret-token?token=super-secret',
      notes: ['note token=secret-value and https://example.com/private/path?api_key=super-secret C:\\Users\\alice\\secret.txt \\\\server\\share\\secret.txt'],
    }, { runId: 'run-1', meta: { artifactKind: 'research_evidence' } });
    await artifactStore.writeJSON('research_source_capture', {
      snapshot: {
        schemaVersion: 'pyrfor.research_source_capture.v1',
        createdAt: '2026-05-01T00:03:00.000Z',
        runId: 'run-1',
        sourceMode: 'governed_source_capture',
        requestedUrl: 'https://example.com/redacted-path?token=redacted',
        requestedUrlHash: 'requested-url-hash',
        requestedHost: 'example.com',
        requestedPathHash: 'requested-path-hash',
        finalUrl: 'https://example.com/redacted-path?token=redacted',
        finalUrlHash: 'final-url-hash',
        finalHost: 'example.com',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Captured title token=secret-value',
        contentHash: 'content-hash',
        capturedBytes: 512,
        truncated: false,
        excerpt: 'Bounded excerpt password=secret-value',
        effectsExecuted: [{
          kind: 'research_source_capture',
          approvalId: 'research-source:approval',
          executedAt: '2026-05-01T00:03:00.000Z',
          requestedUrlHash: 'requested-url-hash',
          finalUrlHash: 'final-url-hash',
        }],
      },
      contentText: 'RAW CAPTURE BODY token=do-not-include /Users/demo-user/private.txt',
    }, { runId: 'run-1', meta: { artifactKind: 'research_source_capture' } });
    await artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.browser_smoke.v1',
      createdAt: '2026-05-01T00:04:00.000Z',
      runId: 'run-1',
      status: 'passed',
      sourceMode: 'governed_browser_smoke',
      targetUrlHash: 'target-url-hash',
      targetHost: 'localhost:5173',
      targetPathHash: 'target-path-hash',
      finalHost: 'localhost:5173',
      finalUrlHash: 'final-url-hash',
      title: 'Pyrfor app',
      screenshot: { artifactId: 'screenshot-1.png' },
      effectsExecuted: [{
        kind: 'browser_smoke',
        approvalId: 'browser-smoke:approval',
        executedAt: '2026-05-01T00:04:00.000Z',
        targetUrlHash: 'target-url-hash',
        finalUrlHash: 'final-url-hash',
      }],
      notes: [],
    }, { runId: 'run-1', meta: { artifactKind: 'browser_smoke' } });
    await artifactStore.writeJSON('delivery_evidence', {
      schemaVersion: 'pyrfor.delivery_evidence.v1',
      capturedAt: '2026-05-01T00:05:00.000Z',
      runId: 'run-1',
      summary: 'Delivery ready from /Users/demo-user/private token=secret-value',
      verifierStatus: 'passed',
      deliveryChecklist: ['No local path C:\\Users\\alice\\secret.txt'],
      deliveryArtifactId: 'delivery-artifact-1.json',
      verifier: { status: 'passed', rawStatus: 'passed' },
      git: {
        available: true,
        branch: 'feature/path-token',
        headSha: 'abcdef1234567890',
        ahead: 1,
        behind: 0,
        dirtyFiles: [{ path: '/Users/demo-user/private.txt', x: 'M', y: ' ' }],
        latestCommits: [{ sha: 'abcdef1', author: 'Dev token=secret-value', dateUnix: 1, subject: 'Fix /Users/demo-user/private.txt' }],
        remote: { name: 'origin', url: 'https://token@github.com/acme/pyrfor.git', repository: 'acme/pyrfor' },
      },
      github: {
        provider: 'github',
        available: true,
        repository: 'acme/pyrfor',
        branch: { name: 'main', protected: true, commitSha: 'abcdef1234567890', url: 'https://github.com/acme/pyrfor/tree/main?token=super-secret' },
        pullRequests: [{ number: 7, title: 'PR token=secret-value', state: 'open', url: 'https://github.com/acme/pyrfor/pull/7?token=super-secret' }],
        workflowRuns: [{ id: 9, name: 'CI', status: 'completed', conclusion: 'success', url: 'https://github.com/acme/pyrfor/actions/runs/9?token=super-secret' }],
        issue: { number: 42, title: 'Issue token=secret-value', state: 'open', url: 'https://github.com/acme/pyrfor/issues/42?token=super-secret' },
        errors: [{ scope: 'ci', message: 'No error /Users/demo-user/private.txt' }],
      },
    }, { runId: 'run-1' });
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
    const evidence = section(result.pack.sections, 'run_evidence').content as { items: Array<Record<string, unknown>> };
    expect(evidence.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artifactKind: 'research_evidence',
        queryHash: 'research-query-hash',
        sources: [expect.objectContaining({ host: 'example.com', urlHash: expect.any(String) })],
      }),
      expect.objectContaining({
        artifactKind: 'research_source_capture',
        requestedHost: 'example.com',
        requestedPathHash: 'requested-path-hash',
        excerpt: 'Bounded excerpt password=[redacted]',
      }),
      expect.objectContaining({
        artifactKind: 'browser_smoke',
        targetHost: 'localhost:5173',
        screenshotArtifactId: 'screenshot-1.png',
      }),
      expect.objectContaining({
        artifactKind: 'delivery_evidence',
        verifierStatus: 'passed',
        git: expect.objectContaining({
          dirtyFileCount: 1,
          remoteRepository: 'acme/pyrfor',
        }),
        github: expect.objectContaining({
          repository: 'acme/pyrfor',
        }),
      }),
    ]));
    expect(section(result.pack.sections, 'run_evidence').sources.map((source) => source.kind)).toEqual(['artifact', 'artifact', 'artifact', 'artifact']);
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('RAW CAPTURE BODY');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('raw-secret-token');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('/private/path');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('C:\\Users\\alice');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('\\\\server\\share');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).toContain('[redacted-url host=example.com hash=');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('super-secret');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('https://token@github.com');
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain('/Users/demo-user');

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

  it('uses planner memory audience by default and allows explicit audit override', async () => {
    const audiences: Array<'planner' | 'audit' | undefined> = [];
    const compiler = new ContextCompiler({
      memorySearch: async (opts) => {
        audiences.push(opts.audience);
        return [memory(`mem-${opts.audience ?? 'none'}`, opts.memoryType ?? 'semantic', `${opts.audience ?? 'none'} memory`, {
          scope: { visibility: 'workspace', workspaceId: 'workspace-1' },
        })];
      },
    });

    const plannerResult = await compiler.compile({
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      query: 'planner memory',
      memoryTypes: ['semantic'],
      task: { title: 'Compile planner context' },
    });

    const plannerEntries = section(plannerResult.pack.sections, 'memory_working_set').content as Array<{ id: string }>;
    expect(plannerEntries).toEqual([expect.objectContaining({ id: 'mem-planner' })]);

    const auditResult = await compiler.compile({
      workspaceId: 'workspace-1',
      agentId: 'agent-1',
      query: 'audit memory',
      memoryAudience: 'audit',
      memoryTypes: ['semantic'],
      task: { title: 'Compile audit context' },
    });

    const auditEntries = section(auditResult.pack.sections, 'memory_working_set').content as Array<{ id: string }>;
    expect(auditEntries).toEqual([expect.objectContaining({ id: 'mem-audit' })]);
    expect(audiences).toEqual(['planner', 'audit']);
  });

  it('keeps compiling when a run evidence artifact is corrupt and exposes a bounded error item', async () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const artifact = await artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.research_evidence.v1',
      createdAt: '2026-05-01T00:02:00.000Z',
      runId: 'run-1',
      query: 'source',
      queryHash: 'query-hash',
      sourceMode: 'operator_supplied',
      effectsExecuted: [],
      sources: [],
      notes: [],
    }, { runId: 'run-1', meta: { artifactKind: 'research_evidence' } });
    await writeFile(artifact.uri, '{"tampered":true}');

    const compiler = new ContextCompiler({ artifactStore });
    const result = await compiler.compile({
      workspaceId: 'workspace-1',
      runId: 'run-1',
      task: { title: 'Compile context' },
    });

    const evidence = section(result.pack.sections, 'run_evidence').content as { items: Array<Record<string, unknown>> };
    expect(evidence.items).toEqual([
      expect.objectContaining({
        artifactKind: 'research_evidence',
        artifactId: artifact.id,
        status: 'evidence_unavailable',
        reason: expect.stringContaining('sha256 mismatch'),
      }),
    ]);
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain(root);
    expect(JSON.stringify(section(result.pack.sections, 'run_evidence'))).not.toContain(artifact.uri);
  });

  it('includes sanitized actor work proofs from child actor runs in run evidence', async () => {
    const root = tmpDir();
    cleanupDirs.push(root);
    const artifactStore = new ArtifactStore({ rootDir: path.join(root, 'artifacts') });
    const ledger = new EventLedger(path.join(root, 'events.jsonl'));
    const runLedger = new RunLedger({ ledger });
    const parent = await runLedger.createRun({
      run_id: 'run-parent',
      task_id: 'Build product',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      branch_or_worktree_id: 'main',
      mode: 'pm',
    });
    const child = await runLedger.createRun({
      run_id: 'run-parent:actor:planner',
      parent_run_id: parent.run_id,
      task_id: 'Planner actor',
      workspace_id: 'workspace-1',
      repo_id: 'repo-1',
      branch_or_worktree_id: 'main',
      mode: 'autonomous',
    });
    const proof = await artifactStore.writeJSON('summary', {
      schemaVersion: 'pyrfor.actor_work_proof.v1',
      runId: parent.run_id,
      proofRunId: child.run_id,
      actorId: 'actor-planner',
      nodeId: 'mailbox-node-1',
      task: 'Review /Users/alice/private design with token=secret-value',
      completedAt: '2026-05-01T00:10:00.000Z',
      owner: 'operator',
      summary: 'Planner completed with password=secret-value and https://github.com/acme/pyrfor/issues/1?token=secret-value',
      output: 'Output references C:\\Users\\alice\\secret.txt and \\\\server\\share\\secret.txt',
      proof: { rawNotes: `Do not include raw proof ${root}/secret.txt` },
    }, {
      runId: child.run_id,
      meta: { artifactKind: 'actor_work_proof', parentRunId: parent.run_id, actorId: 'actor-planner', nodeId: 'mailbox-node-1' },
    });

    const compiler = new ContextCompiler({ artifactStore, runLedger });
    const result = await compiler.compile({
      workspaceId: 'workspace-1',
      runId: parent.run_id,
      task: { title: 'Compile actor proof context' },
    });

    const evidence = section(result.pack.sections, 'run_evidence').content as { items: Array<Record<string, unknown>> };
    expect(evidence.items).toEqual([
      expect.objectContaining({
        artifactKind: 'actor_work_proof',
        artifactId: proof.id,
        proofRunId: child.run_id,
        actorId: 'actor-planner',
        nodeId: 'mailbox-node-1',
        summary: expect.stringContaining('password=[redacted]'),
        output: expect.stringContaining('[redacted-path]'),
      }),
    ]);
    const evidenceContent = JSON.stringify(section(result.pack.sections, 'run_evidence'));
    expect(evidenceContent).not.toContain('secret-value');
    expect(evidenceContent).not.toContain('/Users/alice');
    expect(evidenceContent).not.toContain('C:\\Users\\alice');
    expect(evidenceContent).not.toContain('\\\\server\\share');
    expect(evidenceContent).not.toContain(root);
    expect(evidenceContent).not.toContain('rawNotes');
    expect(evidenceContent).not.toContain('https://github.com/acme/pyrfor/issues/1?token=');
    expect(evidenceContent).toContain('[redacted-url host=github.com hash=');
    await ledger.close();
  });
});

function section(sections: ContextPackSection[], id: string): ContextPackSection {
  const found = sections.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing section ${id}`);
  return found;
}

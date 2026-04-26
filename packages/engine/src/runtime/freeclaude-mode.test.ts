// @vitest-environment node
/**
 * freeclaude-mode.test.ts — Unit tests for FreeClaudeRuntime and helpers.
 *
 * Uses real EventLedger (JSONL on disk) and ArtifactStore backed by
 * unique temporary directories that are cleaned up in afterEach.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  FreeClaudeRuntime,
  hashPlan,
  defaultProfileFor,
  type FreeClaudeConfig,
  type FreeClaudeMode,
} from './freeclaude-mode';
import { EventLedger } from './event-ledger';
import {
  PermissionEngine,
  ToolRegistry,
  registerStandardTools,
} from './permission-engine';
import { ArtifactStore } from './artifact-model';

// Silence noisy logger output during tests
process.env['PYRFOR_LOG_LEVEL'] = 'silent';

// ====== Helpers ==============================================================

function tmpDir(): string {
  return path.join(os.tmpdir(), `freeclaude-test-${randomUUID()}`);
}

function makeRuntime(
  mode: FreeClaudeMode = 'chat',
  overrides?: Partial<FreeClaudeConfig>,
): {
  rt: FreeClaudeRuntime;
  ledger: EventLedger;
  artifacts: ArtifactStore;
  base: string;
} {
  const base = tmpDir();
  const ledger = new EventLedger(path.join(base, 'events.jsonl'));
  const registry = new ToolRegistry();
  registerStandardTools(registry);
  const permissions = new PermissionEngine(registry, { profile: 'standard' });
  const artifacts = new ArtifactStore({ rootDir: path.join(base, 'artifacts') });

  const cfg: FreeClaudeConfig = {
    mode,
    workspaceId: 'ws-test',
    rootDir: base,
    ledgerPath: path.join(base, 'events.jsonl'),
    artifactRoot: path.join(base, 'artifacts'),
    ...overrides,
  };

  const rt = new FreeClaudeRuntime(cfg, { ledger, permissions, artifacts });
  return { rt, ledger, artifacts, base };
}

// ====== Tests ================================================================

describe('hashPlan (pure helper)', () => {
  it('is deterministic for the same input', () => {
    expect(hashPlan('my plan')).toBe(hashPlan('my plan'));
  });

  it('differs for different inputs', () => {
    expect(hashPlan('plan A')).not.toBe(hashPlan('plan B'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('defaultProfileFor (pure helper)', () => {
  it('returns standard profile for chat', () => {
    expect(defaultProfileFor('chat').permissionProfile).toBe('standard');
  });

  it('returns standard profile for edit', () => {
    expect(defaultProfileFor('edit').permissionProfile).toBe('standard');
  });

  it('returns autonomous profile for autonomous', () => {
    expect(defaultProfileFor('autonomous').permissionProfile).toBe('autonomous');
  });

  it('returns autonomous profile for pm', () => {
    expect(defaultProfileFor('pm').permissionProfile).toBe('autonomous');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('FreeClaudeRuntime', () => {
  let base: string;
  let rt: FreeClaudeRuntime;
  let ledger: EventLedger;
  let artifacts: ArtifactStore;

  beforeEach(() => {
    const setup = makeRuntime('chat');
    rt = setup.rt;
    ledger = setup.ledger;
    artifacts = setup.artifacts;
    base = setup.base;
  });

  afterEach(async () => {
    await ledger.close();
    await rm(base, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  });

  // ── startRun ──────────────────────────────────────────────────────────────

  it('startRun(chat) produces status "running" and emits run.created', async () => {
    const session = await rt.startRun({ task: 'hello world' });
    expect(session.status).toBe('running');
    expect(session.mode).toBe('chat');
    expect(session.runId).toBeTruthy();
    expect(session.sessionId).toBeTruthy();

    const events = await ledger.byRun(session.runId);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('run.created');
  });

  it('startRun(edit) produces status "running"', async () => {
    const { rt: editRt, ledger: editLedger, base: editBase } = makeRuntime('edit');
    try {
      const session = await editRt.startRun({ task: 'edit something' });
      expect(session.status).toBe('running');
      const events = await editLedger.byRun(session.runId);
      expect(events[0]!.type).toBe('run.created');
    } finally {
      await editLedger.close();
      await rm(editBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  it('startRun(autonomous) produces status "planned"', async () => {
    const { rt: aRt, ledger: aLedger, base: aBase } = makeRuntime('autonomous');
    try {
      const session = await aRt.startRun({ task: 'autonomous task' });
      expect(session.status).toBe('planned');
    } finally {
      await aLedger.close();
      await rm(aBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  it('startRun(pm) produces status "planned"', async () => {
    const { rt: pmRt, ledger: pmLedger, base: pmBase } = makeRuntime('pm');
    try {
      const session = await pmRt.startRun({ task: 'pm task' });
      expect(session.status).toBe('planned');
    } finally {
      await pmLedger.close();
      await rm(pmBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  // ── proposePlan ───────────────────────────────────────────────────────────

  it('proposePlan emits plan.proposed + approval.requested and returns deterministic hash', async () => {
    const { rt: aRt, ledger: aLedger, base: aBase } = makeRuntime('autonomous');
    try {
      const session = await aRt.startRun({ task: 'needs a plan' });
      const plan = 'Step 1: do thing\nStep 2: profit';

      const { planHash } = await aRt.proposePlan(session.runId, plan);

      // Hash must be deterministic
      expect(planHash).toBe(hashPlan(plan));

      const events = await aLedger.byRun(session.runId);
      const types = events.map((e) => e.type);
      expect(types).toContain('plan.proposed');
      expect(types).toContain('approval.requested');
      expect(types.filter((t) => t === 'plan.proposed')).toHaveLength(1);
      expect(types.filter((t) => t === 'approval.requested')).toHaveLength(1);
    } finally {
      await aLedger.close();
      await rm(aBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  // ── approvePlan ───────────────────────────────────────────────────────────

  it('approvePlan transitions to running and emits approval.granted', async () => {
    const { rt: aRt, ledger: aLedger, base: aBase } = makeRuntime('autonomous');
    try {
      const session = await aRt.startRun({ task: 'approve me' });
      await aRt.proposePlan(session.runId, 'do the thing');
      await aRt.approvePlan(session.runId, 'user@example.com');

      const updated = aRt.getSession(session.runId);
      expect(updated?.status).toBe('running');

      const events = await aLedger.byRun(session.runId);
      expect(events.some((e) => e.type === 'approval.granted')).toBe(true);
    } finally {
      await aLedger.close();
      await rm(aBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  // ── denyPlan ──────────────────────────────────────────────────────────────

  it('denyPlan transitions to cancelled and emits approval.denied', async () => {
    const { rt: aRt, ledger: aLedger, base: aBase } = makeRuntime('autonomous');
    try {
      const session = await aRt.startRun({ task: 'deny me' });
      await aRt.proposePlan(session.runId, 'risky plan');
      await aRt.denyPlan(session.runId, 'too risky');

      const updated = aRt.getSession(session.runId);
      expect(updated?.status).toBe('cancelled');

      const events = await aLedger.byRun(session.runId);
      expect(events.some((e) => e.type === 'approval.denied')).toBe(true);
    } finally {
      await aLedger.close();
      await rm(aBase, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  });

  // ── recordToolCall ────────────────────────────────────────────────────────

  it('recordToolCall on auto_allow tool (read_file) returns allowed:true', async () => {
    const session = await rt.startRun({ task: 'use tools' });
    const result = await rt.recordToolCall(
      session.runId,
      'read_file',
      { path: '/some/file.ts' },
      { workspaceId: 'ws-test', sessionId: session.sessionId },
    );
    expect(result.allowed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('recordToolCall on ask_every_time tool (shell_exec) returns allowed:false with permission_required', async () => {
    const session = await rt.startRun({ task: 'use shell' });
    const result = await rt.recordToolCall(
      session.runId,
      'shell_exec',
      { command: 'rm -rf /' },
      { workspaceId: 'ws-test', sessionId: session.sessionId },
    );
    expect(result.allowed).toBe(false);
    expect(result.error).toBe('permission_required');
  });

  // ── recordArtifact ────────────────────────────────────────────────────────

  it('recordArtifact writes file and emits artifact.created with correct ref', async () => {
    const session = await rt.startRun({ task: 'produce artifact' });
    const content = 'artifact content here';
    const ref = await rt.recordArtifact(session.runId, 'log', content);

    expect(ref.id).toBeTruthy();
    expect(ref.kind).toBe('log');
    expect(ref.uri).toBeTruthy();
    expect(ref.bytes).toBe(Buffer.byteLength(content, 'utf-8'));

    const events = await ledger.byRun(session.runId);
    const artifactEvent = events.find((e) => e.type === 'artifact.created');
    expect(artifactEvent).toBeDefined();
    if (artifactEvent?.type === 'artifact.created') {
      expect(artifactEvent.artifact_id).toBe(ref.id);
    }
  });

  // ── completeRun ───────────────────────────────────────────────────────────

  it('completeRun transitions to completed and emits run.completed', async () => {
    const session = await rt.startRun({ task: 'finish me' });
    await rt.completeRun(session.runId, 'completed', 'all done');

    const updated = rt.getSession(session.runId);
    expect(updated?.status).toBe('completed');
    expect(updated?.endedAt).toBeTruthy();

    const events = await ledger.byRun(session.runId);
    expect(events.some((e) => e.type === 'run.completed')).toBe(true);
  });

  it('recordArtifact rejects after completeRun (run not active)', async () => {
    const session = await rt.startRun({ task: 'done run' });
    await rt.completeRun(session.runId, 'completed');

    await expect(
      rt.recordArtifact(session.runId, 'summary', 'too late'),
    ).rejects.toThrow(/not active/);
  });

  // ── listActiveRuns ────────────────────────────────────────────────────────

  it('listActiveRuns excludes completed runs', async () => {
    const s1 = await rt.startRun({ task: 'active run' });
    const s2 = await rt.startRun({ task: 'completed run' });
    await rt.completeRun(s2.runId, 'completed');

    const active = rt.listActiveRuns();
    const ids = active.map((s) => s.runId);
    expect(ids).toContain(s1.runId);
    expect(ids).not.toContain(s2.runId);
  });

  // ── getSession ────────────────────────────────────────────────────────────

  it('getSession returns undefined for unknown runId', () => {
    expect(rt.getSession('nonexistent-id')).toBeUndefined();
  });
});

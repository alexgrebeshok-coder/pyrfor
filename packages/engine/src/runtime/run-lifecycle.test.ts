/**
 * run-lifecycle.test.ts — Unit tests for the Run Lifecycle state machine.
 *
 * Coverage:
 * - Valid transitions for every status
 * - Invalid transitions throw InvalidTransitionError
 * - Terminal status detection
 * - artifact_refs append & dedup
 * - Auto-generated run_id is UUID v4 format
 * - create() defaults: status='draft', artifact_refs=[], timestamps set
 * - withError() sets status='failed' only from allowed source statuses
 */

import { describe, it, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  InvalidTransitionError,
  RunLifecycle,
  type RunRecord,
  type RunStatus,
} from './run-lifecycle';

// ============================================
// Helpers
// ============================================

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build a minimal RunRecord in the given status (bypassing transition rules). */
function makeRecord(status: RunStatus, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    run_id: crypto.randomUUID(),
    task_id: 'task-1',
    workspace_id: 'ws-1',
    repo_id: 'repo-1',
    branch_or_worktree_id: 'main',
    mode: 'chat',
    model_profile: 'default',
    provider_route: 'openai',
    permission_profile: { profile: 'standard' },
    budget_profile: {},
    context_snapshot_hash: 'abc123',
    prompt_snapshot_hash: 'def456',
    artifact_refs: [],
    status,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ============================================
// create() defaults
// ============================================

describe('RunLifecycle.create()', () => {
  it('sets status to draft', () => {
    const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'chat' });
    expect(r.status).toBe('draft');
  });

  it('sets artifact_refs to empty array', () => {
    const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'edit' });
    expect(r.artifact_refs).toEqual([]);
  });

  it('sets created_at and updated_at as ISO strings', () => {
    const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'autonomous' });
    expect(() => new Date(r.created_at)).not.toThrow();
    expect(() => new Date(r.updated_at)).not.toThrow();
    expect(new Date(r.created_at).toISOString()).toBe(r.created_at);
    expect(new Date(r.updated_at).toISOString()).toBe(r.updated_at);
  });

  it('auto-generates a UUID v4 run_id when absent', () => {
    const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'pm' });
    expect(r.run_id).toMatch(UUID_V4_RE);
  });

  it('respects a caller-supplied run_id', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'chat', run_id: id });
    expect(r.run_id).toBe(id);
  });

  it('generates distinct run_ids on successive calls', () => {
    const a = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'chat' });
    const b = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'chat' });
    expect(a.run_id).not.toBe(b.run_id);
  });
});

// ============================================
// UUID v4 format
// ============================================

describe('auto-generated run_id', () => {
  it('matches UUID v4 regex', () => {
    for (let i = 0; i < 20; i++) {
      const r = RunLifecycle.create({ workspace_id: 'ws', repo_id: 'r', mode: 'chat' });
      expect(r.run_id).toMatch(UUID_V4_RE);
    }
  });
});

// ============================================
// canTransition / transition — valid paths
// ============================================

describe('valid transitions', () => {
  const cases: [RunStatus, RunStatus][] = Object.entries(ALLOWED_TRANSITIONS).flatMap(
    ([from, tos]) => (tos as RunStatus[]).map(to => [from as RunStatus, to]),
  );

  it.each(cases)('%s → %s is allowed', (from, to) => {
    expect(RunLifecycle.canTransition(from, to)).toBe(true);
  });

  it.each(cases)('transition(%s → %s) returns new record with updated status', (from, to) => {
    const record = makeRecord(from);
    const next = RunLifecycle.transition(record, to);
    expect(next.status).toBe(to);
    expect(next).not.toBe(record); // new object
  });
});

// ============================================
// canTransition / transition — invalid paths
// ============================================

describe('invalid transitions throw InvalidTransitionError', () => {
  const allStatuses = Object.keys(ALLOWED_TRANSITIONS) as RunStatus[];

  /** Collect every (from, to) pair that is NOT in ALLOWED_TRANSITIONS. */
  const invalidCases: [RunStatus, RunStatus][] = [];
  for (const from of allStatuses) {
    for (const to of allStatuses) {
      if (!ALLOWED_TRANSITIONS[from].includes(to)) {
        invalidCases.push([from, to]);
      }
    }
  }

  it.each(invalidCases)('%s → %s throws InvalidTransitionError', (from, to) => {
    const record = makeRecord(from);
    expect(() => RunLifecycle.transition(record, to)).toThrow(InvalidTransitionError);
  });

  it('InvalidTransitionError carries from/to fields', () => {
    const record = makeRecord('draft');
    try {
      RunLifecycle.transition(record, 'completed');
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.from).toBe('draft');
      expect(err.to).toBe('completed');
    }
  });

  it('canTransition returns false for invalid pairs', () => {
    expect(RunLifecycle.canTransition('draft', 'completed')).toBe(false);
    expect(RunLifecycle.canTransition('archived', 'running')).toBe(false);
  });
});

// ============================================
// Terminal status detection
// ============================================

describe('isTerminal()', () => {
  it('archived is terminal', () => {
    expect(RunLifecycle.isTerminal('archived')).toBe(true);
  });

  const nonTerminal: RunStatus[] = [
    'draft', 'planned', 'awaiting_approval', 'running',
    'blocked', 'completed', 'failed', 'cancelled', 'replayable',
  ];

  it.each(nonTerminal)('%s is not terminal', status => {
    expect(RunLifecycle.isTerminal(status)).toBe(false);
  });
});

// ============================================
// withArtifact
// ============================================

describe('withArtifact()', () => {
  it('appends a new ref', () => {
    const r = makeRecord('running');
    const next = RunLifecycle.withArtifact(r, 'sha256:abc');
    expect(next.artifact_refs).toContain('sha256:abc');
  });

  it('deduplicates existing refs', () => {
    const r = makeRecord('running', { artifact_refs: ['sha256:abc'] });
    const next = RunLifecycle.withArtifact(r, 'sha256:abc');
    expect(next.artifact_refs.filter(x => x === 'sha256:abc')).toHaveLength(1);
  });

  it('returns the same object reference when ref already present', () => {
    const r = makeRecord('running', { artifact_refs: ['sha256:abc'] });
    const next = RunLifecycle.withArtifact(r, 'sha256:abc');
    expect(next).toBe(r);
  });

  it('preserves existing refs while adding a new one', () => {
    const r = makeRecord('running', { artifact_refs: ['sha256:aaa', 'sha256:bbb'] });
    const next = RunLifecycle.withArtifact(r, 'sha256:ccc');
    expect(next.artifact_refs).toEqual(['sha256:aaa', 'sha256:bbb', 'sha256:ccc']);
  });

  it('does not mutate the original record', () => {
    const r = makeRecord('running');
    RunLifecycle.withArtifact(r, 'sha256:xyz');
    expect(r.artifact_refs).toHaveLength(0);
  });
});

// ============================================
// withError
// ============================================

describe('withError()', () => {
  const failableSources: RunStatus[] = ['running', 'blocked'];

  it.each(failableSources)('sets status=failed from %s', from => {
    const r = makeRecord(from);
    const next = RunLifecycle.withError(r, 'E001', 'something went wrong');
    expect(next.status).toBe('failed');
  });

  it('attaches error code and message', () => {
    const r = makeRecord('running');
    const next = RunLifecycle.withError(r, 'TIMEOUT', 'exceeded wall time');
    expect(next.error).toEqual({ code: 'TIMEOUT', message: 'exceeded wall time' });
  });

  it('throws InvalidTransitionError from non-failable statuses', () => {
    const nonFailable: RunStatus[] = [
      'draft', 'planned', 'awaiting_approval', 'completed',
      'cancelled', 'replayable', 'archived',
    ];
    for (const status of nonFailable) {
      const r = makeRecord(status);
      expect(() => RunLifecycle.withError(r, 'E', 'msg')).toThrow(InvalidTransitionError);
    }
  });

  it('does not mutate the original record', () => {
    const r = makeRecord('running');
    RunLifecycle.withError(r, 'E', 'msg');
    expect(r.status).toBe('running');
    expect(r.error).toBeUndefined();
  });
});

// ============================================
// Immutability — transition does not mutate
// ============================================

describe('transition() immutability', () => {
  it('returns a new object, does not mutate input', () => {
    const r = makeRecord('draft');
    const next = RunLifecycle.transition(r, 'planned');
    expect(r.status).toBe('draft');
    expect(next).not.toBe(r);
  });
});

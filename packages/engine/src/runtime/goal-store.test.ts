import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GoalStore } from './goal-store';

describe('GoalStore', () => {
  let dir: string;
  let store: GoalStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pyrfor-goals-test-'));
    store = new GoalStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a goal and lists it', () => {
    const goal = store.create('Finish the project');
    expect(goal.id).toBeTruthy();
    expect(goal.status).toBe('active');
    const list = store.list('active');
    expect(list).toHaveLength(1);
    expect(list[0]!.description).toBe('Finish the project');
  });

  it('markDone changes status', () => {
    const goal = store.create('Do something');
    const updated = store.markDone(goal.id);
    expect(updated?.status).toBe('done');
    expect(store.list('active')).toHaveLength(0);
  });

  it('cancel changes status', () => {
    const goal = store.create('Cancelled goal');
    store.cancel(goal.id);
    expect(store.list('cancelled')).toHaveLength(1);
  });

  it('returns null for unknown id', () => {
    expect(store.markDone('NONEXISTENT')).toBeNull();
  });
});

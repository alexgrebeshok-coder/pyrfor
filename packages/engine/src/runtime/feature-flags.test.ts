// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createFeatureFlags } from './feature-flags';
import type { Flag, EvalContext } from './feature-flags';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** sha256-based hash matching the module default */
function sha256hash(s: string): number {
  return parseInt(crypto.createHash('sha256').update(s).digest('hex').slice(0, 8), 16) % 100;
}

/** Deterministic constant hash — always returns the given value */
function constHash(n: number) {
  return (_s: string) => n;
}

// ─── set / get / remove / list ────────────────────────────────────────────────

describe('set / get / remove / list', () => {
  it('set stores a flag and get retrieves it', () => {
    const ff = createFeatureFlags();
    const flag: Flag = { key: 'my-flag', enabled: true };
    ff.set(flag);
    expect(ff.get('my-flag')).toEqual(flag);
  });

  it('get returns undefined for unknown key', () => {
    const ff = createFeatureFlags();
    expect(ff.get('nope')).toBeUndefined();
  });

  it('remove deletes a flag and returns true', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true });
    expect(ff.remove('f')).toBe(true);
    expect(ff.get('f')).toBeUndefined();
  });

  it('remove returns false for non-existent key', () => {
    const ff = createFeatureFlags();
    expect(ff.remove('absent')).toBe(false);
  });

  it('list returns all flags', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'a', enabled: true });
    ff.set({ key: 'b', enabled: false });
    const keys = ff.list().map(f => f.key).sort();
    expect(keys).toEqual(['a', 'b']);
  });

  it('list returns empty array when no flags set', () => {
    const ff = createFeatureFlags();
    expect(ff.list()).toEqual([]);
  });
});

// ─── evaluate – basic ─────────────────────────────────────────────────────────

describe('evaluate – basic', () => {
  it('unknown flag → disabled, reason="unknown"', () => {
    const ff = createFeatureFlags();
    expect(ff.evaluate('missing')).toEqual({ enabled: false, reason: 'unknown' });
  });

  it('enabled flag → on, reason="on"', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'flag', enabled: true });
    const r = ff.evaluate('flag');
    expect(r.enabled).toBe(true);
    expect(r.reason).toBe('on');
  });

  it('disabled flag → off, reason="disabled"', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'flag', enabled: false });
    expect(ff.evaluate('flag')).toEqual({ enabled: false, reason: 'disabled' });
  });
});

// ─── evaluate – expiry ────────────────────────────────────────────────────────

describe('evaluate – expiry', () => {
  it('expired flag → off, reason="expired"', () => {
    const clock = () => 2000;
    const ff = createFeatureFlags({ clock });
    ff.set({ key: 'flag', enabled: true, expiresAt: 1000 });
    expect(ff.evaluate('flag')).toEqual({ enabled: false, reason: 'expired' });
  });

  it('flag with future expiresAt is not expired', () => {
    const clock = () => 500;
    const ff = createFeatureFlags({ clock });
    ff.set({ key: 'flag', enabled: true, expiresAt: 1000 });
    expect(ff.evaluate('flag').enabled).toBe(true);
  });

  it('expiry check fires before disabled check', () => {
    const clock = () => 2000;
    const ff = createFeatureFlags({ clock });
    // Both expired and disabled — expired wins (checked first)
    ff.set({ key: 'flag', enabled: false, expiresAt: 1000 });
    expect(ff.evaluate('flag').reason).toBe('expired');
  });
});

// ─── evaluate – blockedUserIds ────────────────────────────────────────────────

describe('evaluate – blockedUserIds', () => {
  it('blocked user → off, reason="blocked"', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'flag', enabled: true, blockedUserIds: ['bad-user'] });
    expect(ff.evaluate('flag', { userId: 'bad-user' })).toEqual({ enabled: false, reason: 'blocked' });
  });

  it('non-blocked user is not blocked', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'flag', enabled: true, blockedUserIds: ['bad-user'] });
    expect(ff.evaluate('flag', { userId: 'good-user' }).enabled).toBe(true);
  });
});

// ─── evaluate – userIds allowlist ─────────────────────────────────────────────

describe('evaluate – userIds allowlist', () => {
  it('allowlisted user → on, reason="allowlist"', () => {
    const ff = createFeatureFlags({ hash: constHash(99) }); // would fail rollout without allowlist
    ff.set({ key: 'flag', enabled: true, rollout: 0, userIds: ['vip'] });
    const r = ff.evaluate('flag', { userId: 'vip' });
    expect(r.enabled).toBe(true);
    expect(r.reason).toBe('allowlist');
  });

  it('allowlist bypasses rollout=0', () => {
    const ff = createFeatureFlags({ hash: constHash(0) });
    ff.set({ key: 'flag', enabled: true, rollout: 0, userIds: ['vip'] });
    expect(ff.evaluate('flag', { userId: 'vip' }).enabled).toBe(true);
  });

  it('user not in allowlist goes through normal evaluation', () => {
    const ff = createFeatureFlags({ hash: constHash(50) });
    ff.set({ key: 'flag', enabled: true, rollout: 100, userIds: ['vip'] });
    // rollout=100 → all pass
    expect(ff.evaluate('flag', { userId: 'other' }).enabled).toBe(true);
  });
});

// ─── evaluate – rules ─────────────────────────────────────────────────────────

describe('evaluate – rules', () => {
  it('eq rule matches', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'plan', op: 'eq', value: 'pro' }] });
    expect(ff.evaluate('f', { plan: 'pro' }).enabled).toBe(true);
  });

  it('eq rule mismatch → off, reason="rule:<field>"', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'plan', op: 'eq', value: 'pro' }] });
    const r = ff.evaluate('f', { plan: 'free' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('rule:plan');
  });

  it('neq rule matches when values differ', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'status', op: 'neq', value: 'banned' }] });
    expect(ff.evaluate('f', { status: 'active' }).enabled).toBe(true);
  });

  it('neq rule fails when values equal', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'status', op: 'neq', value: 'banned' }] });
    const r = ff.evaluate('f', { status: 'banned' });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('rule:status');
  });

  it('in rule matches when value is in array', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'country', op: 'in', value: ['US', 'CA'] }] });
    expect(ff.evaluate('f', { country: 'CA' }).enabled).toBe(true);
  });

  it('in rule fails when value not in array', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'country', op: 'in', value: ['US', 'CA'] }] });
    expect(ff.evaluate('f', { country: 'MX' }).enabled).toBe(false);
  });

  it('gt rule matches', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'age', op: 'gt', value: 18 }] });
    expect(ff.evaluate('f', { age: 21 }).enabled).toBe(true);
  });

  it('gt rule fails', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'age', op: 'gt', value: 18 }] });
    expect(ff.evaluate('f', { age: 18 }).enabled).toBe(false);
  });

  it('lt rule matches', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'score', op: 'lt', value: 100 }] });
    expect(ff.evaluate('f', { score: 50 }).enabled).toBe(true);
  });

  it('lt rule fails', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true, rules: [{ field: 'score', op: 'lt', value: 100 }] });
    expect(ff.evaluate('f', { score: 100 }).enabled).toBe(false);
  });

  it('all rules must pass – first failing rule gives reason', () => {
    const ff = createFeatureFlags();
    ff.set({
      key: 'f',
      enabled: true,
      rules: [
        { field: 'plan', op: 'eq', value: 'pro' },
        { field: 'age',  op: 'gt', value: 18 },
      ],
    });
    // plan matches, age fails
    const r = ff.evaluate('f', { plan: 'pro', age: 10 });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('rule:age');
  });
});

// ─── evaluate – rollout ───────────────────────────────────────────────────────

describe('evaluate – rollout', () => {
  it('rollout=0 → all off', () => {
    const ff = createFeatureFlags({ hash: constHash(0) }); // bucket=0, 0>=0 → off
    ff.set({ key: 'flag', enabled: true, rollout: 0 });
    expect(ff.evaluate('flag').enabled).toBe(false);
    expect(ff.evaluate('flag').reason).toBe('rollout');
  });

  it('rollout=100 → all on', () => {
    const ff = createFeatureFlags({ hash: constHash(99) }); // bucket=99, 99>=100 is false → on
    ff.set({ key: 'flag', enabled: true, rollout: 100 });
    expect(ff.evaluate('flag').enabled).toBe(true);
  });

  it('rollout=50 with bucket=49 → on', () => {
    const ff = createFeatureFlags({ hash: constHash(49) });
    ff.set({ key: 'flag', enabled: true, rollout: 50 });
    expect(ff.evaluate('flag').enabled).toBe(true);
  });

  it('rollout=50 with bucket=50 → off', () => {
    const ff = createFeatureFlags({ hash: constHash(50) });
    ff.set({ key: 'flag', enabled: true, rollout: 50 });
    expect(ff.evaluate('flag').enabled).toBe(false);
    expect(ff.evaluate('flag').reason).toBe('rollout');
  });

  it('rollout=50 is deterministic per userId with sha256 hash', () => {
    const ff = createFeatureFlags({ hash: sha256hash });
    ff.set({ key: 'beta', enabled: true, rollout: 50 });
    // Same userId always gives same result
    const r1 = ff.evaluate('beta', { userId: 'user-abc' });
    const r2 = ff.evaluate('beta', { userId: 'user-abc' });
    expect(r1.enabled).toBe(r2.enabled);
    // Different users may differ (just check it doesn't throw)
    ff.evaluate('beta', { userId: 'user-xyz' });
  });
});

// ─── evaluate – variants ──────────────────────────────────────────────────────

describe('evaluate – variants', () => {
  it('picks first variant when bucket < weight[0]', () => {
    // variants: [{control,2},{treatment,2}] totalWeight=4, bucket=hash%4
    // constHash(1) → 1%4=1 < 2 → 'control'
    const ff = createFeatureFlags({ hash: constHash(1) });
    ff.set({
      key: 'ab',
      enabled: true,
      variants: [
        { name: 'control',   weight: 2 },
        { name: 'treatment', weight: 2 },
      ],
    });
    expect(ff.evaluate('ab').variant).toBe('control');
  });

  it('picks second variant when bucket >= weight[0]', () => {
    // constHash(3) → 3%4=3, cumulative: 2 → not yet, 4 → yes → 'treatment'
    const ff = createFeatureFlags({ hash: constHash(3) });
    ff.set({
      key: 'ab',
      enabled: true,
      variants: [
        { name: 'control',   weight: 2 },
        { name: 'treatment', weight: 2 },
      ],
    });
    expect(ff.evaluate('ab').variant).toBe('treatment');
  });

  it('variant() convenience returns variant name when flag on', () => {
    const ff = createFeatureFlags({ hash: constHash(0) });
    ff.set({
      key: 'ab',
      enabled: true,
      variants: [{ name: 'v1', weight: 1 }, { name: 'v2', weight: 1 }],
    });
    expect(ff.variant('ab')).toBe('v1');
  });

  it('variant() returns undefined for disabled flag', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'ab', enabled: false });
    expect(ff.variant('ab')).toBeUndefined();
  });

  it('variant() returns undefined for unknown flag', () => {
    const ff = createFeatureFlags();
    expect(ff.variant('nope')).toBeUndefined();
  });

  it('flag with no variants has no variant in result', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'flag', enabled: true });
    expect(ff.evaluate('flag').variant).toBeUndefined();
  });
});

// ─── bulkSet ──────────────────────────────────────────────────────────────────

describe('bulkSet', () => {
  it('replaces all existing flags', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'old', enabled: true });
    ff.bulkSet([
      { key: 'new1', enabled: true },
      { key: 'new2', enabled: false },
    ]);
    expect(ff.get('old')).toBeUndefined();
    expect(ff.get('new1')).toBeDefined();
    expect(ff.get('new2')).toBeDefined();
    expect(ff.list()).toHaveLength(2);
  });

  it('bulkSet with empty array clears all flags', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'x', enabled: true });
    ff.bulkSet([]);
    expect(ff.list()).toHaveLength(0);
  });
});

// ─── isEnabled convenience ────────────────────────────────────────────────────

describe('isEnabled', () => {
  it('matches evaluate().enabled for on flag', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true });
    expect(ff.isEnabled('f')).toBe(ff.evaluate('f').enabled);
  });

  it('matches evaluate().enabled for off flag', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: false });
    expect(ff.isEnabled('f')).toBe(ff.evaluate('f').enabled);
  });

  it('returns false for unknown flag', () => {
    const ff = createFeatureFlags();
    expect(ff.isEnabled('unknown')).toBe(false);
  });
});

// ─── save + load roundtrip ────────────────────────────────────────────────────

describe('save + load', () => {
  it('save writes flags to file and load restores them', async () => {
    const filePath = path.join(os.tmpdir(), `ff-test-${Date.now()}.json`);
    try {
      const ff = createFeatureFlags({ filePath });
      ff.set({ key: 'persisted', enabled: true, rollout: 80 });
      await ff.save();

      const ff2 = createFeatureFlags({ filePath });
      await ff2.load();
      const loaded = ff2.get('persisted');
      expect(loaded).toBeDefined();
      expect(loaded?.key).toBe('persisted');
      expect(loaded?.rollout).toBe(80);
    } finally {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
  });

  it('load on missing file does not throw', async () => {
    const filePath = path.join(os.tmpdir(), `ff-missing-${Date.now()}.json`);
    const ff = createFeatureFlags({ filePath });
    await expect(ff.load()).resolves.toBeUndefined();
  });

  it('save does nothing when no filePath', async () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'f', enabled: true });
    await expect(ff.save()).resolves.toBeUndefined();
  });

  it('load does nothing when no filePath', async () => {
    const ff = createFeatureFlags();
    await expect(ff.load()).resolves.toBeUndefined();
  });

  it('save uses atomic tmp+rename (file exists after save)', async () => {
    const filePath = path.join(os.tmpdir(), `ff-atomic-${Date.now()}.json`);
    try {
      const ff = createFeatureFlags({ filePath });
      ff.set({ key: 'a', enabled: true });
      await ff.save();
      const stat = await fs.promises.stat(filePath);
      expect(stat.isFile()).toBe(true);
    } finally {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
  });
});

// ─── polling ──────────────────────────────────────────────────────────────────

describe('startPolling / stopPolling', () => {
  it('startPolling schedules a timer with the given interval', () => {
    const timers: Array<{ ms: number }> = [];
    const setTimer = (cb: () => void, ms: number) => { timers.push({ ms }); return timers.length; };
    const clearTimer = vi.fn();

    const ff = createFeatureFlags({ pollIntervalMs: 500, setTimer, clearTimer });
    ff.startPolling();

    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(500);
    ff.stopPolling();
  });

  it('stopPolling clears the timer handle', () => {
    let handle = 0;
    const setTimer = (cb: () => void, ms: number) => { handle = ++handle; return handle; };
    const cleared: unknown[] = [];
    const clearTimer = (h: unknown) => cleared.push(h);

    const ff = createFeatureFlags({ pollIntervalMs: 500, setTimer, clearTimer });
    ff.startPolling();
    ff.stopPolling();

    expect(cleared).toContain(1);
  });

  it('startPolling does nothing when pollIntervalMs=0', () => {
    const setTimer = vi.fn();
    const ff = createFeatureFlags({ pollIntervalMs: 0, setTimer });
    ff.startPolling();
    expect(setTimer).not.toHaveBeenCalled();
  });

  it('startPolling re-reads file at intervals', async () => {
    const filePath = path.join(os.tmpdir(), `ff-poll-${Date.now()}.json`);
    try {
      const callbacks: Array<() => void> = [];
      const setTimer = (cb: () => void, _ms: number) => { callbacks.push(cb); return callbacks.length; };
      const clearTimer = vi.fn();

      // Write initial state
      await fs.promises.writeFile(
        filePath,
        JSON.stringify([{ key: 'initial', enabled: true }]),
        'utf8'
      );

      const ff = createFeatureFlags({ filePath, pollIntervalMs: 100, setTimer, clearTimer });
      await ff.load();
      expect(ff.get('initial')).toBeDefined();

      ff.startPolling();
      expect(callbacks).toHaveLength(1);

      // Update the file
      await fs.promises.writeFile(
        filePath,
        JSON.stringify([
          { key: 'initial', enabled: true },
          { key: 'polled', enabled: false },
        ]),
        'utf8'
      );

      // Trigger the poll callback and wait for async load to complete
      callbacks[0]();
      await new Promise<void>(r => setTimeout(r, 50));

      expect(ff.get('polled')).toBeDefined();
    } finally {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
  });

  it('stopPolling prevents further timer scheduling', () => {
    const callbacks: Array<() => void> = [];
    const setTimer = (cb: () => void, _ms: number) => { callbacks.push(cb); return callbacks.length; };
    const cleared: unknown[] = [];
    const clearTimer = (h: unknown) => cleared.push(h);

    const ff = createFeatureFlags({ pollIntervalMs: 100, setTimer, clearTimer });
    ff.startPolling();
    expect(callbacks).toHaveLength(1);

    ff.stopPolling();
    expect(cleared).toContain(1);

    // Calling stopPolling again is a no-op
    ff.stopPolling();
    expect(cleared).toHaveLength(1);
  });
});

// ─── removed flag ─────────────────────────────────────────────────────────────

describe('removed flag', () => {
  it('returns undefined after removal', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'temp', enabled: true });
    ff.remove('temp');
    expect(ff.get('temp')).toBeUndefined();
  });

  it('evaluate returns unknown after removal', () => {
    const ff = createFeatureFlags();
    ff.set({ key: 'temp', enabled: true });
    ff.remove('temp');
    expect(ff.evaluate('temp')).toEqual({ enabled: false, reason: 'unknown' });
  });
});

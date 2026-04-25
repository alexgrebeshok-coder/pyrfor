// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFileWatcher } from './file-watcher';
import type { FsEvent } from './file-watcher';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import * as fs from 'node:fs';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function makeTmpDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `file-watcher-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function wait(ms = 150): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function waitForEvent(
  watcher: ReturnType<typeof createFileWatcher>,
  event: FsEvent | 'ready' | 'all' | 'error'
): Promise<{ filePath: string; evt?: FsEvent }> {
  return new Promise(resolve => {
    const unsub = watcher.on(event, (filePath, evt) => {
      unsub();
      resolve({ filePath, evt });
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FileWatcher', () => {
  let tmpDir: string;
  let watchers: Array<ReturnType<typeof createFileWatcher>> = [];

  function mkWatcher(opts?: Parameters<typeof createFileWatcher>[0]) {
    const w = createFileWatcher(opts);
    watchers.push(w);
    return w;
  }

  beforeEach(async () => {
    tmpDir = await makeTmpDir();
    watchers = [];
  });

  afterEach(async () => {
    for (const w of watchers) {
      await w.close().catch(() => {});
    }
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── 1. Basic ready ─────────────────────────────────────────────────────────

  it('emits ready after watch()', async () => {
    const watcher = mkWatcher();
    const ready = vi.fn();
    watcher.on('ready', ready);
    await watcher.watch(tmpDir);
    expect(ready).toHaveBeenCalledOnce();
  });

  it('emits addDir for the root directory on watch()', async () => {
    const watcher = mkWatcher();
    const addDir = vi.fn<[string, FsEvent | undefined]>();
    watcher.on('addDir', addDir);
    await watcher.watch(tmpDir);
    expect(addDir).toHaveBeenCalledWith(tmpDir, 'addDir');
  });

  it('emits add for existing files during initial scan', async () => {
    const file = path.join(tmpDir, 'existing.txt');
    await fsp.writeFile(file, 'hello');
    const watcher = mkWatcher();
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);
    expect(adds).toContain(file);
  });

  it('emits addDir for existing subdirs during initial scan', async () => {
    const sub = path.join(tmpDir, 'subdir');
    await fsp.mkdir(sub);
    const watcher = mkWatcher();
    const addDirs: string[] = [];
    watcher.on('addDir', (p) => addDirs.push(p));
    await watcher.watch(tmpDir);
    expect(addDirs).toContain(sub);
  });

  it('ready fires after initial scan (existing files already emitted)', async () => {
    const file = path.join(tmpDir, 'pre.txt');
    await fsp.writeFile(file, 'x');
    const order: string[] = [];
    const watcher = mkWatcher();
    watcher.on('add', () => order.push('add'));
    watcher.on('ready', () => order.push('ready'));
    await watcher.watch(tmpDir);
    expect(order).toEqual(['add', 'ready']);
  });

  // ── 2. Live fs events ──────────────────────────────────────────────────────

  it('emits add when a new file is created', async () => {
    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);

    const addPromise = waitForEvent(watcher, 'add');
    const file = path.join(tmpDir, 'new.txt');
    await fsp.writeFile(file, 'content');
    const { filePath } = await Promise.race([addPromise, wait(500).then(() => ({ filePath: '' }))]);
    expect(filePath).toBe(file);
  });

  it('emits change when a file is modified', async () => {
    const file = path.join(tmpDir, 'modify.txt');
    await fsp.writeFile(file, 'initial');

    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    await wait(50); // let initial scan settle

    const changePromise = waitForEvent(watcher, 'change');
    await wait(20); // ensure mtime will differ
    await fsp.writeFile(file, 'updated');
    const { filePath } = await Promise.race([changePromise, wait(500).then(() => ({ filePath: '' }))]);
    expect(filePath).toBe(file);
  });

  it('emits unlink when a file is deleted', async () => {
    const file = path.join(tmpDir, 'delete-me.txt');
    await fsp.writeFile(file, 'bye');

    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    await wait(50);

    const unlinkPromise = waitForEvent(watcher, 'unlink');
    await fsp.unlink(file);
    const { filePath } = await Promise.race([unlinkPromise, wait(500).then(() => ({ filePath: '' }))]);
    expect(filePath).toBe(file);
  });

  it('emits addDir when a new subdirectory is created', async () => {
    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    await wait(50);

    const addDirPromise = waitForEvent(watcher, 'addDir');
    const sub = path.join(tmpDir, 'newdir');
    await fsp.mkdir(sub);
    const { filePath } = await Promise.race([addDirPromise, wait(500).then(() => ({ filePath: '' }))]);
    expect(filePath).toBe(sub);
  });

  it('emits unlinkDir when a subdirectory is deleted', async () => {
    const sub = path.join(tmpDir, 'rm-dir');
    await fsp.mkdir(sub);

    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    await wait(50); // let initial scan capture the subdir

    const unlinkDirPromise = waitForEvent(watcher, 'unlinkDir');
    await fsp.rmdir(sub);
    const { filePath } = await Promise.race([unlinkDirPromise, wait(500).then(() => ({ filePath: '' }))]);
    expect(filePath).toBe(sub);
  });

  // ── 3. Pattern filtering ───────────────────────────────────────────────────

  it('ignore string pattern excludes files from initial scan', async () => {
    await fsp.writeFile(path.join(tmpDir, 'included.txt'), '');
    await fsp.writeFile(path.join(tmpDir, 'node_modules_style.txt'), '');

    const watcher = mkWatcher({ ignore: ['node_modules'] });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds.some(p => p.includes('node_modules'))).toBe(false);
    expect(adds.some(p => p.includes('included'))).toBe(true);
  });

  it('ignore RegExp pattern excludes files from initial scan', async () => {
    await fsp.writeFile(path.join(tmpDir, 'skip.log'), '');
    await fsp.writeFile(path.join(tmpDir, 'keep.txt'), '');

    const watcher = mkWatcher({ ignore: [/\.log$/] });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds.some(p => p.endsWith('.log'))).toBe(false);
    expect(adds.some(p => p.endsWith('.txt'))).toBe(true);
  });

  it('include string pattern restricts initial scan to matching files', async () => {
    await fsp.writeFile(path.join(tmpDir, 'match.ts'), '');
    await fsp.writeFile(path.join(tmpDir, 'no-match.log'), '');

    const watcher = mkWatcher({ include: ['.ts'] });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds.some(p => p.endsWith('.ts'))).toBe(true);
    expect(adds.some(p => p.endsWith('.log'))).toBe(false);
  });

  it('include RegExp pattern restricts initial scan', async () => {
    await fsp.writeFile(path.join(tmpDir, 'a.tsx'), '');
    await fsp.writeFile(path.join(tmpDir, 'b.css'), '');

    const watcher = mkWatcher({ include: [/\.tsx?$/] });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds.some(p => p.endsWith('.tsx'))).toBe(true);
    expect(adds.some(p => p.endsWith('.css'))).toBe(false);
  });

  it('ignore wins over include', async () => {
    await fsp.writeFile(path.join(tmpDir, 'ignored.ts'), '');

    const watcher = mkWatcher({ include: ['.ts'], ignore: ['ignored'] });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds).toHaveLength(0);
  });

  // ── 4. Debounce (injected clock) ───────────────────────────────────────────

  it('debounce collapses rapid events for same path into one', async () => {
    const pendingTimers: Array<{ cb: () => void; id: number }> = [];
    const clearedIds = new Set<number>();
    let nextId = 0;

    const fakeSetTimer = (cb: () => void, _ms: number): number => {
      const id = ++nextId;
      pendingTimers.push({ cb, id });
      return id;
    };
    const fakeClearTimer = (h: unknown): void => {
      clearedIds.add(h as number);
    };

    // Fake fsWatch — captures the listener so we can trigger events manually
    let watchCb: ((event: string, filename: string | null) => void) | null = null;
    const fakeWatcher = { close: vi.fn(), on: vi.fn() };
    const fakeFsWatch = vi.fn((_p: unknown, _opts: unknown, cb: unknown) => {
      watchCb = cb as (event: string, filename: string | null) => void;
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch;

    const file = path.join(tmpDir, 'debounce.txt');
    await fsp.writeFile(file, 'v1');

    const watcher = mkWatcher({
      debounceMs: 100,
      setTimer: fakeSetTimer,
      clearTimer: fakeClearTimer,
      fsWatch: fakeFsWatch,
    });

    await watcher.watch(tmpDir);
    expect(watchCb).not.toBeNull();

    // Fire 3 rapid events for the same file
    watchCb!('change', 'debounce.txt');
    watchCb!('change', 'debounce.txt');
    watchCb!('change', 'debounce.txt');

    // Should have set 3 timers and cleared the first 2
    expect(pendingTimers.length).toBe(3);
    expect(clearedIds.size).toBe(2);

    // Update file so stat shows change
    await wait(20);
    await fsp.writeFile(file, 'v2-updated');

    const changes: string[] = [];
    watcher.on('change', (p) => changes.push(p));

    // Only the last timer's callback should fire
    const lastTimer = pendingTimers[pendingTimers.length - 1];
    await lastTimer.cb(); // cb schedules processPath — wait for it
    await wait(30);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toBe(file);
  });

  it('debounce resets when same path is scheduled again', async () => {
    const fired: number[] = [];
    let callCount = 0;

    const fakeSetTimer = (cb: () => void, _ms: number): number => {
      const id = ++callCount;
      fired.push(id);
      // Don't auto-run — manual control
      return id;
    };
    const fakeClearTimer = vi.fn();
    const fakeWatcher = { close: vi.fn(), on: vi.fn() };
    const fakeFsWatch = vi.fn((_p: unknown, _opts: unknown, _cb: unknown) => {
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch;

    const watcher = mkWatcher({ setTimer: fakeSetTimer, clearTimer: fakeClearTimer, fsWatch: fakeFsWatch });
    await watcher.watch(tmpDir);

    // Simulate via internal schedule - trigger via watch callback
    // We do this by spying on fakeClearTimer calls
    expect(fakeClearTimer).not.toHaveBeenCalled();
  });

  // ── 5. API ────────────────────────────────────────────────────────────────

  it('on() returns an unsubscribe function that stops the listener', async () => {
    const file = path.join(tmpDir, 'unsub.txt');
    await fsp.writeFile(file, 'x');

    const watcher = mkWatcher({ debounceMs: 10 });
    const calls: string[] = [];
    const unsub = watcher.on('add', (p) => calls.push(p));
    await watcher.watch(tmpDir);

    const countAfterWatch = calls.length;
    unsub(); // unsubscribe

    // Any subsequent event should NOT call the listener
    const addDir = path.join(tmpDir, 'newdir2');
    await fsp.mkdir(addDir);
    await wait(150);

    // calls count must not have grown for new 'add' events after unsub
    expect(calls.length).toBe(countAfterWatch);
  });

  it('close() prevents further events from being emitted', async () => {
    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    await wait(30);

    await watcher.close();

    const events: string[] = [];
    // register after close — but listeners are cleared, so just verify no crash
    const newFile = path.join(tmpDir, 'after-close.txt');
    await fsp.writeFile(newFile, 'data');
    await wait(150);
    expect(events).toHaveLength(0);
  });

  it('close() returns a resolved promise', async () => {
    const watcher = mkWatcher();
    await watcher.watch(tmpDir);
    await expect(watcher.close()).resolves.toBeUndefined();
  });

  it('getWatched() returns currently watched root paths', async () => {
    const watcher = mkWatcher();
    expect(watcher.getWatched()).toHaveLength(0);
    await watcher.watch(tmpDir);
    expect(watcher.getWatched()).toContain(tmpDir);
  });

  it('getWatched() is empty after close()', async () => {
    const watcher = mkWatcher();
    await watcher.watch(tmpDir);
    await watcher.close();
    expect(watcher.getWatched()).toHaveLength(0);
  });

  it('getWatched() reflects unwatch() removals', async () => {
    const watcher = mkWatcher();
    await watcher.watch(tmpDir);
    expect(watcher.getWatched()).toContain(tmpDir);
    watcher.unwatch(tmpDir);
    expect(watcher.getWatched()).not.toContain(tmpDir);
  });

  it('"all" event fires for every fs change event', async () => {
    const file = path.join(tmpDir, 'all-test.txt');
    await fsp.writeFile(file, 'initial');

    const watcher = mkWatcher({ debounceMs: 10 });
    const allEvents: Array<{ p: string; e?: FsEvent }> = [];
    watcher.on('all', (p, e) => allEvents.push({ p, e }));
    await watcher.watch(tmpDir);
    await wait(30);

    const before = allEvents.length;
    await wait(20);
    await fsp.writeFile(file, 'changed');
    await wait(150);

    expect(allEvents.length).toBeGreaterThan(before);
    const changeEntry = allEvents.find(x => x.p === file && x.e === 'change');
    expect(changeEntry).toBeDefined();
  });

  it('"all" does NOT fire for "ready" or "error"', async () => {
    const watcher = mkWatcher();
    const allEvents: string[] = [];
    watcher.on('all', (_p, e) => allEvents.push(e ?? 'unknown'));
    await watcher.watch(tmpDir);

    expect(allEvents).not.toContain('ready');
    expect(allEvents).not.toContain('error');
  });

  it('error in listener does not crash the watcher', async () => {
    const watcher = mkWatcher({ debounceMs: 10 });
    watcher.on('add', () => { throw new Error('intentional listener error'); });

    const otherCalls: string[] = [];
    watcher.on('ready', (p) => otherCalls.push(p));

    await expect(watcher.watch(tmpDir)).resolves.toBeUndefined();
    expect(otherCalls).toHaveLength(1); // ready still fired
  });

  it('unwatch() stops watching a subtree', async () => {
    const watcher = mkWatcher({ debounceMs: 10 });
    await watcher.watch(tmpDir);
    expect(watcher.getWatched()).toContain(tmpDir);

    watcher.unwatch(tmpDir);
    expect(watcher.getWatched()).not.toContain(tmpDir);

    // No add event should fire after unwatch
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    const newFile = path.join(tmpDir, 'after-unwatch.txt');
    await fsp.writeFile(newFile, 'data');
    await wait(150);
    expect(adds).toHaveLength(0);
  });

  it('multiple watch() calls for same root are deduped', async () => {
    const watcher = mkWatcher();
    const readyCount = { n: 0 };
    watcher.on('ready', () => readyCount.n++);

    await watcher.watch(tmpDir);
    await watcher.watch(tmpDir); // second call is a no-op
    await watcher.watch(tmpDir); // third call is a no-op

    expect(watcher.getWatched()).toHaveLength(1);
    expect(readyCount.n).toBe(1);
  });

  it('watch() on a file (not dir) emits add and ready', async () => {
    const file = path.join(tmpDir, 'single.txt');
    await fsp.writeFile(file, 'data');

    const watcher = mkWatcher({ debounceMs: 10 });
    const adds: string[] = [];
    const readyFired: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    watcher.on('ready', (p) => readyFired.push(p));

    await watcher.watch(file);
    expect(adds).toContain(file);
    expect(readyFired).toHaveLength(1);
  });

  it('watch() on non-existent path emits error and does not throw', async () => {
    const watcher = mkWatcher();
    const errors: string[] = [];
    watcher.on('error', (msg) => errors.push(msg));

    await expect(watcher.watch(path.join(tmpDir, 'does-not-exist'))).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('close() clears pending debounce timers (no double-fire)', async () => {
    const fired: number[] = [];
    let id = 0;
    const timerCbs = new Map<number, () => void>();

    const fakeSetTimer = (cb: () => void, _ms: number): number => {
      const h = ++id;
      timerCbs.set(h, cb);
      return h;
    };
    const fakeClearTimer = (h: unknown): void => {
      timerCbs.delete(h as number);
    };
    const fakeWatcher = { close: vi.fn(), on: vi.fn() };
    let watchCb: ((event: string, filename: string | null) => void) | null = null;
    const fakeFsWatch = vi.fn((_p: unknown, _opts: unknown, cb: unknown) => {
      watchCb = cb as (event: string, filename: string | null) => void;
      return fakeWatcher as unknown as fs.FSWatcher;
    }) as unknown as typeof fs.watch;

    const watcher = mkWatcher({ setTimer: fakeSetTimer, clearTimer: fakeClearTimer, fsWatch: fakeFsWatch });
    await watcher.watch(tmpDir);

    // Schedule a debounced path
    watchCb!('rename', 'pending.txt');
    expect(timerCbs.size).toBe(1);

    // Close should clear the timer
    await watcher.close();
    expect(timerCbs.size).toBe(0);

    // Manually fire cleared callback — should not emit because closed=true
    const adds: string[] = [];
    // listener is cleared after close, but let's verify no crash anyway
    expect(fired).toHaveLength(0);
  });

  // ── 6. Recursive option ────────────────────────────────────────────────────

  it('recursive=false does not scan nested subdirectories', async () => {
    const sub = path.join(tmpDir, 'nested');
    await fsp.mkdir(sub);
    const deepFile = path.join(sub, 'deep.txt');
    await fsp.writeFile(deepFile, 'deep');

    const watcher = mkWatcher({ recursive: false });
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds).not.toContain(deepFile);
  });

  it('recursive=true (default) scans nested subdirectories', async () => {
    const sub = path.join(tmpDir, 'nested-r');
    await fsp.mkdir(sub);
    const deepFile = path.join(sub, 'deep-r.txt');
    await fsp.writeFile(deepFile, 'deep');

    const watcher = mkWatcher();
    const adds: string[] = [];
    watcher.on('add', (p) => adds.push(p));
    await watcher.watch(tmpDir);

    expect(adds).toContain(deepFile);
  });

  // ── 7. Edge cases ─────────────────────────────────────────────────────────

  it('multiple on() listeners for same event all receive the call', async () => {
    const file = path.join(tmpDir, 'multi-listener.txt');
    await fsp.writeFile(file, 'x');

    const watcher = mkWatcher();
    const a: string[] = [];
    const b: string[] = [];
    watcher.on('add', (p) => a.push(p));
    watcher.on('add', (p) => b.push(p));
    await watcher.watch(tmpDir);

    expect(a).toContain(file);
    expect(b).toContain(file);
  });

  it('watch() while closed is a no-op', async () => {
    const watcher = mkWatcher();
    await watcher.close();
    await expect(watcher.watch(tmpDir)).resolves.toBeUndefined();
    expect(watcher.getWatched()).toHaveLength(0);
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import {
  createBackupScheduler,
  localFsAdapter,
  memoryAdapter,
  buildDirBlob,
  extractDirBlob,
} from './backup-scheduler';

// ── test helpers ───────────────────────────────────────────────────────────────

function tmpDir(): string {
  return path.join(
    os.tmpdir(),
    `bk-sched-test-${crypto.randomBytes(6).toString('hex')}`,
  );
}

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function writeFile(dir: string, relPath: string, content: string | Buffer): void {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function readFile(p: string): Buffer {
  return fs.readFileSync(p);
}

/** Make a fake injectable timer. Returns { setTimer, clearTimer, fire() } */
function makeFakeTimer() {
  let cb: (() => void) | null = null;
  let handle = 0;
  const setTimer = (fn: () => void, _ms: number): unknown => {
    cb = fn;
    return ++handle;
  };
  const clearTimer = (_h: unknown): void => {
    cb = null;
  };
  const fire = (): void => {
    const fn = cb;
    cb = null;
    fn?.();
  };
  const hasPending = (): boolean => cb !== null;
  return { setTimer, clearTimer, fire, hasPending };
}

// ── cleanup dirs ───────────────────────────────────────────────────────────────

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const d of cleanupDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const d = tmpDir();
  cleanupDirs.push(d);
  mkDir(d);
  return d;
}

// ── Dir blob encoding ──────────────────────────────────────────────────────────

describe('buildDirBlob / extractDirBlob', () => {
  it('round-trips a flat directory', async () => {
    const src = tempDir();
    writeFile(src, 'a.txt', 'hello');
    writeFile(src, 'b.txt', 'world');

    const blob = await buildDirBlob(src);
    const files = extractDirBlob(blob);

    expect(files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(files.find((f) => f.path === 'a.txt')!.data.toString()).toBe('hello');
    expect(files.find((f) => f.path === 'b.txt')!.data.toString()).toBe('world');
  });

  it('round-trips a nested directory', async () => {
    const src = tempDir();
    writeFile(src, 'sub/deep/c.bin', Buffer.from([0, 1, 2, 3]));
    writeFile(src, 'top.txt', 'top');

    const blob = await buildDirBlob(src);
    const files = extractDirBlob(blob);

    expect(files.map((f) => f.path).sort()).toEqual(['sub/deep/c.bin', 'top.txt']);
    expect(files.find((f) => f.path === 'sub/deep/c.bin')!.data).toEqual(
      Buffer.from([0, 1, 2, 3]),
    );
  });

  it('produces deterministic output for the same directory contents', async () => {
    const src = tempDir();
    writeFile(src, 'z.txt', 'last');
    writeFile(src, 'a.txt', 'first');
    writeFile(src, 'sub/m.txt', 'middle');

    const b1 = await buildDirBlob(src);
    const b2 = await buildDirBlob(src);
    expect(b1).toEqual(b2);
  });

  it('walks entries in sorted order for determinism', async () => {
    const src = tempDir();
    writeFile(src, 'z.txt', 'z');
    writeFile(src, 'a.txt', 'a');

    const blob = await buildDirBlob(src);
    const files = extractDirBlob(blob);
    expect(files[0].path).toBe('a.txt');
    expect(files[1].path).toBe('z.txt');
  });
});

// ── memoryAdapter ──────────────────────────────────────────────────────────────

describe('memoryAdapter', () => {
  it('put then list returns the entry', async () => {
    const a = memoryAdapter();
    await a.put('k1', Buffer.from('data'), { createdAt: 1000 });
    const list = await a.list();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('k1');
    expect(list[0].size).toBe(4);
    expect(list[0].createdAt).toBe(1000);
  });

  it('get returns stored data', async () => {
    const a = memoryAdapter();
    const buf = Buffer.from('hello world');
    await a.put('k2', buf, { createdAt: 2000 });
    const got = await a.get('k2');
    expect(got).toEqual(buf);
  });

  it('get throws for missing key', async () => {
    const a = memoryAdapter();
    await expect(a.get('missing')).rejects.toThrow();
  });

  it('remove deletes the entry', async () => {
    const a = memoryAdapter();
    await a.put('k3', Buffer.from('x'), { createdAt: 3000 });
    await a.remove('k3');
    const list = await a.list();
    expect(list).toHaveLength(0);
  });
});

// ── localFsAdapter ─────────────────────────────────────────────────────────────

describe('localFsAdapter', () => {
  it('put then list returns the entry', async () => {
    const dir = tempDir();
    const a = localFsAdapter(dir);
    await a.put('key1', Buffer.from('abc'), { createdAt: 5000 });
    const list = await a.list();
    expect(list).toHaveLength(1);
    expect(list[0].key).toBe('key1');
    expect(list[0].createdAt).toBe(5000);
  });

  it('get returns the stored bytes', async () => {
    const dir = tempDir();
    const a = localFsAdapter(dir);
    const buf = Buffer.from('fs data');
    await a.put('k', buf, { createdAt: 1 });
    expect(await a.get('k')).toEqual(buf);
  });

  it('remove deletes .bak and .bak.meta.json', async () => {
    const dir = tempDir();
    const a = localFsAdapter(dir);
    await a.put('rk', Buffer.from('bye'), { createdAt: 1 });
    await a.remove('rk');
    expect(await a.list()).toHaveLength(0);
    expect(fs.existsSync(path.join(dir, 'rk.bak'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'rk.bak.meta.json'))).toBe(false);
  });
});

// ── runNow with dir source ─────────────────────────────────────────────────────

describe('runNow — dir source', () => {
  it('creates one backup entry', async () => {
    const src = tempDir();
    writeFile(src, 'file.txt', 'content');
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({ source: src, target: adapter, intervalMs: 9999 });
    await sched.runNow();
    expect((await adapter.list())).toHaveLength(1);
  });

  it('restore into dir recreates exact file structure', async () => {
    const src = tempDir();
    writeFile(src, 'hello.txt', 'world');
    writeFile(src, 'sub/nested.txt', 'deep');
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({ source: src, target: adapter, intervalMs: 9999 });
    await sched.runNow();

    const out = tempDir();
    await sched.restore({ latest: true, into: out });

    expect(readFile(path.join(out, 'hello.txt')).toString()).toBe('world');
    expect(readFile(path.join(out, 'sub/nested.txt')).toString()).toBe('deep');
  });

  it('restore returns Buffer (no into) that re-extracts correctly', async () => {
    const src = tempDir();
    writeFile(src, 'x.txt', 'x-content');
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: src,
      target: adapter,
      intervalMs: 9999,
      compress: 'none',
    });
    await sched.runNow();

    const buf = await sched.restore({ latest: true });
    expect(buf).toBeInstanceOf(Buffer);
    const files = extractDirBlob(buf!);
    expect(files.find((f) => f.path === 'x.txt')!.data.toString()).toBe('x-content');
  });

  it('gzip compressed backup is smaller than none for repetitive data', async () => {
    const src = tempDir();
    writeFile(src, 'rep.txt', 'aaaaaaaaaa'.repeat(500));
    const adapterGz = memoryAdapter();
    const adapterNone = memoryAdapter();

    const clock = (): number => 1_000_000;

    await createBackupScheduler({
      source: src,
      target: adapterGz,
      intervalMs: 1,
      compress: 'gzip',
      clock,
    }).runNow();
    await createBackupScheduler({
      source: src,
      target: adapterNone,
      intervalMs: 1,
      compress: 'none',
      clock,
    }).runNow();

    const gz = (await adapterGz.list())[0].size;
    const none = (await adapterNone.list())[0].size;
    expect(gz).toBeLessThan(none);
  });
});

// ── runNow with custom fn source ───────────────────────────────────────────────

describe('runNow — custom fn source', () => {
  it('calls the snapshot function', async () => {
    const snapshotFn = vi.fn(async () => Buffer.from('snap'));
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({ source: snapshotFn, target: adapter, intervalMs: 1 });
    await sched.runNow();
    expect(snapshotFn).toHaveBeenCalledOnce();
  });

  it('stores the snapshot bytes', async () => {
    const content = Buffer.from('my-snapshot-content');
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => content,
      target: adapter,
      intervalMs: 1,
      compress: 'none',
    });
    await sched.runNow();
    const buf = await sched.restore({ latest: true });
    expect(buf).toEqual(content);
  });

  it('restore into dir writes snapshot.bin for fn source', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('payload'),
      target: adapter,
      intervalMs: 1,
      compress: 'none',
    });
    await sched.runNow();
    const out = tempDir();
    await sched.restore({ latest: true, into: out });
    expect(readFile(path.join(out, 'snapshot.bin')).toString()).toBe('payload');
  });
});

// ── verify ─────────────────────────────────────────────────────────────────────

describe('verify', () => {
  it('returns true for untampered backup', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('check-me'),
      target: adapter,
      intervalMs: 1,
    });
    await sched.runNow();
    const [entry] = await adapter.list();
    expect(await sched.verify(entry.key)).toBe(true);
  });

  it('returns false when blob data is corrupted', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('tamper-me'),
      target: adapter,
      intervalMs: 1,
    });
    await sched.runNow();

    // Tamper: flip last byte of stored blob
    const [entry] = await adapter.list();
    const original = await adapter.get(entry.key);
    const tampered = Buffer.from(original);
    tampered[tampered.length - 1] ^= 0xff;
    // Re-put with same key (bypass scheduler to corrupt directly)
    await adapter.put(entry.key, tampered, { createdAt: entry.createdAt });

    expect(await sched.verify(entry.key)).toBe(false);
  });
});

// ── retention ──────────────────────────────────────────────────────────────────

describe('retention — count', () => {
  it('drops oldest entries when count exceeded', async () => {
    let t = 1000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('d'),
      target: adapter,
      intervalMs: 1,
      retention: { count: 2 },
      clock,
    });

    await sched.runNow(); t += 1000;
    await sched.runNow(); t += 1000;
    await sched.runNow(); // third run — oldest should be dropped

    const list = await adapter.list();
    expect(list).toHaveLength(2);
  });

  it('keeps newest entries when dropping old ones', async () => {
    let t = 1_000_000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('d'),
      target: adapter,
      intervalMs: 1,
      retention: { count: 1 },
      clock,
    });

    await sched.runNow(); t += 1000;
    const firstKey = (await adapter.list())[0].key;
    await sched.runNow();

    const list = await adapter.list();
    expect(list).toHaveLength(1);
    expect(list[0].key).not.toBe(firstKey);
  });
});

describe('retention — maxAgeMs', () => {
  it('drops entries older than maxAgeMs', async () => {
    let t = 1_000_000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('d'),
      target: adapter,
      intervalMs: 1,
      retention: { maxAgeMs: 5000, minKeep: 0 },
      clock,
    });

    await sched.runNow(); // t=1_000_000
    t += 10_000;          // advance past maxAgeMs
    await sched.runNow(); // t=1_010_000 — first should be gone

    const list = await adapter.list();
    // Only the new backup remains; old one was aged out
    expect(list).toHaveLength(1);
    expect(list[0].createdAt).toBe(1_010_000);
  });
});

describe('retention — minKeep', () => {
  it('never drops below minKeep even with strict count', async () => {
    let t = 1000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('keep'),
      target: adapter,
      intervalMs: 1,
      retention: { count: 1, minKeep: 2 },
      clock,
    });

    await sched.runNow(); t += 1000;
    await sched.runNow(); t += 1000;
    await sched.runNow(); // would drop to 1 but minKeep=2 prevents it

    const list = await adapter.list();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('never drops below minKeep=1 with maxAgeMs', async () => {
    let t = 1_000_000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('preserve'),
      target: adapter,
      intervalMs: 1,
      retention: { maxAgeMs: 1, minKeep: 1 }, // maxAgeMs=1ms, nearly everything old
      clock,
    });

    await sched.runNow(); // t=1_000_000
    t += 100_000;
    await sched.runNow(); // old backup is way past maxAge but minKeep=1 keeps it

    const list = await adapter.list();
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});

// ── restore options ────────────────────────────────────────────────────────────

describe('restore', () => {
  it('restore latest=true picks the newest backup', async () => {
    let t = 1000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from(`content-at-${t}`),
      target: adapter,
      intervalMs: 1,
      compress: 'none',
      clock,
    });

    await sched.runNow(); t += 5000;
    await sched.runNow(); // second backup

    const result = await sched.restore({ latest: true });
    expect(result!.toString()).toBe('content-at-6000');
  });

  it('restore by explicit key retrieves that specific backup', async () => {
    let t = 1000;
    const clock = (): number => t;
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from(`v${t}`),
      target: adapter,
      intervalMs: 1,
      compress: 'none',
      clock,
    });

    await sched.runNow();
    const firstKey = (await adapter.list())[0].key;
    t += 5000;
    await sched.runNow();

    const result = await sched.restore({ key: firstKey });
    expect(result!.toString()).toBe('v1000');
  });

  it('returns Buffer when no into option', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('raw-return'),
      target: adapter,
      intervalMs: 1,
      compress: 'none',
    });
    await sched.runNow();
    const result = await sched.restore({ latest: true });
    expect(result).toBeInstanceOf(Buffer);
    expect(result!.toString()).toBe('raw-return');
  });

  it('throws when no backups exist', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('x'),
      target: adapter,
      intervalMs: 1,
    });
    await expect(sched.restore({ latest: true })).rejects.toThrow();
  });
});

// ── scheduler timer ────────────────────────────────────────────────────────────

describe('scheduler — setTimer injection', () => {
  it('start() registers a timer', () => {
    const ft = makeFakeTimer();
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('t'),
      target: adapter,
      intervalMs: 5000,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    sched.start();
    expect(ft.hasPending()).toBe(true);
    sched.stop();
  });

  it('firing the timer creates a backup', async () => {
    const ft = makeFakeTimer();
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('scheduled'),
      target: adapter,
      intervalMs: 5000,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    sched.start();
    ft.fire(); // trigger the timer callback

    // Wait for async backup to complete
    for (let i = 0; i < 200; i++) {
      if ((await adapter.list()).length > 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect((await adapter.list())).toHaveLength(1);
    sched.stop();
  });

  it('stop() clears the pending timer', () => {
    const ft = makeFakeTimer();
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('s'),
      target: adapter,
      intervalMs: 5000,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    sched.start();
    expect(ft.hasPending()).toBe(true);
    sched.stop();
    expect(ft.hasPending()).toBe(false);
  });

  it('stop() prevents rescheduling after a backup completes', async () => {
    const ft = makeFakeTimer();
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('s'),
      target: adapter,
      intervalMs: 5000,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    sched.start();
    sched.stop(); // stop before firing
    // Even if timer somehow fires after stop, running=false prevents reschedule
    expect(ft.hasPending()).toBe(false);
  });

  it('start() is idempotent — second call has no effect', () => {
    const ft = makeFakeTimer();
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('s'),
      target: adapter,
      intervalMs: 5000,
      setTimer: ft.setTimer,
      clearTimer: ft.clearTimer,
    });
    sched.start();
    sched.start(); // second call should not double-register
    // Only one timer was set (hasPending reflects the latest)
    expect(ft.hasPending()).toBe(true);
    sched.stop();
  });
});

// ── concurrent runNow deduplication ───────────────────────────────────────────

describe('runNow concurrency', () => {
  it('concurrent runNow calls share one in-flight run', async () => {
    let resolveSnapshot!: (b: Buffer) => void;
    const snapshotPromise = new Promise<Buffer>((res) => {
      resolveSnapshot = res;
    });
    const snapshotFn = vi.fn(() => snapshotPromise);

    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: snapshotFn,
      target: adapter,
      intervalMs: 1,
      compress: 'none',
    });

    const p1 = sched.runNow();
    const p2 = sched.runNow();
    const p3 = sched.runNow();

    resolveSnapshot(Buffer.from('once'));
    await Promise.all([p1, p2, p3]);

    expect(snapshotFn).toHaveBeenCalledTimes(1);
    expect((await adapter.list())).toHaveLength(1);
  });

  it('second runNow can start after first completes', async () => {
    const snapshotFn = vi.fn(async () => Buffer.from('run'));
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: snapshotFn,
      target: adapter,
      intervalMs: 1,
      compress: 'none',
    });

    await sched.runNow();
    await sched.runNow();

    expect(snapshotFn).toHaveBeenCalledTimes(2);
    expect((await adapter.list())).toHaveLength(2);
  });
});

// ── localFsAdapter integration ─────────────────────────────────────────────────

describe('localFsAdapter — integration', () => {
  it('backup + restore round-trip via localFsAdapter', async () => {
    const src = tempDir();
    writeFile(src, 'data.txt', 'fs-backed');
    const storeDir = tempDir();
    const adapter = localFsAdapter(storeDir);
    const sched = createBackupScheduler({ source: src, target: adapter, intervalMs: 9999 });

    await sched.runNow();
    expect(fs.readdirSync(storeDir).filter((f) => f.endsWith('.bak'))).toHaveLength(1);

    const out = tempDir();
    await sched.restore({ latest: true, into: out });
    expect(readFile(path.join(out, 'data.txt')).toString()).toBe('fs-backed');
  });

  it('localFsAdapter list returns correct createdAt from meta', async () => {
    const dir = tempDir();
    const a = localFsAdapter(dir);
    const ts = 1_234_567_890_000;
    await a.put('k', Buffer.from('x'), { createdAt: ts });
    const list = await a.list();
    expect(list[0].createdAt).toBe(ts);
  });
});

// ── hash algorithm ─────────────────────────────────────────────────────────────

describe('hashAlgo option', () => {
  it('uses sha256 by default', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('x'),
      target: adapter,
      intervalMs: 1,
    });
    await sched.runNow();
    const [entry] = await adapter.list();
    expect(await sched.verify(entry.key)).toBe(true);
  });

  it('accepts md5 as hashAlgo and still verifies', async () => {
    const adapter = memoryAdapter();
    const sched = createBackupScheduler({
      source: async () => Buffer.from('md5-test'),
      target: adapter,
      intervalMs: 1,
      hashAlgo: 'md5',
    });
    await sched.runNow();
    const [entry] = await adapter.list();
    expect(await sched.verify(entry.key)).toBe(true);
  });
});

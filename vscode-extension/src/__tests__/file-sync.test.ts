/**
 * file-sync.test.ts — Unit tests for FileSync (Sprint 2 #1).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  FileSync,
  shouldInclude,
  computeFileHash,
  normalizeRelPath,
  type DaemonClientLike,
  type FileChange,
} from '../file-sync';

// ---------------------------------------------------------------------------
// Minimal fake daemon — implements DaemonClientLike without EventEmitter dep
// ---------------------------------------------------------------------------

class FakeDaemon implements DaemonClientLike {
  state = 'open';
  readonly sendSpy = vi.fn<[object], void>();

  private readonly _handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  send(msg: object): void {
    this.sendSpy(msg);
  }

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    const list = this._handlers.get(event) ?? [];
    list.push(listener);
    this._handlers.set(event, list);
    return this;
  }

  off(event: string, listener: (...args: unknown[]) => void): unknown {
    const list = this._handlers.get(event) ?? [];
    const idx = list.indexOf(listener);
    if (idx !== -1) list.splice(idx, 1);
    return this;
  }

  /** Trigger all listeners for this event synchronously. */
  emit(event: string, payload: unknown): void {
    for (const fn of [...(this._handlers.get(event) ?? [])]) {
      fn(payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), 'file-sync-test-'));
}

async function removeTmpDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch { /* best-effort */ }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// 1. Pure helper: shouldInclude
// ---------------------------------------------------------------------------

describe('shouldInclude', () => {
  const inc = ['.ts', '.js', '.md'];
  const exc = ['node_modules/', 'dist/'];

  it('includes a matching extension', () => {
    expect(shouldInclude('src/app.ts', inc, exc)).toBe(true);
  });

  it('includes .js and .md', () => {
    expect(shouldInclude('readme.md', inc, exc)).toBe(true);
    expect(shouldInclude('lib/util.js', inc, exc)).toBe(true);
  });

  it('excludes node_modules path', () => {
    expect(shouldInclude('node_modules/foo/bar.ts', inc, exc)).toBe(false);
  });

  it('excludes dist/ path', () => {
    expect(shouldInclude('dist/bundle.js', inc, exc)).toBe(false);
  });

  it('rejects unknown extension', () => {
    expect(shouldInclude('image.png', inc, exc)).toBe(false);
  });

  it('exclude takes precedence over include', () => {
    expect(shouldInclude('node_modules/types/index.ts', inc, exc)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Pure helper: computeFileHash
// ---------------------------------------------------------------------------

describe('computeFileHash', () => {
  it('is deterministic', () => {
    const buf = Buffer.from('hello world');
    expect(computeFileHash(buf)).toBe(computeFileHash(buf));
  });

  it('differs for different content', () => {
    expect(computeFileHash(Buffer.from('a'))).not.toBe(
      computeFileHash(Buffer.from('b')),
    );
  });

  it('returns a 64-char hex string (sha256)', () => {
    expect(computeFileHash(Buffer.from('test'))).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 3. Pure helper: normalizeRelPath
// ---------------------------------------------------------------------------

describe('normalizeRelPath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizeRelPath('a\\b\\c.ts')).toBe('a/b/c.ts');
  });

  it("strips leading './'", () => {
    expect(normalizeRelPath('./x.ts')).toBe('x.ts');
  });

  it("strips multiple leading './'", () => {
    expect(normalizeRelPath('./././foo.ts')).toBe('foo.ts');
  });

  it('leaves normal paths unchanged', () => {
    expect(normalizeRelPath('src/foo.ts')).toBe('src/foo.ts');
  });
});

// ---------------------------------------------------------------------------
// 4. start() registers daemon listener for 'file.update' (via 'message')
// ---------------------------------------------------------------------------

describe('FileSync.start()', () => {
  it('registers a daemon listener for "message" events', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const onSpy = vi.spyOn(daemon, 'on');
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });

    await sync.start();

    expect(onSpy).toHaveBeenCalledWith('message', expect.any(Function));

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 5. pushFile — happy path
// ---------------------------------------------------------------------------

describe('FileSync.pushFile()', () => {
  let workspaceRoot: string;
  let daemon: FakeDaemon;
  let sync: FileSync;

  beforeEach(async () => {
    workspaceRoot = await makeTmpDir();
    daemon = new FakeDaemon();
    sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
  });

  afterEach(async () => {
    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });

  it('reads file and calls daemon.send with file.upsert payload', async () => {
    const content = Buffer.from('const x = 1;');
    await fs.promises.writeFile(path.join(workspaceRoot, 'index.ts'), content);

    await sync.pushFile('index.ts');

    expect(daemon.sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'file.upsert',
        relPath: 'index.ts',
        sha256: computeFileHash(content),
      }),
    );
  });

  it('skips when file is too large', async () => {
    const bigSync = new FileSync({
      daemon,
      workspaceRoot,
      debounceMs: 30,
      maxFileBytes: 5,
    });

    await fs.promises.writeFile(
      path.join(workspaceRoot, 'big.ts'),
      Buffer.alloc(10, 'x'),
    );

    await bigSync.pushFile('big.ts');
    expect(daemon.sendSpy).not.toHaveBeenCalled();
    await bigSync.stop();
  });

  it('skips when path is excluded', async () => {
    await fs.promises.mkdir(path.join(workspaceRoot, 'node_modules'), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(workspaceRoot, 'node_modules', 'lib.ts'),
      'module',
    );

    await sync.pushFile('node_modules/lib.ts');
    expect(daemon.sendSpy).not.toHaveBeenCalled();
  });

  it('skips second push when content unchanged (hash match)', async () => {
    const content = Buffer.from('unchanged');
    await fs.promises.writeFile(path.join(workspaceRoot, 'same.ts'), content);

    await sync.pushFile('same.ts');
    expect(daemon.sendSpy).toHaveBeenCalledTimes(1);

    await sync.pushFile('same.ts'); // Same content → no second send
    expect(daemon.sendSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. pullFile — writes to disk and records hash
// ---------------------------------------------------------------------------

describe('FileSync.pullFile()', () => {
  it('receives content and writes to disk; verifies hash recorded', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });

    const content = Buffer.from('const x = 42;');
    const sha256 = computeFileHash(content);

    daemon.sendSpy.mockImplementation((msg: object) => {
      const m = msg as Record<string, unknown>;
      if (m.type === 'file.fetch') {
        setImmediate(() =>
          daemon.emit('message', {
            type: 'file.fetch.result',
            relPath: m.relPath,
            content: content.toString('base64'),
            sha256,
          }),
        );
      }
    });

    await sync.pullFile('test.ts');

    // File should be written
    const written = await fs.promises.readFile(
      path.join(workspaceRoot, 'test.ts'),
    );
    expect(written).toEqual(content);

    // Hash should be recorded: pushing the same content should not trigger send
    daemon.sendSpy.mockClear();
    await sync.pushFile('test.ts');
    const upsertCalls = daemon.sendSpy.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).type === 'file.upsert',
    );
    expect(upsertCalls).toHaveLength(0);

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 7. syncAll — 2 daemon files, 1 newer locally
// ---------------------------------------------------------------------------

describe('FileSync.syncAll()', () => {
  it('pushes locally-newer file and pulls daemon-only file', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });

    // Create a.ts locally (mtime will be >> 1000)
    const localContent = Buffer.from('const a = 1;');
    await fs.promises.writeFile(path.join(workspaceRoot, 'a.ts'), localContent);

    // b.ts only exists on the daemon
    const bContent = Buffer.from('const b = 2;');

    daemon.sendSpy.mockImplementation((msg: object) => {
      const m = msg as Record<string, unknown>;

      if (m.type === 'file.list') {
        setImmediate(() =>
          daemon.emit('message', {
            type: 'file.list.result',
            files: [
              { relPath: 'a.ts', sha256: 'old-hash-a', mtime: 1000 },
              { relPath: 'b.ts', sha256: computeFileHash(bContent), mtime: 2000 },
            ],
          }),
        );
      } else if (m.type === 'file.fetch') {
        setImmediate(() =>
          daemon.emit('message', {
            type: 'file.fetch.result',
            relPath: m.relPath,
            content: bContent.toString('base64'),
            sha256: computeFileHash(bContent),
          }),
        );
      }
    });

    const result = await sync.syncAll();

    expect(result.pushed).toBe(1);
    expect(result.pulled).toBe(1);

    // b.ts should have been written locally
    const written = await fs.promises.readFile(path.join(workspaceRoot, 'b.ts'));
    expect(written).toEqual(bContent);

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 8. Local change → debounce → push (via real fs.watch)
// ---------------------------------------------------------------------------

describe('local change via fs.watch', () => {
  it('debounces and pushes a written file', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });

    await sync.start();

    const filePath = path.join(workspaceRoot, 'watched.ts');
    await fs.promises.writeFile(filePath, 'const w = 1;');

    // Wait for debounce (30ms) + fs.watch latency
    await sleep(400);

    expect(daemon.sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file.upsert', relPath: 'watched.ts' }),
    );

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 9. Remote 'file.update' with same hash → no local write (loop-prevention)
// ---------------------------------------------------------------------------

describe('loop-prevention', () => {
  it('skips write when remote update hash matches known hash', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    const content = Buffer.from('const x = 1;');
    const sha256 = computeFileHash(content);

    // Push the file so its hash is recorded
    await fs.promises.writeFile(path.join(workspaceRoot, 'loop.ts'), content);
    await sync.pushFile('loop.ts');

    // Spy on writeFile to detect unwanted writes
    const writeSpy = vi.spyOn(fs.promises, 'writeFile');
    const writesBefore = writeSpy.mock.calls.length;

    // Daemon sends back the exact same hash → should be skipped
    daemon.emit('message', {
      type: 'file.update',
      relPath: 'loop.ts',
      sha256,
      content: content.toString('base64'),
      changeType: 'modified',
    });

    await sleep(50);

    expect(writeSpy.mock.calls.length).toBe(writesBefore);
    writeSpy.mockRestore();

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 10. pause / resume
// ---------------------------------------------------------------------------

describe('pause / resume', () => {
  it('queues changes while paused and drains on resume', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    sync.pause();

    const filePath = path.join(workspaceRoot, 'paused.ts');
    await fs.promises.writeFile(filePath, 'const p = 1;');

    await sleep(300); // Past debounce — should queue, not push

    expect(daemon.sendSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file.upsert' }),
    );

    sync.resume();
    await sleep(200); // Allow queue flush

    expect(daemon.sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'file.upsert', relPath: 'paused.ts' }),
    );

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 11. Daemon disconnected during push → queue; reconnect drains
// ---------------------------------------------------------------------------

describe('offline queue', () => {
  it('queues pushes when disconnected and flushes on reconnect', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    daemon.state = 'closed'; // Start disconnected
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    // Write two files while disconnected
    await fs.promises.writeFile(path.join(workspaceRoot, 'q1.ts'), 'const q1 = 1;');
    await fs.promises.writeFile(path.join(workspaceRoot, 'q2.ts'), 'const q2 = 2;');

    await sync.pushFile('q1.ts');
    await sync.pushFile('q2.ts');

    // Nothing sent yet
    expect(daemon.sendSpy).not.toHaveBeenCalled();

    // Simulate reconnect
    daemon.state = 'open';
    daemon.emit('open', undefined);

    await sleep(100);

    const upsertCalls = daemon.sendSpy.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).type === 'file.upsert',
    );
    expect(upsertCalls.length).toBeGreaterThanOrEqual(2);

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });

  it('drops oldest items when queue exceeds max (100)', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    daemon.state = 'closed';
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });

    // Directly enqueue 101 items via pushFile (files won't exist so pushFile
    // returns early, but we bypass via writing files for a couple)
    // Instead test the queue cap indirectly: 100 items queued, 101st drops first
    // We can't access _pushQueue directly so we verify no crash and daemon gets ≤100 sends
    for (let i = 0; i < 102; i++) {
      const f = `file${i}.ts`;
      await fs.promises.writeFile(path.join(workspaceRoot, f), `const x${i}=1;`);
    }
    // Push 102 files while offline — queue holds max 100
    for (let i = 0; i < 102; i++) {
      await sync.pushFile(`file${i}.ts`);
    }

    daemon.state = 'open';
    daemon.emit('open', undefined);
    await sleep(500);

    const upsertCalls = daemon.sendSpy.mock.calls.filter(
      (c) => (c[0] as Record<string, unknown>).type === 'file.upsert',
    );
    expect(upsertCalls.length).toBeLessThanOrEqual(100);

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

// ---------------------------------------------------------------------------
// 12. onLocalChange / onRemoteChange callbacks
// ---------------------------------------------------------------------------

describe('onLocalChange / onRemoteChange', () => {
  it('invokes onLocalChange callback when local file changes', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    const changes: FileChange[] = [];
    sync.onLocalChange((c) => changes.push(c));

    await fs.promises.writeFile(
      path.join(workspaceRoot, 'local-cb.ts'),
      'const cb = 1;',
    );
    await sleep(400);

    expect(changes.length).toBeGreaterThanOrEqual(1);
    expect(changes[0].relPath).toBe('local-cb.ts');

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });

  it('invokes onRemoteChange callback on daemon file.update event', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    const changes: FileChange[] = [];
    sync.onRemoteChange((c) => changes.push(c));

    const content = Buffer.from('remote content');
    daemon.emit('message', {
      type: 'file.update',
      relPath: 'remote.ts',
      sha256: computeFileHash(content),
      content: content.toString('base64'),
      changeType: 'modified',
    });

    await sleep(50);

    expect(changes.length).toBe(1);
    expect(changes[0].relPath).toBe('remote.ts');
    expect(changes[0].type).toBe('modified');

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });

  it('cleanup function from onLocalChange unsubscribes the callback', async () => {
    const workspaceRoot = await makeTmpDir();
    const daemon = new FakeDaemon();
    const sync = new FileSync({ daemon, workspaceRoot, debounceMs: 30 });
    await sync.start();

    const changes: FileChange[] = [];
    const unsubscribe = sync.onLocalChange((c) => changes.push(c));
    unsubscribe();

    await fs.promises.writeFile(
      path.join(workspaceRoot, 'unsub.ts'),
      'const u = 1;',
    );
    await sleep(400);

    expect(changes).toHaveLength(0);

    await sync.stop();
    await removeTmpDir(workspaceRoot);
  });
});

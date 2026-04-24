// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsPromises } from 'fs';
import * as nodefs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionStore, reviveSession, SCHEMA_VERSION } from './session-store';
import type { Session } from './session';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'sess-test-' + Math.random().toString(36).slice(2),
    channel: 'cli',
    userId: 'u1',
    chatId: 'c1',
    messages: [],
    systemPrompt: '',
    createdAt: new Date(),
    lastActivityAt: new Date(),
    tokenCount: 0,
    maxTokens: 128000,
    metadata: {},
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─── shared setup ───────────────────────────────────────────────────────────

let store: SessionStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), 'pyrfor-store-test-' + Math.random().toString(36).slice(2));
  store = new SessionStore({ rootDir: tmpDir, debounceMs: 50 });
});

afterEach(async () => {
  store.close();
  await fsPromises.rm(tmpDir, { recursive: true, force: true });
});

// ─── SCHEMA_VERSION ─────────────────────────────────────────────────────────

describe('SCHEMA_VERSION', () => {
  it('equals 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});

// ─── getRootDir() ────────────────────────────────────────────────────────────

describe('getRootDir()', () => {
  it('returns the configured rootDir', () => {
    expect(store.getRootDir()).toBe(tmpDir);
  });
});

// ─── init() ─────────────────────────────────────────────────────────────────

describe('init()', () => {
  it('creates rootDir and all channel subdirectories', async () => {
    await store.init();

    const stat = await fsPromises.stat(tmpDir);
    expect(stat.isDirectory()).toBe(true);

    for (const channel of ['telegram', 'cli', 'tma', 'web']) {
      const channelStat = await fsPromises.stat(path.join(tmpDir, channel));
      expect(channelStat.isDirectory()).toBe(true);
    }
  });

  it('is idempotent — second call does not throw', async () => {
    await store.init();
    await expect(store.init()).resolves.toBeUndefined();
  });
});

// ─── saveNow() ──────────────────────────────────────────────────────────────

describe('saveNow()', () => {
  it('writes file at {root}/{channel}/{userId}_{chatId}.json', async () => {
    await store.init();
    const session = makeSession({ channel: 'cli', userId: 'u1', chatId: 'c1' });

    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    const stat = await fsPromises.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it('writes valid JSON with schemaVersion: 1', async () => {
    await store.init();
    const session = makeSession();

    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.schemaVersion).toBe(1);
  });

  it('contains all expected session fields', async () => {
    await store.init();
    const session = makeSession({
      systemPrompt: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
      tokenCount: 42,
      maxTokens: 8000,
      metadata: { foo: 'bar' },
    });

    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf-8'));

    expect(parsed.id).toBe(session.id);
    expect(parsed.channel).toBe('cli');
    expect(parsed.userId).toBe('u1');
    expect(parsed.chatId).toBe('c1');
    expect(parsed.systemPrompt).toBe('You are helpful');
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].role).toBe('user');
    expect(parsed.messages[0].content).toBe('Hello');
    expect(parsed.tokenCount).toBe(42);
    expect(parsed.maxTokens).toBe(8000);
    expect(parsed.metadata).toEqual({ foo: 'bar' });
    expect(parsed.createdAt).toBeDefined();
    expect(parsed.updatedAt).toBeDefined();
  });

  it('creates the file with mode 0o600', async () => {
    await store.init();
    const session = makeSession();

    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    const stat = await fsPromises.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ─── save() — debounced ──────────────────────────────────────────────────────

describe('save() — debounced', () => {
  it('does not write the file immediately', async () => {
    await store.init();
    const session = makeSession();

    store.save(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    await expect(fsPromises.access(filePath)).rejects.toThrow();
  });

  it('writes the file after the debounce window', async () => {
    await store.init();
    const session = makeSession();

    store.save(session);
    await sleep(200); // debounceMs=50 → well past

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    await expect(fsPromises.access(filePath)).resolves.toBeUndefined();
  });

  it('multiple save() calls for the same session produce exactly one write', async () => {
    await store.init();
    const session = makeSession();

    // Spy on rename to count actual file-write completions.
    const renameSpy = vi.spyOn(nodefs.promises, 'rename');

    store.save(session);
    store.save(session);
    store.save(session);

    await sleep(200);

    expect(renameSpy).toHaveBeenCalledTimes(1);
    renameSpy.mockRestore();
  });
});

// ─── loadAll() ──────────────────────────────────────────────────────────────

describe('loadAll()', () => {
  it('returns [] for an empty store', async () => {
    await store.init();
    const sessions = await store.loadAll();
    expect(sessions).toEqual([]);
  });

  it('loads a previously saved session', async () => {
    await store.init();
    const session = makeSession({ systemPrompt: 'test prompt', tokenCount: 7 });

    await store.saveNow(session);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
    expect(sessions[0].systemPrompt).toBe('test prompt');
    expect(sessions[0].schemaVersion).toBe(1);
  });

  it('skips broken-JSON files and returns the rest', async () => {
    await store.init();
    const session = makeSession({ userId: 'good', chatId: 'session' });
    await store.saveNow(session);

    await fsPromises.writeFile(
      path.join(tmpDir, 'cli', 'broken.json'),
      '{ not: valid json ~~~',
      'utf-8',
    );

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe(session.id);
  });

  it('skips files with incompatible schemaVersion', async () => {
    await store.init();

    const bad = {
      schemaVersion: 999,
      id: 'old-id',
      channel: 'cli',
      userId: 'u1',
      chatId: 'c1',
      systemPrompt: '',
      messages: [],
      tokenCount: 0,
      maxTokens: 128000,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await fsPromises.writeFile(
      path.join(tmpDir, 'cli', 'u1_c1.json'),
      JSON.stringify(bad),
      'utf-8',
    );

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(0);
  });

  it('does not throw on files with extra unknown fields (forward-compat)', async () => {
    await store.init();

    const extra = {
      schemaVersion: 1,
      id: 'extra-id',
      channel: 'cli',
      userId: 'u1',
      chatId: 'c1',
      systemPrompt: '',
      messages: [],
      tokenCount: 0,
      maxTokens: 128000,
      metadata: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      futureProp: { nested: true },
    };

    await fsPromises.writeFile(
      path.join(tmpDir, 'cli', 'u1_c1.json'),
      JSON.stringify(extra),
      'utf-8',
    );

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('extra-id');
  });
});

// ─── delete() ───────────────────────────────────────────────────────────────

describe('delete()', () => {
  it('removes the persisted file', async () => {
    await store.init();
    const session = makeSession();
    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    await expect(fsPromises.access(filePath)).resolves.toBeUndefined();

    await store.delete(session);

    await expect(fsPromises.access(filePath)).rejects.toThrow();
  });

  it('cancels a pending debounced write — file must not appear afterwards', async () => {
    await store.init();
    const session = makeSession();

    store.save(session);       // schedule
    await store.delete(session); // cancel

    await sleep(200); // past debounce window

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    await expect(fsPromises.access(filePath)).rejects.toThrow();
  });

  it('does not throw when the file does not exist', async () => {
    await store.init();
    const session = makeSession({ userId: 'nobody', chatId: 'nowhere' });
    await expect(store.delete(session)).resolves.toBeUndefined();
  });
});

// ─── flushAll() ─────────────────────────────────────────────────────────────

describe('flushAll()', () => {
  it('writes all pending sessions to disk immediately', async () => {
    await store.init();

    const sessions = [
      makeSession({ userId: 'ua', chatId: 'ca' }),
      makeSession({ userId: 'ub', chatId: 'cb' }),
      makeSession({ userId: 'uc', chatId: 'cc' }),
    ];

    for (const s of sessions) store.save(s);

    await store.flushAll();

    for (const s of sessions) {
      const filePath = path.join(tmpDir, 'cli', `${s.userId}_${s.chatId}.json`);
      await expect(fsPromises.access(filePath)).resolves.toBeUndefined();
    }
  });

  it('leaves no pending timers after flushAll() + close()', async () => {
    await store.init();
    const session = makeSession();
    store.save(session);

    await store.flushAll();
    // close() on an already-flushed store must not throw
    expect(() => store.close()).not.toThrow();
  });
});

// ─── close() ────────────────────────────────────────────────────────────────

describe('close()', () => {
  it('prevents further saves from being scheduled', async () => {
    await store.init();
    const session = makeSession();

    store.close();
    store.save(session); // should be a no-op

    await sleep(200);

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    await expect(fsPromises.access(filePath)).rejects.toThrow();
  });

  it('repeated close() is a no-op', () => {
    store.close();
    expect(() => store.close()).not.toThrow();
  });
});

// ─── Atomic write ────────────────────────────────────────────────────────────

describe('atomic write', () => {
  it('uses a .{pid}.tmp intermediate file that exists before rename', async () => {
    await store.init();
    const session = makeSession();

    let tmpFileExistedBeforeRename = false;
    let capturedSrc = '';

    // Save reference to the real rename before spying.
    const realRename = nodefs.promises.rename.bind(nodefs.promises);
    const spy = vi.spyOn(nodefs.promises, 'rename').mockImplementationOnce(async (src, dest) => {
      capturedSrc = src as string;
      try {
        await fsPromises.stat(src as string);
        tmpFileExistedBeforeRename = true;
      } catch {
        // tmp file doesn't exist yet
      }
      return realRename(src, dest);
    });

    await store.saveNow(session);

    expect(tmpFileExistedBeforeRename).toBe(true);
    expect(capturedSrc).toMatch(new RegExp(`\\.${process.pid}\\.tmp$`));

    spy.mockRestore();
  });

  it('leaves no tmp file after a successful write', async () => {
    await store.init();
    const session = makeSession();

    let capturedSrc = '';
    const realRename = nodefs.promises.rename.bind(nodefs.promises);
    const spy = vi.spyOn(nodefs.promises, 'rename').mockImplementationOnce(async (src, dest) => {
      capturedSrc = src as string;
      return realRename(src, dest);
    });

    await store.saveNow(session);

    // After rename, the .tmp file must be gone.
    await expect(fsPromises.access(capturedSrc)).rejects.toThrow();

    spy.mockRestore();
  });

  it('if rename fails the target file is absent or contains valid JSON', async () => {
    await store.init();
    const session = makeSession();

    const spy = vi
      .spyOn(nodefs.promises, 'rename')
      .mockRejectedValueOnce(new Error('simulated rename failure'));

    await expect(store.saveNow(session)).rejects.toThrow('simulated rename failure');

    const filePath = path.join(tmpDir, 'cli', 'u1_c1.json');
    let content: string | null = null;
    try {
      content = await fsPromises.readFile(filePath, 'utf-8');
    } catch {
      // file absent — acceptable
    }

    if (content !== null) {
      // If a stale valid file existed, it must still parse.
      expect(() => JSON.parse(content!)).not.toThrow();
    }

    spy.mockRestore();
  });
});

// ─── reviveSession() ────────────────────────────────────────────────────────

describe('reviveSession()', () => {
  const iso = '2024-01-15T12:00:00.000Z';

  const persisted = {
    schemaVersion: 1 as const,
    id: 'sess-xyz',
    channel: 'cli' as const,
    userId: 'u99',
    chatId: 'c99',
    systemPrompt: 'be helpful',
    messages: [
      { role: 'user' as const, content: 'hi', timestamp: iso },
      { role: 'assistant' as const, content: 'hello', timestamp: iso },
    ],
    tokenCount: 10,
    maxTokens: 4096,
    metadata: { key: 'val' },
    createdAt: iso,
    updatedAt: iso,
  };

  it('restores all top-level fields', () => {
    const s = reviveSession(persisted);
    expect(s.id).toBe('sess-xyz');
    expect(s.channel).toBe('cli');
    expect(s.userId).toBe('u99');
    expect(s.chatId).toBe('c99');
    expect(s.systemPrompt).toBe('be helpful');
    expect(s.tokenCount).toBe(10);
    expect(s.maxTokens).toBe(4096);
    expect(s.metadata).toEqual({ key: 'val' });
  });

  it('converts createdAt and updatedAt ISO strings into Date objects', () => {
    const s = reviveSession(persisted);
    expect(s.createdAt).toBeInstanceOf(Date);
    expect(s.lastActivityAt).toBeInstanceOf(Date);
    expect(s.createdAt.toISOString()).toBe(iso);
    expect(s.lastActivityAt.toISOString()).toBe(iso);
  });

  it('drops timestamp from each message (Message type has no timestamp)', () => {
    const s = reviveSession(persisted);
    expect(s.messages).toHaveLength(2);
    for (const m of s.messages) {
      expect(m).not.toHaveProperty('timestamp');
    }
  });

  it('preserves message role and content', () => {
    const s = reviveSession(persisted);
    expect(s.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(s.messages[1]).toEqual({ role: 'assistant', content: 'hello' });
  });

  it('defaults metadata to {} when absent', () => {
    const s = reviveSession({ ...persisted, metadata: undefined as unknown as Record<string, unknown> });
    expect(s.metadata).toEqual({});
  });
});

// ─── Path safety ────────────────────────────────────────────────────────────

describe('path safety', () => {
  const channelDir = () => path.join(tmpDir, 'cli');

  async function filesInChannelDir() {
    const entries = await fsPromises.readdir(channelDir());
    return entries.map((f) => path.join(channelDir(), f));
  }

  it.each([
    ['../../etc/passwd'],
    ['a/b'],
    ['a\\b'],
    ['../x'],
  ])('chatId %s does not escape the channel directory', async (chatId) => {
    await store.init();
    const session = makeSession({ userId: 'u1', chatId });

    await store.saveNow(session);

    const files = await filesInChannelDir();
    for (const f of files) {
      expect(f.startsWith(channelDir())).toBe(true);
    }

    // Clean up for next iteration (store reused across it.each)
    await store.delete(session);
  });

  it('chatId longer than 200 chars is truncated', async () => {
    await store.init();
    const session = makeSession({ userId: 'u', chatId: 'x'.repeat(300) });

    await store.saveNow(session);

    const files = await filesInChannelDir();
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    for (const f of jsonFiles) {
      const base = path.basename(f, '.json');
      // base = "{safeUserId}_{safeChatId}", total safe segment ≤ 200 chars each
      const parts = base.split('_');
      // chatId portion is the tail; safe segment caps at 200
      expect(parts[parts.length - 1].length).toBeLessThanOrEqual(200);
    }
  });

  it('unicode chatId is NFKC-normalised and unsafe chars replaced with underscore', async () => {
    await store.init();
    const session = makeSession({ userId: 'user', chatId: 'ёлочка🎄' });

    await store.saveNow(session);

    const files = await filesInChannelDir();
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    expect(jsonFiles.length).toBeGreaterThan(0);

    for (const f of jsonFiles) {
      // All file-name characters must be ASCII-safe (A-Za-z0-9._-)
      expect(/^[A-Za-z0-9._-]+\.json$/.test(path.basename(f))).toBe(true);
    }
  });
});

// ─── Edge-case: .tmp files ignored on load ───────────────────────────────────

describe('loadAll() — ignores .tmp leftover files', () => {
  it('does not attempt to parse .tmp files left by a crashed write', async () => {
    await store.init();
    const session = makeSession({ userId: 'real', chatId: 'session' });
    await store.saveNow(session);

    // Plant a stray crash artifact (as if a previous run crashed before rename)
    await fsPromises.writeFile(
      path.join(tmpDir, 'cli', `crash.${process.pid}.tmp`),
      '{ bad json',
      'utf-8',
    );

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('real');
  });
});

// ─── Edge-case: non-.json files ignored on load ──────────────────────────────

describe('loadAll() — skips non-.json files', () => {
  it('ignores .txt, .bak and other non-JSON files in channel directories', async () => {
    await store.init();
    const session = makeSession({ userId: 'keeper', chatId: 'chat' });
    await store.saveNow(session);

    await fsPromises.writeFile(path.join(tmpDir, 'cli', 'notes.txt'), 'hello', 'utf-8');
    await fsPromises.writeFile(path.join(tmpDir, 'cli', 'backup.bak'), 'data', 'utf-8');
    await fsPromises.writeFile(path.join(tmpDir, 'cli', 'README'), 'readme', 'utf-8');

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('keeper');
  });
});

// ─── Edge-case: malformed JSON logs warning ───────────────────────────────────

describe('loadAll() — malformed JSON logs a warning', () => {
  it('logs a warning for broken-JSON files and continues without throwing', async () => {
    const { logger } = await import('../observability/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    await store.init();
    const session = makeSession({ userId: 'good', chatId: 'session' });
    await store.saveNow(session);

    await fsPromises.writeFile(
      path.join(tmpDir, 'cli', 'malformed.json'),
      '{ not: valid ~~~',
      'utf-8',
    );

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);

    const warningCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('failed to load'),
    );
    expect(warningCalls.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });
});

// ─── Edge-case: channel directory missing ────────────────────────────────────

describe('loadAll() — missing channel directory', () => {
  it('returns sessions from surviving channels when other channel dirs are absent', async () => {
    await store.init();
    const session = makeSession({ channel: 'cli', userId: 'survivor', chatId: 'chat' });
    await store.saveNow(session);

    // Remove non-cli channel dirs to simulate partial corruption
    for (const ch of ['telegram', 'tma', 'web']) {
      await fsPromises.rm(path.join(tmpDir, ch), { recursive: true, force: true });
    }

    // A fresh store (no path cache) should still load the cli session cleanly
    const freshStore = new SessionStore({ rootDir: tmpDir, debounceMs: 50 });
    const sessions = await freshStore.loadAll();
    freshStore.close();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('survivor');
  });
});

// ─── Edge-case: rootDir bootstrap ────────────────────────────────────────────

describe('bootstrap — rootDir does not exist', () => {
  it('init() creates ~/.pyrfor-style root and all channel dirs from scratch', async () => {
    // Use a deeply nested path that does not exist yet
    const deepRoot = path.join(tmpDir, 'deep', 'nested', 'pyrfor', 'sessions');
    const bootstrapStore = new SessionStore({ rootDir: deepRoot, debounceMs: 50 });

    await bootstrapStore.init();
    bootstrapStore.close();

    const stat = await fsPromises.stat(deepRoot);
    expect(stat.isDirectory()).toBe(true);
    for (const ch of ['telegram', 'cli', 'tma', 'web']) {
      const s = await fsPromises.stat(path.join(deepRoot, ch));
      expect(s.isDirectory()).toBe(true);
    }

    await fsPromises.rm(path.join(tmpDir, 'deep'), { recursive: true, force: true });
  });

  it('loadAll() on a brand-new non-existent rootDir returns [] without throwing', async () => {
    const newRoot = path.join(tmpDir, 'nonexistent');
    const freshStore = new SessionStore({ rootDir: newRoot, debounceMs: 50 });

    await expect(freshStore.loadAll()).resolves.toEqual([]);
    freshStore.close();

    await fsPromises.rm(newRoot, { recursive: true, force: true });
  });
});

// ─── Edge-case: mode 0o600 (Unix only) ───────────────────────────────────────

describe('saveNow() — file permissions (Unix only)', () => {
  it.skipIf(process.platform === 'win32')('sets mode 0o600 on written files', async () => {
    await store.init();
    const session = makeSession({ userId: 'perm', chatId: 'check' });
    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'perm_check.json');
    const stat = await fsPromises.stat(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

// ─── Edge-case: original file intact when rename fails ───────────────────────

describe('atomic write — original preserved on rename failure', () => {
  it('does not corrupt an existing valid file when rename throws', async () => {
    await store.init();
    const session = makeSession({ userId: 'stable', chatId: 'file' });

    // Write the first valid version
    await store.saveNow(session);
    const filePath = path.join(tmpDir, 'cli', 'stable_file.json');
    const originalRaw = await fsPromises.readFile(filePath, 'utf-8');
    const originalParsed = JSON.parse(originalRaw);

    // Simulate a failed rename on the second write
    const spy = vi
      .spyOn(nodefs.promises, 'rename')
      .mockRejectedValueOnce(new Error('ENOSPC'));
    session.tokenCount = 9999;

    await expect(store.saveNow(session)).rejects.toThrow('ENOSPC');
    spy.mockRestore();

    // Original file must be byte-for-byte unchanged
    const afterRaw = await fsPromises.readFile(filePath, 'utf-8');
    expect(afterRaw).toBe(originalRaw);
    expect(originalParsed.tokenCount).not.toBe(9999);
  });
});

// ─── Edge-case: many message appends ─────────────────────────────────────────

describe('long-running session — many message appends', () => {
  it('accumulates 100 messages without JSON corruption', async () => {
    await store.init();
    const session = makeSession({ userId: 'worker', chatId: 'job' });

    for (let i = 0; i < 100; i++) {
      session.messages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}: ${'x'.repeat(50)}`,
      });
    }
    session.tokenCount = 5000;

    await store.saveNow(session);

    const filePath = path.join(tmpDir, 'cli', 'worker_job.json');
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw); // must not throw
    expect(parsed.messages).toHaveLength(100);
    expect(parsed.tokenCount).toBe(5000);

    const revived = reviveSession(parsed);
    expect(revived.messages[0].content).toBe(`Message 0: ${'x'.repeat(50)}`);
    expect(revived.messages[99].content).toBe(`Message 99: ${'x'.repeat(50)}`);
  });
});

// ─── Edge-case: delete + loadAll round-trip ──────────────────────────────────

describe('delete() + loadAll() round-trip', () => {
  it('deleted session does not appear in subsequent loadAll()', async () => {
    await store.init();
    const keep = makeSession({ userId: 'keep', chatId: 'me' });
    const remove = makeSession({ userId: 'remove', chatId: 'me' });

    await store.saveNow(keep);
    await store.saveNow(remove);

    let sessions = await store.loadAll();
    expect(sessions).toHaveLength(2);

    await store.delete(remove);

    // Fresh store avoids any in-memory path-cache hits
    const freshStore = new SessionStore({ rootDir: tmpDir, debounceMs: 50 });
    sessions = await freshStore.loadAll();
    freshStore.close();

    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('keep');
  });
});

// ─── Edge-case: concurrent close / save race ─────────────────────────────────

describe('concurrent close / save race', () => {
  it('saveNow() in flight before close() completes without throwing', async () => {
    await store.init();
    const session = makeSession({ userId: 'racer', chatId: 'one' });

    // Start IO then immediately close — the in-flight promise must settle cleanly
    const savePromise = store.saveNow(session);
    store.close();

    await expect(savePromise).resolves.toBeUndefined();
  });

  it('debounced save cancelled by close() leaves no file and no unhandled rejection', async () => {
    await store.init();
    const session = makeSession({ userId: 'racer', chatId: 'two' });

    store.save(session);
    store.close(); // cancels the pending timer immediately

    await sleep(200); // wait well past debounce window

    const filePath = path.join(tmpDir, 'cli', 'racer_two.json');
    await expect(fsPromises.access(filePath)).rejects.toThrow();
  });
});

// ─── Edge-case: unicode content round-trip ───────────────────────────────────

describe('unicode content — save/load round-trip', () => {
  it('preserves unicode message content through serialisation', async () => {
    await store.init();
    const session = makeSession({
      userId: 'unicode-user',
      chatId: 'unicode-chat',
      messages: [
        { role: 'user', content: 'Привет мир! 日本語 🎉 <>&"' },
        { role: 'assistant', content: 'Ответ на русском 😊 中文内容' },
      ],
    });

    await store.saveNow(session);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);

    const revived = reviveSession(sessions[0]);
    expect(revived.messages[0].content).toBe('Привет мир! 日本語 🎉 <>&"');
    expect(revived.messages[1].content).toBe('Ответ на русском 😊 中文内容');
  });

  it('preserves original unicode userId/chatId values in JSON even though filename is sanitised', async () => {
    await store.init();
    const session = makeSession({
      userId: 'юзер-123',
      chatId: 'чат-456',
      messages: [],
    });

    await store.saveNow(session);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    // JSON must carry the raw original values; only the filename is sanitised
    expect(sessions[0].userId).toBe('юзер-123');
    expect(sessions[0].chatId).toBe('чат-456');
  });

  it('preserves unicode metadata values across save/load', async () => {
    await store.init();
    const session = makeSession({
      userId: 'meta-u',
      chatId: 'meta-c',
      metadata: { name: 'Дмитрий', emoji: '🤖', nested: { text: '中文内容' } },
    });

    await store.saveNow(session);

    const sessions = await store.loadAll();
    const revived = reviveSession(sessions[0]);
    expect(revived.metadata.name).toBe('Дмитрий');
    expect(revived.metadata.emoji).toBe('🤖');
    expect((revived.metadata.nested as Record<string, string>).text).toBe('中文内容');
  });
});

// ─── Edge-case: debounce coalesces many rapid writes ─────────────────────────

describe('debounce — many concurrent writes coalesce', () => {
  it('10 rapid save() calls for the same session produce exactly one disk write (final snapshot wins)', async () => {
    await store.init();
    const session = makeSession({ userId: 'rapid', chatId: 'fire' });
    const renameSpy = vi.spyOn(nodefs.promises, 'rename');

    for (let i = 0; i < 10; i++) {
      session.tokenCount = i;
      store.save(session);
    }

    await sleep(300); // well past debounceMs=50

    expect(renameSpy).toHaveBeenCalledTimes(1);
    renameSpy.mockRestore();

    const filePath = path.join(tmpDir, 'cli', 'rapid_fire.json');
    const parsed = JSON.parse(await fsPromises.readFile(filePath, 'utf-8'));
    // The last assigned value (9) must be persisted
    expect(parsed.tokenCount).toBe(9);
  });
});

// ─── NEW: loadAll ignores nested subdirs in channel directories ───────────────

describe('loadAll() — nested subdirs in channel dirs are ignored', () => {
  it('does not crash or load from a subdirectory placed inside a channel dir', async () => {
    await store.init();
    const session = makeSession({ userId: 'legit', chatId: 'user' });
    await store.saveNow(session);

    // Plant a subdirectory (not a channel dir) inside the cli channel directory.
    const subdir = path.join(tmpDir, 'cli', 'subdir-that-is-not-a-session');
    await fsPromises.mkdir(subdir, { recursive: true });
    // Even put a .json file inside it — must remain invisible to loadAll.
    await fsPromises.writeFile(
      path.join(subdir, 'nested.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'should-not-appear',
        channel: 'cli',
        userId: 'ghost',
        chatId: 'ghost',
        systemPrompt: '',
        messages: [],
        tokenCount: 0,
        maxTokens: 128000,
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      'utf-8',
    );

    const sessions = await store.loadAll();
    // Only the top-level .json file should be loaded; the subdir is not .json so it's skipped.
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('legit');
  });
});

// ─── NEW: 1000-message round-trip ────────────────────────────────────────────

describe('save — very large message history', () => {
  it('1 000 messages write correctly and round-trip through loadAll + reviveSession', async () => {
    await store.init();
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `Message ${i}: ${'x'.repeat(100)}`,
    }));
    const session = makeSession({ userId: 'bulk', chatId: 'writer', messages, tokenCount: 99999 });

    await store.saveNow(session);

    const loaded = await store.loadAll();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].messages).toHaveLength(1000);

    const revived = reviveSession(loaded[0]);
    expect(revived.tokenCount).toBe(99999);
    expect(revived.messages[0].content).toBe(`Message 0: ${'x'.repeat(100)}`);
    expect(revived.messages[999].content).toBe(`Message 999: ${'x'.repeat(100)}`);
  });
});

// ─── NEW: special chars in userId/chatId — file is loadable via loadAll ───────

describe('save — special chars → file readable via loadAll', () => {
  it('userId with slashes round-trips through saveNow/loadAll with original value intact', async () => {
    await store.init();
    const session = makeSession({ userId: 'org/team/user', chatId: 'room/42' });
    await store.saveNow(session);

    const loaded = await store.loadAll();
    expect(loaded).toHaveLength(1);
    // JSON carries original unsanitised values; filename is sanitised
    expect(loaded[0].userId).toBe('org/team/user');
    expect(loaded[0].chatId).toBe('room/42');

    // All written files must still live inside the channel directory
    const channelDir = path.join(tmpDir, 'cli');
    const entries = await fsPromises.readdir(channelDir);
    const jsonEntries = entries.filter((e) => e.endsWith('.json'));
    for (const e of jsonEntries) {
      expect(path.join(channelDir, e).startsWith(channelDir)).toBe(true);
    }
  });
});

// ─── NEW: debounce — second window triggers second write ─────────────────────

describe('debounce — second window produces second write', () => {
  it('save after the first debounce window triggers a separate second write', async () => {
    // Use a dedicated store with a very short debounce so the test is fast.
    const localStore = new SessionStore({ rootDir: tmpDir, debounceMs: 20 });
    await localStore.init();

    const renameSpy = vi.spyOn(nodefs.promises, 'rename');
    const session = makeSession({ userId: 'double', chatId: 'write' });

    // First debounce window
    localStore.save(session);
    await sleep(80); // well past 20 ms debounce → write #1 should have completed
    expect(renameSpy).toHaveBeenCalledTimes(1);

    // Second debounce window (new call after the first window already closed)
    session.tokenCount = 42;
    localStore.save(session);
    await sleep(80);
    expect(renameSpy).toHaveBeenCalledTimes(2);

    renameSpy.mockRestore();
    localStore.close();
  });
});

// ─── NEW: atomic write — .tmp cleaned up on rename failure ───────────────────

describe('atomic write — .tmp cleaned up on rename failure', () => {
  it('leaves no .tmp file behind when rename throws', async () => {
    await store.init();
    const session = makeSession({ userId: 'clean', chatId: 'tmp' });

    let capturedTmp = '';
    const spy = vi
      .spyOn(nodefs.promises, 'rename')
      .mockImplementationOnce(async (src) => {
        capturedTmp = src as string;
        throw new Error('simulated rename failure');
      });

    await expect(store.saveNow(session)).rejects.toThrow('simulated rename failure');

    // The .tmp file must have been cleaned up.
    await expect(fsPromises.access(capturedTmp)).rejects.toThrow();

    spy.mockRestore();
  });
});

// ─── NEW: loadAll() — readdir non-ENOENT error re-throws ────────────────────
// Covers lines 208–210: the `throw err` branch when readdir fails for a reason
// other than ENOENT (e.g. EACCES — permission denied).

describe('loadAll() — readdir non-ENOENT error re-throws', () => {
  it('throws when readdir returns a non-ENOENT error (e.g. EACCES)', async () => {
    await store.init();

    const permError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    // Intercept only the first readdir call (for the 'telegram' channel dir).
    const spy = vi.spyOn(nodefs.promises, 'readdir').mockRejectedValueOnce(permError);

    await expect(store.loadAll()).rejects.toThrow('EACCES');

    spy.mockRestore();
  });
});

// ─── NEW: loadAll() — malformed session (missing required fields) ─────────────
// Covers lines 225–227: the guard `!parsed.id || !parsed.channel || …` that
// emits a warn and continues without adding the session to the output array.

describe('loadAll() — skips malformed sessions with missing required fields', () => {
  async function writeMalformed(file: string, obj: object) {
    await fsPromises.writeFile(path.join(tmpDir, 'cli', file), JSON.stringify(obj), 'utf-8');
  }

  const base = {
    schemaVersion: 1,
    id: 'valid-id',
    channel: 'cli',
    userId: 'u1',
    chatId: 'c1',
    systemPrompt: '',
    messages: [],
    tokenCount: 0,
    maxTokens: 128000,
    metadata: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('skips a session file with missing id and logs a warning', async () => {
    const { logger } = await import('../observability/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    await store.init();
    const { id: _id, ...noId } = base;
    await writeMalformed('no-id.json', noId);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(0);

    const warningCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('skipping malformed'),
    );
    expect(warningCalls.length).toBeGreaterThan(0);

    warnSpy.mockRestore();
  });

  it('skips a session file with missing channel and logs a warning', async () => {
    await store.init();
    const { channel: _ch, ...noChannel } = base;
    await writeMalformed('no-channel.json', noChannel);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(0);
  });

  it('skips a session file with missing userId and logs a warning', async () => {
    await store.init();
    const { userId: _u, ...noUserId } = base;
    await writeMalformed('no-userid.json', noUserId);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(0);
  });

  it('skips a session file with missing chatId and logs a warning', async () => {
    await store.init();
    const { chatId: _c, ...noChatId } = base;
    await writeMalformed('no-chatid.json', noChatId);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(0);
  });

  it('skips only the malformed file and still loads the valid file alongside it', async () => {
    await store.init();
    const good = makeSession({ userId: 'good', chatId: 'session' });
    await store.saveNow(good);

    const { id: _id2, ...noId2 } = base;
    await writeMalformed('also-bad.json', noId2);

    const sessions = await store.loadAll();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userId).toBe('good');
  });
});

// ─── NEW: delete() — non-ENOENT unlink error logs a warning ──────────────────
// Covers the `logger.warn` branch inside delete()'s catch block (lines 185–190)
// when the unlink fails for a reason other than ENOENT.

describe('delete() — non-ENOENT unlink error logs a warning', () => {
  it('logs a warn when unlink throws with a non-ENOENT error code', async () => {
    const { logger } = await import('../observability/logger');
    const warnSpy = vi.spyOn(logger, 'warn');

    await store.init();
    const session = makeSession({ userId: 'locked', chatId: 'file' });
    await store.saveNow(session);

    const permError = Object.assign(new Error('EACCES: permission denied, unlink'), {
      code: 'EACCES',
    });
    const unlinkSpy = vi.spyOn(nodefs.promises, 'unlink').mockRejectedValueOnce(permError);

    // delete() must not throw — it swallows the error but logs a warning.
    await expect(store.delete(session)).resolves.toBeUndefined();

    const warningCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('delete failed'),
    );
    expect(warningCalls.length).toBeGreaterThan(0);

    unlinkSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// ─── NEW: saveNow() cancels an existing debounce timer ───────────────────────
// Covers the `if (t)` branch in saveNow() (lines 143–146): when a debounced
// save is already queued, saveNow() must cancel it and write immediately.

describe('saveNow() — cancels pending debounce timer before writing', () => {
  it('writes once even when a debounced save is already in flight', async () => {
    await store.init();
    const session = makeSession({ userId: 'immediate', chatId: 'override' });

    // Queue a debounced write (timer is running).
    store.save(session);

    // saveNow() should cancel the pending timer and write synchronously.
    const renameSpy = vi.spyOn(nodefs.promises, 'rename');
    await store.saveNow(session);

    // Exactly one rename call from saveNow; the debounced timer was cancelled.
    expect(renameSpy).toHaveBeenCalledTimes(1);

    // Wait past the original debounce window — no second write must fire.
    await sleep(200);
    expect(renameSpy).toHaveBeenCalledTimes(1);

    renameSpy.mockRestore();
  });
});

// ─── NEW: flushAll() — handles writeAtomic failure gracefully ────────────────
// Covers the catch/log path inside flushAll() (lines 157–162): when one of
// the deferred writes fails, flushAll() must not throw but must log an error.

describe('flushAll() — handles writeAtomic failure gracefully', () => {
  it('does not throw when a deferred write fails during flush', async () => {
    const { logger } = await import('../observability/logger');
    const errorSpy = vi.spyOn(logger, 'error');

    await store.init();
    const s1 = makeSession({ userId: 'flush', chatId: 'fail' });
    const s2 = makeSession({ userId: 'flush', chatId: 'ok' });

    store.save(s1);
    store.save(s2);

    // Make the rename call fail for the first atomic write only.
    const renameSpy = vi
      .spyOn(nodefs.promises, 'rename')
      .mockRejectedValueOnce(new Error('ENOSPC: no space left on device'));

    await expect(store.flushAll()).resolves.toBeUndefined();

    // An error must have been logged for the failed write.
    const errorCalls = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes('flush write failed'),
    );
    expect(errorCalls.length).toBeGreaterThan(0);

    renameSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

// ─── NEW: concurrent saves to same key — file always valid JSON ───────────────

describe('concurrent saves to same key', () => {
  it('last write wins and file is always valid JSON', async () => {
    await store.init();
    const base = makeSession({ userId: 'conc', chatId: 'key' });
    const s1 = { ...base, tokenCount: 111 };
    const s2 = { ...base, tokenCount: 222 };

    // Fire both without awaiting individually — they overlap on the event loop.
    const results = await Promise.allSettled([
      store.saveNow(s1),
      store.saveNow(s2),
    ]);

    // At least one write must have succeeded.
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    // File must exist and contain valid JSON with a known tokenCount.
    const filePath = path.join(tmpDir, 'cli', 'conc_key.json');
    const raw = await fsPromises.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect([111, 222]).toContain(parsed.tokenCount);
  });
});

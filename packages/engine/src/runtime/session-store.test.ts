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

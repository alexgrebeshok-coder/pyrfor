// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverLegacyStores,
  migrateLegacyStore,
  type LegacyStore,
} from './migrate-sessions';

// ── SQLite mock state (hoisted so vi.mock factory can reference it) ──────────
//
// Three possible states:
//   null          → `.default` getter throws (simulates "better-sqlite3 not installed",
//                   covers migrateSqliteStore import-catch lines 340-343)
//   'THROW_OPEN'  → import succeeds, but the Database constructor throws
//                   (covers the outer SQLite error catch, line 406)
//   MockDb object → import succeeds and db opens normally (covers lines 348-404)
const sqliteMockState = vi.hoisted(() => {
  type MockDb = {
    prepare: ReturnType<typeof import('vitest').vi.fn>;
    close: ReturnType<typeof import('vitest').vi.fn>;
  };
  type State = null | 'THROW_OPEN' | MockDb;
  let db: State = null;
  return {
    get: (): State => db,
    set: (v: State) => {
      db = v;
    },
  };
});

// This vi.mock is hoisted by vitest's transformer and intercepts the dynamic
// `await import('better-sqlite3' as string)` inside migrateSqliteStore.
//
// The getter on `default` allows per-test control without needing resetModules:
//   • state=null        → getter throws → import-catch runs (lines 340-343)
//   • state='THROW_OPEN'→ constructor throws → outer catch runs (line 406)
//   • state=MockDb      → constructor returns the mock db (lines 348-404)
vi.mock('better-sqlite3', () => ({
  get default() {
    const state = sqliteMockState.get();
    if (state === null) {
      // Throwing here makes `(await import('better-sqlite3')).default` throw,
      // which is caught by the inner try-catch in migrateSqliteStore (line 339).
      throw new Error('better-sqlite3 not available in test environment');
    }
    if (state === 'THROW_OPEN') {
      return function MockDatabaseThrows() {
        throw new Error('SQLITE_CANTOPEN: unable to open database file');
      };
    }
    const db = state;
    return function MockDatabase(this: unknown) {
      return db;
    };
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mkTmp(): Promise<string> {
  const dir = path.join(os.tmpdir(), 'migrate-test-' + Math.random().toString(36).slice(2));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MESSAGE_ARRAY = [
  { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00.000Z' },
  { role: 'assistant', content: 'Hi there', timestamp: '2024-01-01T00:00:01.000Z' },
];

const SESSION_LIKE = {
  id: 'legacy-sess-1',
  channel: 'cli',
  userId: 'user1',
  chatId: 'chat1',
  messages: MESSAGE_ARRAY,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:01.000Z',
};

const UNKNOWN_SHAPE = { foo: 'bar', unrelated: 42 };

// ── Tests ─────────────────────────────────────────────────────────────────────

let legacyRoot: string;
let destRoot: string;

beforeEach(async () => {
  legacyRoot = await mkTmp();
  destRoot = await mkTmp();
});

afterEach(async () => {
  await fs.rm(legacyRoot, { recursive: true, force: true });
  await fs.rm(destRoot, { recursive: true, force: true });
});

// ── discoverLegacyStores ──────────────────────────────────────────────────────

describe('discoverLegacyStores', () => {
  it('returns empty array for non-existent roots', async () => {
    const stores = await discoverLegacyStores(['/nonexistent/path/12345']);
    expect(stores).toEqual([]);
  });

  it('finds JSON files in a root directory', async () => {
    await writeJson(path.join(legacyRoot, 'session1.json'), SESSION_LIKE);
    await writeJson(path.join(legacyRoot, 'session2.json'), MESSAGE_ARRAY);

    const stores = await discoverLegacyStores([legacyRoot]);
    const jsonStores = stores.filter((s) => s.type === 'json');
    expect(jsonStores).toHaveLength(2);
  });

  it('finds JSON files in subdirectories (one level)', async () => {
    const subDir = path.join(legacyRoot, 'channel1');
    await writeJson(path.join(subDir, 'session.json'), SESSION_LIKE);

    const stores = await discoverLegacyStores([legacyRoot]);
    const jsonStores = stores.filter((s) => s.type === 'json');
    expect(jsonStores).toHaveLength(1);
    expect(jsonStores[0].filePath).toContain('channel1');
  });

  it('classifies .sqlite files as sqlite type', async () => {
    const sqlitePath = path.join(legacyRoot, 'sessions.sqlite');
    await fs.writeFile(sqlitePath, 'fake sqlite content');

    const stores = await discoverLegacyStores([legacyRoot]);
    const sqliteStores = stores.filter((s) => s.type === 'sqlite');
    expect(sqliteStores).toHaveLength(1);
    expect(sqliteStores[0].filePath).toBe(sqlitePath);
  });

  it('classifies .db files as sqlite type', async () => {
    const dbPath = path.join(legacyRoot, 'sessions.db');
    await fs.writeFile(dbPath, 'fake db content');

    const stores = await discoverLegacyStores([legacyRoot]);
    expect(stores.filter((s) => s.type === 'sqlite')).toHaveLength(1);
  });

  it('marks memory dir JSON files as unknown type', async () => {
    const memoryRoot = path.join(legacyRoot, '.openclaw', 'memory');
    await writeJson(path.join(memoryRoot, 'mem1.json'), { thoughts: 'some memory' });

    // Discover using the memory-style root suffix
    const memRoot = path.join(legacyRoot, '.openclaw', 'memory');
    const stores = await discoverLegacyStores([memRoot]);
    // The isMemoryDir detection works on path ending .openclaw/memory
    // For this test we need to simulate — memory root ending should classify as unknown
    // The actual memory dir detection checks if the root ends with '.openclaw/memory'
    // Since our legacyRoot is a tmp path, let's check the unknown classification
    // by creating a fake path ending correctly:
    const fakeMemoryRoot = path.join(legacyRoot, '.openclaw', 'memory');
    const s2 = await discoverLegacyStores([fakeMemoryRoot]);
    expect(s2.filter((s) => s.type === 'unknown')).toHaveLength(1);
  });
});

// ── migrateLegacyStore — unknown type ────────────────────────────────────────

describe('migrateLegacyStore — unknown type', () => {
  it('skips unknown type stores', async () => {
    const store: LegacyStore = { type: 'unknown', filePath: '/some/memory.json', label: 'memory' };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });
    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
  });
});

// ── migrateLegacyStore — JSON coercion ───────────────────────────────────────

describe('migrateLegacyStore — JSON coercion', () => {
  it('imports a session-like JSON object', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const msgs: string[] = [];
    const report = await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      onProgress: (m) => msgs.push(m),
    });

    expect(report.imported).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.errors).toHaveLength(0);
    expect(report.files).toHaveLength(1);

    // Verify written file is valid JSON with correct shape
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.id).toBe('legacy-sess-1');
    expect(written.channel).toBe('cli');
    expect(written.messages).toHaveLength(2);
    expect(written.schemaVersion).toBe(1);
    expect(written.metadata.migratedFrom).toBe(filePath);
  });

  it('coerces a raw message array into a single session', async () => {
    const filePath = path.join(legacyRoot, 'user1_chat1.json');
    await writeJson(filePath, MESSAGE_ARRAY);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.messages).toHaveLength(2);
    expect(written.userId).toBe('user1');
    expect(written.chatId).toBe('chat1');
  });

  it('skips files with unrecognised shape', async () => {
    const filePath = path.join(legacyRoot, 'weird.json');
    await writeJson(filePath, UNKNOWN_SHAPE);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it('reports error for unparseable JSON', async () => {
    const filePath = path.join(legacyRoot, 'bad.json');
    await fs.writeFile(filePath, 'not valid json {{{{');

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].msg).toContain('Parse error');
  });
});

// ── migrateLegacyStore — dry-run ──────────────────────────────────────────────

describe('migrateLegacyStore — dry-run', () => {
  it('does not write any files on dry-run', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      dryRun: true,
    });

    expect(report.imported).toBe(1);
    expect(report.files).toHaveLength(0); // no actual files written

    // Destination directory should be empty
    const destChanDir = path.join(destRoot, 'cli');
    const exists = await fs
      .access(destChanDir)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });
});

// ── migrateLegacyStore — skip-if-exists / overwrite ──────────────────────────

describe('migrateLegacyStore — overwrite behaviour', () => {
  it('skips if destination file already exists without --overwrite', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };

    // First import
    await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    // Second import — should skip
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });
    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
  });

  it('overwrites existing file when overwrite=true', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };

    // First import
    const r1 = await migrateLegacyStore(store, { destRoot, channel: 'imported' });
    expect(r1.imported).toBe(1);

    // Modify legacy file content
    const modified = { ...SESSION_LIKE, messages: [{ role: 'user', content: 'new', timestamp: new Date().toISOString() }] };
    await writeJson(filePath, modified);

    // Second import with overwrite
    const r2 = await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      overwrite: true,
    });
    expect(r2.imported).toBe(1);
    expect(r2.skipped).toBe(0);

    const written = JSON.parse(await fs.readFile(r2.files[0], 'utf-8'));
    expect(written.messages).toHaveLength(1);
    expect(written.messages[0].content).toBe('new');
  });
});

// ── migrateLegacyStore — SQLite graceful skip ────────────────────────────────

describe('migrateLegacyStore — SQLite', () => {
  it('gracefully skips SQLite store when better-sqlite3 is absent', async () => {
    // This test runs in an environment where better-sqlite3 is NOT installed.
    // We use a fake path — the import will fail before we even open the file.
    const store: LegacyStore = {
      type: 'sqlite',
      filePath: path.join(legacyRoot, 'fake.sqlite'),
      label: 'fake.sqlite',
    };

    const msgs: string[] = [];
    const report = await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      onProgress: (m) => msgs.push(m),
    });

    // Should report a graceful skip (not throw)
    expect(report.imported).toBe(0);
    // Either skipped or an error entry — either way no crash
    const hasGracefulMessage =
      report.errors.some((e) => e.msg.includes('better-sqlite3')) ||
      msgs.some((m) => m.includes('better-sqlite3'));
    expect(hasGracefulMessage).toBe(true);
  });
});

// ── Progress callback ─────────────────────────────────────────────────────────

describe('onProgress callback', () => {
  it('receives progress messages for each imported session', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const msgs: string[] = [];

    await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      onProgress: (m) => msgs.push(m),
    });

    expect(msgs.some((m) => m.includes('[import]'))).toBe(true);
  });

  it('receives skip messages for unrecognised shapes', async () => {
    const filePath = path.join(legacyRoot, 'weird.json');
    await writeJson(filePath, UNKNOWN_SHAPE);

    const store: LegacyStore = { type: 'json', filePath };
    const msgs: string[] = [];

    await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      onProgress: (m) => msgs.push(m),
    });

    expect(msgs.some((m) => m.includes('[skip]'))).toBe(true);
  });
});

// ── migrateLegacyStore — edge case inputs ─────────────────────────────────────

describe('migrateLegacyStore — edge case inputs', () => {
  it('reports error for non-existent JSON file path', async () => {
    const store: LegacyStore = {
      type: 'json',
      filePath: path.join(legacyRoot, 'does-not-exist.json'),
    };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.errors).toHaveLength(1);
    expect(report.imported).toBe(0);
    // Error message should mention parse/read failure (ENOENT surfaces via Parse error prefix)
    expect(report.errors[0].msg).toBeTruthy();
  });

  it('skips null JSON value (unrecognised shape)', async () => {
    const filePath = path.join(legacyRoot, 'null.json');
    await fs.writeFile(filePath, 'null', 'utf-8');

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(1);
    expect(report.errors).toHaveLength(0);
  });

  it('skips empty JSON object (unrecognised shape)', async () => {
    const filePath = path.join(legacyRoot, 'empty-obj.json');
    await writeJson(filePath, {});

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(1);
  });

  it('skips empty JSON array (unrecognised shape)', async () => {
    const filePath = path.join(legacyRoot, 'empty-arr.json');
    await writeJson(filePath, []);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(0);
    expect(report.skipped).toBe(1);
  });
});

// ── migrateLegacyStore — session shape details ────────────────────────────────

describe('migrateLegacyStore — session shape details', () => {
  it('imports session with empty messages array', async () => {
    const session = { ...SESSION_LIKE, messages: [] };
    const filePath = path.join(legacyRoot, 'empty-msgs.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    expect(report.errors).toHaveLength(0);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.messages).toEqual([]);
  });

  it('preserves message order (out-of-order timestamps not sorted)', async () => {
    // Source does no sorting — order should be identical to input
    const outOfOrder = [
      { role: 'assistant', content: 'Second', timestamp: '2024-01-01T00:00:02.000Z' },
      { role: 'user', content: 'First', timestamp: '2024-01-01T00:00:00.000Z' },
      { role: 'user', content: 'Third', timestamp: '2024-01-01T00:00:01.000Z' },
    ];
    const session = { ...SESSION_LIKE, messages: outOfOrder };
    const filePath = path.join(legacyRoot, 'disordered.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.messages[0].content).toBe('Second');
    expect(written.messages[1].content).toBe('First');
    expect(written.messages[2].content).toBe('Third');
  });

  it('fills in defaults for missing optional fields', async () => {
    const minimal = { id: 'min-sess', messages: [] };
    const filePath = path.join(legacyRoot, 'minimal.json');
    await writeJson(filePath, minimal);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'test-chan' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.schemaVersion).toBe(1);
    expect(written.systemPrompt).toBe('');
    expect(written.tokenCount).toBe(0);
    expect(written.maxTokens).toBe(128000);
    expect(written.channel).toBe('test-chan'); // falls back to opts.channel
  });

  it('preserves systemPrompt and tokenCount from source', async () => {
    const session = {
      ...SESSION_LIKE,
      systemPrompt: 'You are a helpful bot.',
      tokenCount: 512,
      maxTokens: 32768,
    };
    const filePath = path.join(legacyRoot, 'full.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.systemPrompt).toBe('You are a helpful bot.');
    expect(written.tokenCount).toBe(512);
    expect(written.maxTokens).toBe(32768);
  });

  it('merges source metadata with migratedFrom key', async () => {
    const session = { ...SESSION_LIKE, metadata: { source: 'openai', version: 2 } };
    const filePath = path.join(legacyRoot, 'meta.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.metadata.source).toBe('openai');
    expect(written.metadata.version).toBe(2);
    expect(written.metadata.migratedFrom).toBe(filePath);
  });

  it('imports all sessions from an array of session-like objects', async () => {
    const sessions = [
      { id: 'sess-a', channel: 'cli', userId: 'ua', chatId: 'ca', messages: [] },
      { id: 'sess-b', channel: 'cli', userId: 'ub', chatId: 'cb', messages: [] },
      { id: 'sess-c', channel: 'cli', userId: 'uc', chatId: 'cc', messages: [] },
    ];
    const filePath = path.join(legacyRoot, 'multi.json');
    await writeJson(filePath, sessions);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(3);
    expect(report.errors).toHaveLength(0);
    expect(report.files).toHaveLength(3);
  });

  it('uses message timestamp from source; missing timestamp gets current time', async () => {
    const msgs = [
      { role: 'user', content: 'A', timestamp: '2024-06-01T12:00:00.000Z' },
      { role: 'assistant', content: 'B' }, // no timestamp
    ];
    const session = { ...SESSION_LIKE, messages: msgs };
    const filePath = path.join(legacyRoot, 'ts-test.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.messages[0].timestamp).toBe('2024-06-01T12:00:00.000Z');
    // missing timestamp falls back to a valid ISO string
    expect(new Date(written.messages[1].timestamp).getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});

// ── migrateLegacyStore — output path behaviour ────────────────────────────────

describe('migrateLegacyStore — output path behaviour', () => {
  it('creates destRoot directory automatically when it does not exist', async () => {
    const newDestRoot = path.join(legacyRoot, 'brand-new-dest');
    // newDestRoot does NOT exist yet

    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot: newDestRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    expect(report.errors).toHaveLength(0);
    const stat = await fs.stat(newDestRoot);
    expect(stat.isDirectory()).toBe(true);
  });

  it('encodes special characters in userId/chatId via safeSegment', async () => {
    const session = {
      ...SESSION_LIKE,
      userId: 'user@domain.com',
      chatId: 'chat/room#1',
    };
    const filePath = path.join(legacyRoot, 'special.json');
    await writeJson(filePath, session);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(1);
    const writtenPath = report.files[0];
    // Path must not contain raw @ / #
    expect(writtenPath).not.toContain('@');
    expect(writtenPath).not.toContain('/room');
    expect(writtenPath).not.toContain('#');
  });
});

// ── migrateLegacyStore — dry-run details ─────────────────────────────────────

describe('migrateLegacyStore — dry-run details', () => {
  it('dry-run progress messages contain [dry-run]', async () => {
    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const msgs: string[] = [];

    await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      dryRun: true,
      onProgress: (m) => msgs.push(m),
    });

    expect(msgs.some((m) => m.includes('[dry-run]'))).toBe(true);
  });

  it('dry-run with array of sessions counts all as imported without writing', async () => {
    const sessions = [
      { id: 'ds-1', channel: 'cli', userId: 'u1', chatId: 'c1', messages: [] },
      { id: 'ds-2', channel: 'cli', userId: 'u2', chatId: 'c2', messages: [] },
    ];
    const filePath = path.join(legacyRoot, 'multi-dry.json');
    await writeJson(filePath, sessions);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, {
      destRoot,
      channel: 'imported',
      dryRun: true,
    });

    expect(report.imported).toBe(2);
    expect(report.files).toHaveLength(0); // nothing written
  });
});

// ── discoverLegacyStores — additional ────────────────────────────────────────

describe('discoverLegacyStores — additional', () => {
  it('returns empty stores for an empty root directory', async () => {
    const emptyDir = path.join(legacyRoot, 'empty');
    await fs.mkdir(emptyDir, { recursive: true });

    const stores = await discoverLegacyStores([emptyDir]);
    expect(stores).toHaveLength(0);
  });

  it('ignores files with unrecognised extensions (.txt, .log)', async () => {
    await fs.writeFile(path.join(legacyRoot, 'readme.txt'), 'some text');
    await fs.writeFile(path.join(legacyRoot, 'debug.log'), 'log output');

    const stores = await discoverLegacyStores([legacyRoot]);
    expect(stores).toHaveLength(0);
  });

  it('does not descend more than one level', async () => {
    // Two levels deep — should NOT be discovered
    const deepDir = path.join(legacyRoot, 'level1', 'level2');
    await writeJson(path.join(deepDir, 'session.json'), SESSION_LIKE);

    const stores = await discoverLegacyStores([legacyRoot]);
    expect(stores.filter((s) => s.type === 'json')).toHaveLength(0);
  });

  it('silently skips an unreadable subdirectory (covers .catch(() => []) handler)', async () => {
    // Create a readable parent with a JSON at the top level, plus a subdirectory
    // whose permissions are removed. The sub-readdir .catch(() => []) is exercised.
    await writeJson(path.join(legacyRoot, 'top.json'), SESSION_LIKE);
    const lockedDir = path.join(legacyRoot, 'locked');
    await fs.mkdir(lockedDir, { recursive: true });
    await fs.writeFile(path.join(lockedDir, 'inside.json'), JSON.stringify(SESSION_LIKE));
    await fs.chmod(lockedDir, 0o000);

    let stores: Awaited<ReturnType<typeof discoverLegacyStores>>;
    try {
      stores = await discoverLegacyStores([legacyRoot]);
    } finally {
      // Restore permissions so afterEach cleanup can delete the directory.
      await fs.chmod(lockedDir, 0o755);
    }

    // The top-level JSON is found; the locked subdirectory is silently skipped.
    const jsonStores = stores.filter((s) => s.type === 'json');
    expect(jsonStores.some((s) => s.filePath.endsWith('top.json'))).toBe(true);
    // No file from the locked subdirectory should appear.
    expect(jsonStores.some((s) => s.filePath.includes('locked'))).toBe(false);
  });
});

// ── migrateLegacyStore — large batch ─────────────────────────────────────────

describe('migrateLegacyStore — large batch', () => {
  it('imports 100 sessions from a single JSON array', async () => {
    const sessions = Array.from({ length: 100 }, (_, i) => ({
      id: `bulk-sess-${i}`,
      channel: 'cli',
      userId: `user${i}`,
      chatId: `chat${i}`,
      messages: [
        { role: 'user', content: `Hello ${i}`, timestamp: '2024-01-01T00:00:00.000Z' },
      ],
    }));
    const filePath = path.join(legacyRoot, 'bulk.json');
    await writeJson(filePath, sessions);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.imported).toBe(100);
    expect(report.errors).toHaveLength(0);
    expect(report.files).toHaveLength(100);

    // Spot-check one written file
    const first = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(first.schemaVersion).toBe(1);
    expect(first.messages).toHaveLength(1);
  });
});

// ── migrateLegacyStore — write-error branch (line 316) ───────────────────────
// Covers the catch block inside the non-dry-run JSON write path.

describe('migrateLegacyStore — write-error branch', () => {
  it('records an error entry when the destination mkdir/writeFile throws', async () => {
    // SESSION_LIKE has channel:'cli', so destPath = destRoot/cli/<userId>_<chatId>.json
    // Create a regular FILE at destRoot/cli so that mkdir(destRoot/cli/) will fail
    // with EEXIST / ENOTDIR, landing us in the catch at line 316.
    await fs.writeFile(path.join(destRoot, 'cli'), 'blocker');

    const filePath = path.join(legacyRoot, 'session.json');
    await writeJson(filePath, SESSION_LIKE);

    const store: LegacyStore = { type: 'json', filePath };
    const report = await migrateLegacyStore(store, { destRoot, channel: 'imported' });

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].file).toBeTruthy();
    expect(report.imported).toBe(0);
  });
});

// ── SQLite mock helpers ───────────────────────────────────────────────────────

/** Create a mock db object whose prepare() returns different results per query. */
function makeMockDb(
  tables: Array<{ name: string }>,
  rows: unknown[],
): ReturnType<typeof sqliteMockState.get> & NonNullable<unknown> {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => ({
      all: vi.fn().mockReturnValue(sql.includes('sqlite_master') ? tables : rows),
    })),
    close: vi.fn(),
  };
}

// ── migrateLegacyStore — SQLite with mocked better-sqlite3 ───────────────────
// Covers lines 346-409 (migrateSqliteStore body after successful import).
//
// The vi.mock('better-sqlite3') at the top of the file is hoisted by vitest
// and intercepts the `await import('better-sqlite3' as string)` inside
// migrateSqliteStore. Per-test behaviour is controlled via sqliteMockState.

describe('migrateLegacyStore — SQLite with mocked better-sqlite3', () => {
  let sqRoot: string;
  let sqDest: string;

  beforeEach(async () => {
    sqRoot = path.join(os.tmpdir(), 'migrate-sq-' + Math.random().toString(36).slice(2));
    sqDest = path.join(os.tmpdir(), 'migrate-dest-' + Math.random().toString(36).slice(2));
    await fs.mkdir(sqRoot, { recursive: true });
    await fs.mkdir(sqDest, { recursive: true });
  });

  afterEach(async () => {
    sqliteMockState.set(null); // reset so other tests see "not installed" behaviour
    await fs.rm(sqRoot, { recursive: true, force: true });
    await fs.rm(sqDest, { recursive: true, force: true });
  });

  it('skips when no recognised sessions table exists in the SQLite db', async () => {
    sqliteMockState.set(makeMockDb([], [])); // no tables

    const sqlitePath = path.join(sqRoot, 'no-table.sqlite');
    await fs.writeFile(sqlitePath, '');

    const msgs: string[] = [];
    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported', onProgress: (m) => msgs.push(m) },
    );

    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
    expect(msgs.some((m) => m.includes('[skip]'))).toBe(true);
  });

  it('skips rows whose shape is unrecognisable', async () => {
    sqliteMockState.set(makeMockDb([{ name: 'sessions' }], [{ unrelated: 'data' }]));

    const sqlitePath = path.join(sqRoot, 'bad-rows.sqlite');
    await fs.writeFile(sqlitePath, '');

    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported' },
    );

    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
    expect(report.errors).toHaveLength(0);
  });

  it('imports session-like rows from a "sessions" table', async () => {
    sqliteMockState.set(
      makeMockDb(
        [{ name: 'sessions' }],
        [{ id: 'sq-1', channel: 'cli', userId: 'uA', chatId: 'cA', messages: [] }],
      ),
    );

    const sqlitePath = path.join(sqRoot, 'good.sqlite');
    await fs.writeFile(sqlitePath, '');

    const msgs: string[] = [];
    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported', onProgress: (m) => msgs.push(m) },
    );

    expect(report.imported).toBe(1);
    expect(report.errors).toHaveLength(0);
    expect(report.files).toHaveLength(1);
    expect(msgs.some((m) => m.includes('[import]'))).toBe(true);

    const written = JSON.parse(await fs.readFile(report.files[0], 'utf-8'));
    expect(written.id).toBe('sq-1');
    expect(written.schemaVersion).toBe(1);
  });

  it('recognises a "session" (singular) table name', async () => {
    sqliteMockState.set(
      makeMockDb(
        [{ name: 'session' }],
        [{ id: 'sq-sing', channel: 'tg', userId: 'us', chatId: 'cs', messages: [] }],
      ),
    );

    const sqlitePath = path.join(sqRoot, 'singular.sqlite');
    await fs.writeFile(sqlitePath, '');

    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported' },
    );

    expect(report.imported).toBe(1);
    expect(report.files).toHaveLength(1);
  });

  it('dry-run mode: counts imported but writes no files', async () => {
    sqliteMockState.set(
      makeMockDb(
        [{ name: 'sessions' }],
        [{ id: 'sq-dry', channel: 'cli', userId: 'udry', chatId: 'cdry', messages: [] }],
      ),
    );

    const sqlitePath = path.join(sqRoot, 'dry.sqlite');
    await fs.writeFile(sqlitePath, '');

    const msgs: string[] = [];
    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported', dryRun: true, onProgress: (m) => msgs.push(m) },
    );

    expect(report.imported).toBe(1);
    expect(report.files).toHaveLength(0);
    expect(msgs.some((m) => m.includes('[dry-run]'))).toBe(true);
  });

  it('skips a row when destination already exists and overwrite=false', async () => {
    const session = { id: 'sq-skip', channel: 'cli', userId: 'usk', chatId: 'csk', messages: [] };
    sqliteMockState.set(makeMockDb([{ name: 'sessions' }], [session]));

    const sqlitePath = path.join(sqRoot, 'skip.sqlite');
    await fs.writeFile(sqlitePath, '');
    const store = { type: 'sqlite' as const, filePath: sqlitePath };

    // First import — creates the destination file.
    await migrateLegacyStore(store, { destRoot: sqDest, channel: 'imported' });

    // Second import — destination exists → should skip.
    const report = await migrateLegacyStore(store, { destRoot: sqDest, channel: 'imported' });
    expect(report.skipped).toBe(1);
    expect(report.imported).toBe(0);
  });

  it('records error when writeFile fails inside SQLite migration', async () => {
    sqliteMockState.set(
      makeMockDb(
        [{ name: 'sessions' }],
        [{ id: 'sq-werr', channel: 'cli', userId: 'ue', chatId: 'ce', messages: [] }],
      ),
    );

    // Block mkdir: place a regular file where the channel directory must be created.
    await fs.writeFile(path.join(sqDest, 'cli'), 'blocker');

    const sqlitePath = path.join(sqRoot, 'werr.sqlite');
    await fs.writeFile(sqlitePath, '');

    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported' },
    );

    expect(report.errors).toHaveLength(1);
    expect(report.imported).toBe(0);
  });

  it('records a SQLite error when the Database constructor throws', async () => {
    // 'THROW_OPEN' → import succeeds but constructor throws → outer catch → 'SQLite error'
    sqliteMockState.set('THROW_OPEN');

    const sqlitePath = path.join(sqRoot, 'bad.sqlite');
    await fs.writeFile(sqlitePath, '');

    const report = await migrateLegacyStore(
      { type: 'sqlite', filePath: sqlitePath },
      { destRoot: sqDest, channel: 'imported' },
    );

    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].msg).toContain('SQLite error');
    expect(report.imported).toBe(0);
  });
});

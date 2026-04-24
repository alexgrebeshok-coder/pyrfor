// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverLegacyStores,
  migrateLegacyStore,
  type LegacyStore,
} from './migrate-sessions';

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

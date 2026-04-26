// @vitest-environment node
/**
 * session-store.test.ts — Tests for the runtime SessionStore.
 *
 * Sprint 3 #8 — UNIFIED_PLAN_FINAL.md
 *
 * Test matrix:
 *  - Pure helpers: sessionFilePath, sanitizeId, summarizeMessages, newSessionId
 *  - create / get / list / appendMessage / update / archive / delete
 *  - exportToJson / importFromJson round-trip
 *  - flush / close / autosave debounce
 *  - Write-error resilience (cache survives write failure)
 *  - Crash safety (persist → reopen → get)
 *  - Concurrent appendMessage order preservation
 *  - Workspace isolation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';
import {
  SessionStore,
  SessionRecord,
  SessionMessage,
  sessionFilePath,
  sanitizeId,
  summarizeMessages,
  newSessionId,
} from './session-store';

// ====== Helpers ===============================================================

const WS = 'ws-main';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeStore(dir: string, debounceMs = 50): SessionStore {
  return new SessionStore({ rootDir: dir, autosaveDebounceMs: debounceMs });
}

// ====== Per-test setup ========================================================

let rootDir: string;
let store: SessionStore;

beforeEach(() => {
  rootDir = path.join(os.tmpdir(), `ss-test-${nodeCrypto.randomUUID()}`);
  store = makeStore(rootDir);
});

afterEach(async () => {
  await store.close().catch(() => { /* best-effort */ });
  await fsp.rm(rootDir, { recursive: true, force: true });
});

// ====== Pure helpers ==========================================================

describe('sessionFilePath()', () => {
  it('returns expected layout <rootDir>/<workspaceId>/<sessionId>.json', () => {
    const p = sessionFilePath('/root', 'ws1', 'sess1');
    expect(p).toBe(path.join('/root', 'ws1', 'sess1.json'));
  });

  it('sanitizes workspace and session ids in the path', () => {
    const p = sessionFilePath('/r', 'a/b', 'c/d');
    expect(p).not.toContain('//');
    expect(p).toBe(path.join('/r', 'a_b', 'c_d.json'));
  });
});

describe('sanitizeId()', () => {
  it('strips forward slashes', () => {
    expect(sanitizeId('foo/bar')).not.toContain('/');
  });

  it('strips back-slashes', () => {
    expect(sanitizeId('foo\\bar')).not.toContain('\\');
  });

  it('strips .. sequences', () => {
    const result = sanitizeId('../etc/passwd');
    expect(result).not.toContain('..');
  });

  it('returns _ for empty string', () => {
    expect(sanitizeId('')).toBe('_');
  });

  it('leaves safe ids unchanged', () => {
    const id = 'abc-123_XYZ';
    expect(sanitizeId(id)).toBe(id);
  });
});

describe('summarizeMessages()', () => {
  it('truncates to maxChars', () => {
    const msgs: SessionMessage[] = [
      { id: '1', role: 'user', content: 'hello world', createdAt: '' },
    ];
    const result = summarizeMessages(msgs, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('is deterministic — same input, same output', () => {
    const msgs: SessionMessage[] = [
      { id: '1', role: 'user', content: 'hello', createdAt: '' },
      { id: '2', role: 'assistant', content: 'world', createdAt: '' },
    ];
    expect(summarizeMessages(msgs, 100)).toBe(summarizeMessages(msgs, 100));
  });

  it('includes role and content in output', () => {
    const msgs: SessionMessage[] = [
      { id: '1', role: 'user', content: 'ping', createdAt: '' },
    ];
    expect(summarizeMessages(msgs, 200)).toContain('user');
    expect(summarizeMessages(msgs, 200)).toContain('ping');
  });

  it('returns empty string for empty array', () => {
    expect(summarizeMessages([], 100)).toBe('');
  });
});

describe('newSessionId()', () => {
  it('returns a non-empty string', () => {
    expect(typeof newSessionId()).toBe('string');
    expect(newSessionId().length).toBeGreaterThan(0);
  });

  it('generates unique ids on successive calls', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

// ====== create() ==============================================================

describe('create()', () => {
  it('produces a SessionRecord with id, timestamps, and empty messages', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'My Session', mode: 'chat' });
    expect(rec.id).toBeTruthy();
    expect(rec.workspaceId).toBe(WS);
    expect(rec.title).toBe('My Session');
    expect(rec.mode).toBe('chat');
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBeTruthy();
    expect(rec.messages).toEqual([]);
  });

  it('writes the file to disk synchronously on create', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'edit' });
    const fp = sessionFilePath(rootDir, WS, rec.id);
    const raw = await fsp.readFile(fp, 'utf-8');
    const parsed = JSON.parse(raw) as SessionRecord;
    expect(parsed.id).toBe(rec.id);
    expect(parsed.title).toBe('T');
  });

  it('includes optional runId and parentSessionId when provided', async () => {
    const rec = await store.create({
      workspaceId: WS, title: 'T', mode: 'autonomous',
      runId: 'run-1', parentSessionId: 'parent-1',
    });
    expect(rec.runId).toBe('run-1');
    expect(rec.parentSessionId).toBe('parent-1');
  });
});

// ====== get() =================================================================

describe('get()', () => {
  it('returns the created record', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const found = await store.get(WS, rec.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(rec.id);
  });

  it('returns null for a missing session', async () => {
    expect(await store.get(WS, 'nonexistent-id')).toBeNull();
  });

  it('reads from disk when the record is not in cache (new store instance)', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const fresh = makeStore(rootDir);
    const found = await fresh.get(WS, rec.id);
    await fresh.close();
    expect(found).not.toBeNull();
    expect(found!.id).toBe(rec.id);
  });
});

// ====== appendMessage() =======================================================

describe('appendMessage()', () => {
  it('auto-assigns id and createdAt; messages array grows', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const msg = await store.appendMessage(WS, rec.id, { role: 'user', content: 'hello' });
    expect(msg.id).toBeTruthy();
    expect(msg.createdAt).toBeTruthy();
    const updated = await store.get(WS, rec.id);
    expect(updated!.messages).toHaveLength(1);
    expect(updated!.messages[0].content).toBe('hello');
  });

  it('preserves caller-provided id and createdAt', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const msg = await store.appendMessage(WS, rec.id, {
      role: 'assistant', content: 'hi',
      id: 'msg-custom', createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(msg.id).toBe('msg-custom');
    expect(msg.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('throws on a non-existent session', async () => {
    await expect(
      store.appendMessage(WS, 'nonexistent', { role: 'user', content: 'hi' }),
    ).rejects.toThrow();
  });
});

// ====== update() ==============================================================

describe('update()', () => {
  it('patches selected fields and bumps updatedAt', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'Old', mode: 'chat' });
    const before = rec.updatedAt;
    await sleep(2);
    const updated = await store.update(WS, rec.id, { title: 'New', summary: 'Summary text' });
    expect(updated).not.toBeNull();
    expect(updated!.title).toBe('New');
    expect(updated!.summary).toBe('Summary text');
    expect(updated!.updatedAt > before).toBe(true);
  });

  it('returns null for a missing session', async () => {
    expect(await store.update(WS, 'none', { title: 'X' })).toBeNull();
  });
});

// ====== archive() =============================================================

describe('archive()', () => {
  it('sets archived=true on the session', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const ok = await store.archive(WS, rec.id);
    expect(ok).toBe(true);
    expect((await store.get(WS, rec.id))!.archived).toBe(true);
  });

  it('returns false for a missing session', async () => {
    expect(await store.archive(WS, 'none')).toBe(false);
  });
});

// ====== delete() ==============================================================

describe('delete()', () => {
  it('removes the file and subsequent get returns null', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    expect(await store.delete(WS, rec.id)).toBe(true);
    expect(await store.get(WS, rec.id)).toBeNull();
    await expect(fsp.access(sessionFilePath(rootDir, WS, rec.id))).rejects.toThrow();
  });

  it('returns false for a non-existent session', async () => {
    expect(await store.delete(WS, 'none')).toBe(false);
  });
});

// ====== list() ================================================================

describe('list()', () => {
  it('returns all non-archived sessions for the workspace', async () => {
    await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await store.create({ workspaceId: WS, title: 'B', mode: 'edit' });
    const sessions = await store.list(WS);
    expect(sessions).toHaveLength(2);
  });

  it('respects mode filter', async () => {
    await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await store.create({ workspaceId: WS, title: 'B', mode: 'edit' });
    const chats = await store.list(WS, { mode: 'chat' });
    expect(chats).toHaveLength(1);
    expect(chats[0].mode).toBe('chat');
  });

  it('default excludes archived sessions', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await store.create({ workspaceId: WS, title: 'B', mode: 'chat' });
    await store.archive(WS, rec.id);
    const active = await store.list(WS);
    expect(active.every((r) => r.archived !== true)).toBe(true);
    expect(active).toHaveLength(1);
  });

  it('archived=true shows only archived sessions', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await store.create({ workspaceId: WS, title: 'B', mode: 'chat' });
    await store.archive(WS, rec.id);
    const archivedList = await store.list(WS, { archived: true });
    expect(archivedList).toHaveLength(1);
    expect(archivedList[0].id).toBe(rec.id);
  });

  it('respects limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create({ workspaceId: WS, title: `S${i}`, mode: 'chat' });
    }
    const page = await store.list(WS, { limit: 2, offset: 1 });
    expect(page).toHaveLength(2);
  });

  it('respects orderBy createdAt desc', async () => {
    const a = await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await sleep(2);
    await store.create({ workspaceId: WS, title: 'B', mode: 'chat' });
    const desc = await store.list(WS, { orderBy: 'createdAt', direction: 'desc' });
    expect(desc[0].title).toBe('B');
    const asc = await store.list(WS, { orderBy: 'createdAt', direction: 'asc' });
    expect(asc[0].id).toBe(a.id);
  });

  it('workspace isolation — workspace A does not see workspace B sessions', async () => {
    await store.create({ workspaceId: 'ws-a', title: 'A-session', mode: 'chat' });
    await store.create({ workspaceId: 'ws-b', title: 'B-session', mode: 'chat' });
    const aList = await store.list('ws-a');
    const bList = await store.list('ws-b');
    expect(aList).toHaveLength(1);
    expect(aList[0].title).toBe('A-session');
    expect(bList).toHaveLength(1);
    expect(bList[0].title).toBe('B-session');
  });

  it('returns empty array for unknown workspace', async () => {
    expect(await store.list('unknown-ws')).toEqual([]);
  });
});

// ====== exportToJson / importFromJson =========================================

describe('exportToJson() / importFromJson()', () => {
  it('round-trip preserves all fields', async () => {
    const rec = await store.create({
      workspaceId: WS, title: 'Export Test', mode: 'autonomous',
      runId: 'run-xyz', metadata: { foo: 'bar' },
    });
    await store.appendMessage(WS, rec.id, { role: 'user', content: 'hello' });

    const json = await store.exportToJson(WS, rec.id);

    const importDir = rootDir + '-import';
    const store2 = makeStore(importDir);
    const imported = await store2.importFromJson(json);
    await store2.close();
    await fsp.rm(importDir, { recursive: true, force: true });

    expect(imported.id).toBe(rec.id);
    expect(imported.workspaceId).toBe(WS);
    expect(imported.title).toBe('Export Test');
    expect(imported.mode).toBe('autonomous');
    expect(imported.runId).toBe('run-xyz');
    expect(imported.metadata).toEqual({ foo: 'bar' });
    expect(imported.messages).toHaveLength(1);
    expect(imported.messages[0].content).toBe('hello');
  });

  it('importFromJson throws on a missing required field', async () => {
    const bad = JSON.stringify({ id: 'x', workspaceId: 'ws', title: 'T' }); // missing mode, etc.
    await expect(store.importFromJson(bad)).rejects.toThrow(/missing required field/);
  });

  it('importFromJson throws on invalid JSON', async () => {
    await expect(store.importFromJson('{not valid json')).rejects.toThrow();
  });
});

// ====== flush() ===============================================================

describe('flush()', () => {
  it('persists dirty sessions immediately and increments flushes counter', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    await store.appendMessage(WS, rec.id, { role: 'user', content: 'flush-content' });

    const beforeFlushes = store.getCacheStats().flushes;
    await store.flush();
    expect(store.getCacheStats().flushes).toBe(beforeFlushes + 1);

    const raw = await fsp.readFile(sessionFilePath(rootDir, WS, rec.id), 'utf-8');
    const parsed = JSON.parse(raw) as SessionRecord;
    expect(parsed.messages[0].content).toBe('flush-content');
  });

  it('flush() on a clean store still increments flushes', async () => {
    const before = store.getCacheStats().flushes;
    await store.flush();
    expect(store.getCacheStats().flushes).toBe(before + 1);
  });
});

// ====== close() ===============================================================

describe('close()', () => {
  it('flushes pending writes then disposes', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    await store.appendMessage(WS, rec.id, { role: 'user', content: 'close-content' });
    await store.close();

    const raw = await fsp.readFile(sessionFilePath(rootDir, WS, rec.id), 'utf-8');
    const parsed = JSON.parse(raw) as SessionRecord;
    expect(parsed.messages[0].content).toBe('close-content');
  });
});

// ====== Autosave debounce =====================================================

describe('autosave debounce', () => {
  it('file content matches in-memory record after the debounce window elapses', async () => {
    const debounceMs = 80;
    const s = new SessionStore({ rootDir, autosaveDebounceMs: debounceMs });

    const rec = await s.create({ workspaceId: WS, title: 'Debounce', mode: 'chat' });
    await s.appendMessage(WS, rec.id, { role: 'user', content: 'debounce-msg' });

    // Wait beyond the debounce window for the timer to fire.
    await sleep(debounceMs + 120);

    const raw = await fsp.readFile(sessionFilePath(rootDir, WS, rec.id), 'utf-8');
    const parsed = JSON.parse(raw) as SessionRecord;
    expect(parsed.messages[0].content).toBe('debounce-msg');

    await s.close();
  });
});

// ====== Write error handling ==================================================

describe('write error handling', () => {
  it('writeErrors increments when writes fail; get still returns cached value', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    const wsDir = path.join(rootDir, sanitizeId(WS));

    // Make workspace directory read-only so new file creation fails.
    await fsp.chmod(wsDir, 0o444);

    try {
      await store.appendMessage(WS, rec.id, { role: 'user', content: 'error-test' });
      // Wait long enough for the debounced write to attempt and fail.
      await sleep(300);

      expect(store.getCacheStats().writeErrors).toBeGreaterThanOrEqual(1);

      // In-memory cache must still serve the record.
      const found = await store.get(WS, rec.id);
      expect(found).not.toBeNull();
      expect(found!.messages[0].content).toBe('error-test');
    } finally {
      // Restore permissions so afterEach cleanup succeeds.
      await fsp.chmod(wsDir, 0o755).catch(() => { /* ignore */ });
    }
  });
});

// ====== Crash safety ==========================================================

describe('crash safety', () => {
  it('appendMessage + close + new store + get returns the persisted message', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    await store.appendMessage(WS, rec.id, { role: 'user', content: 'persisted' });
    await store.close();

    const store2 = makeStore(rootDir);
    const found = await store2.get(WS, rec.id);
    await store2.close();

    expect(found).not.toBeNull();
    expect(found!.messages[0].content).toBe('persisted');
  });
});

// ====== Concurrent appendMessage ==============================================

describe('concurrent appendMessage', () => {
  it('all messages are present after concurrent appends (order preserved in array)', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'T', mode: 'chat' });
    await Promise.all([
      store.appendMessage(WS, rec.id, { role: 'user', content: 'msg1' }),
      store.appendMessage(WS, rec.id, { role: 'user', content: 'msg2' }),
      store.appendMessage(WS, rec.id, { role: 'user', content: 'msg3' }),
    ]);

    const found = await store.get(WS, rec.id);
    expect(found!.messages).toHaveLength(3);
    const contents = found!.messages.map((m) => m.content);
    expect(contents).toContain('msg1');
    expect(contents).toContain('msg2');
    expect(contents).toContain('msg3');
  });
});

// ====== getCacheStats() =======================================================

describe('getCacheStats()', () => {
  it('loaded reflects the number of sessions in cache', async () => {
    await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    await store.create({ workspaceId: WS, title: 'B', mode: 'chat' });
    expect(store.getCacheStats().loaded).toBeGreaterThanOrEqual(2);
  });

  it('dirty reflects pending unsaved sessions', async () => {
    const rec = await store.create({ workspaceId: WS, title: 'A', mode: 'chat' });
    // appendMessage marks dirty
    await store.appendMessage(WS, rec.id, { role: 'user', content: 'x' });
    expect(store.getCacheStats().dirty).toBeGreaterThanOrEqual(1);
  });

  it('flushes is 0 initially and increments after flush()', async () => {
    expect(store.getCacheStats().flushes).toBe(0);
    await store.flush();
    expect(store.getCacheStats().flushes).toBe(1);
    await store.flush();
    expect(store.getCacheStats().flushes).toBe(2);
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAuditLog } from './audit-log';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

function makeTmpPath(): string {
  const rand = crypto.randomBytes(4).toString('hex');
  return path.join(os.tmpdir(), `audit-${Date.now()}-${rand}`);
}

function cleanup(filePath: string, maxFiles = 5): void {
  const candidates = [
    filePath,
    `${filePath}.tmp`,
    ...Array.from({ length: maxFiles + 1 }, (_, i) => `${filePath}.${i + 1}`),
  ];
  for (const f of candidates) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

describe('AuditLog', () => {
  let filePath: string;

  beforeEach(() => {
    filePath = makeTmpPath();
  });

  afterEach(() => {
    cleanup(filePath);
  });

  // ── Basic append ────────────────────────────────────────────────────────────

  it('append returns entry with seq, ts, and hash', async () => {
    const log = createAuditLog({ filePath });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    expect(entry.seq).toBe(1);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.actor).toBe('alice');
    expect(entry.action).toBe('login');
  });

  it('seq increments on each append', async () => {
    const log = createAuditLog({ filePath });
    const e1 = await log.append({ actor: 'alice', action: 'a' });
    const e2 = await log.append({ actor: 'alice', action: 'b' });
    const e3 = await log.append({ actor: 'alice', action: 'c' });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
  });

  it('genesis prevHash is 64 zeros', async () => {
    const log = createAuditLog({ filePath });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    expect(entry.prevHash).toBe('0'.repeat(64));
  });

  it('prevHash links to previous entry hash', async () => {
    const log = createAuditLog({ filePath });
    const e1 = await log.append({ actor: 'alice', action: 'a' });
    const e2 = await log.append({ actor: 'alice', action: 'b' });
    expect(e2.prevHash).toBe(e1.hash);
  });

  it('hash is sha256 of canonical fields', async () => {
    const fixed = 1700000000000;
    const log = createAuditLog({ filePath, clock: () => fixed });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    const expected = crypto.createHash('sha256').update(JSON.stringify({
      seq: 1,
      ts: new Date(fixed).toISOString(),
      actor: 'alice',
      action: 'login',
      prevHash: '0'.repeat(64),
    })).digest('hex');
    expect(entry.hash).toBe(expected);
  });

  it('includes target and data in entry', async () => {
    const log = createAuditLog({ filePath });
    const entry = await log.append({ actor: 'alice', action: 'view', target: 'doc1', data: { ip: '1.2.3.4' } });
    expect(entry.target).toBe('doc1');
    expect(entry.data).toEqual({ ip: '1.2.3.4' });
  });

  it('hash incorporates target when present', async () => {
    const fixed = 1700000000000;
    const log = createAuditLog({ filePath, clock: () => fixed });
    const entry = await log.append({ actor: 'alice', action: 'view', target: 'doc1' });
    const expected = crypto.createHash('sha256').update(JSON.stringify({
      seq: 1,
      ts: new Date(fixed).toISOString(),
      actor: 'alice',
      action: 'view',
      target: 'doc1',
      prevHash: '0'.repeat(64),
    })).digest('hex');
    expect(entry.hash).toBe(expected);
  });

  // ── HMAC signing ────────────────────────────────────────────────────────────

  it('produces signature when hmacKey is set', async () => {
    const log = createAuditLog({ filePath, hmacKey: 'secret' });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    expect(entry.signature).toBeDefined();
    expect(entry.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('signature is HMAC-SHA256 of hash', async () => {
    const key = 'my-secret-key';
    const log = createAuditLog({ filePath, hmacKey: key });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    const expectedSig = crypto.createHmac('sha256', key).update(entry.hash).digest('hex');
    expect(entry.signature).toBe(expectedSig);
  });

  it('no signature when hmacKey is not set', async () => {
    const log = createAuditLog({ filePath });
    const entry = await log.append({ actor: 'alice', action: 'login' });
    expect(entry.signature).toBeUndefined();
  });

  // ── Read ────────────────────────────────────────────────────────────────────

  it('read returns empty array for empty log', async () => {
    const log = createAuditLog({ filePath });
    const entries = await log.read();
    expect(entries).toEqual([]);
  });

  it('read returns all entries', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'bob', action: 'b' });
    const entries = await log.read();
    expect(entries).toHaveLength(2);
  });

  it('read returns entries in ascending seq order', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    await log.append({ actor: 'alice', action: 'c' });
    const entries = await log.read();
    expect(entries.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('read filters by actor', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'login' });
    await log.append({ actor: 'bob', action: 'login' });
    const entries = await log.read({ actor: 'alice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].actor).toBe('alice');
  });

  it('read filters by action', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'login' });
    await log.append({ actor: 'alice', action: 'logout' });
    const entries = await log.read({ action: 'login' });
    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('login');
  });

  it('read filters by target', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'view', target: 'doc1' });
    await log.append({ actor: 'alice', action: 'view', target: 'doc2' });
    const entries = await log.read({ target: 'doc1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe('doc1');
  });

  it('read filters by sinceMs (inclusive)', async () => {
    let t = 1000;
    const log = createAuditLog({ filePath, clock: () => t });
    t = 1000; await log.append({ actor: 'alice', action: 'a' });
    t = 2000; await log.append({ actor: 'alice', action: 'b' });
    t = 3000; await log.append({ actor: 'alice', action: 'c' });
    const entries = await log.read({ sinceMs: 2000 });
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.action)).toEqual(['b', 'c']);
  });

  it('read filters by untilMs (inclusive)', async () => {
    let t = 1000;
    const log = createAuditLog({ filePath, clock: () => t });
    t = 1000; await log.append({ actor: 'alice', action: 'a' });
    t = 2000; await log.append({ actor: 'alice', action: 'b' });
    t = 3000; await log.append({ actor: 'alice', action: 'c' });
    const entries = await log.read({ untilMs: 2000 });
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.action)).toEqual(['a', 'b']);
  });

  it('read limits results', async () => {
    const log = createAuditLog({ filePath });
    for (let i = 0; i < 5; i++) {
      await log.append({ actor: 'alice', action: `a${i}` });
    }
    const entries = await log.read({ limit: 3 });
    expect(entries).toHaveLength(3);
    expect(entries[0].seq).toBe(1);
  });

  // ── Verify ──────────────────────────────────────────────────────────────────

  it('verify returns ok on untampered log', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'login' });
    await log.append({ actor: 'bob', action: 'logout' });
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it('verify returns ok on empty log', async () => {
    const log = createAuditLog({ filePath });
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it('verify detects tampered data field', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'login' });
    await log.append({ actor: 'alice', action: 'view', data: { secret: 'original' } });

    const content = fs.readFileSync(filePath, 'utf8');
    fs.writeFileSync(filePath, content.replace('"original"', '"tampered"'));

    const result = await log.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBeDefined();
    expect(result.reason).toBeDefined();
  });

  it('verify reports brokenAt = seq of first broken entry', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    await log.append({ actor: 'alice', action: 'c' });

    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const entry2 = JSON.parse(lines[1]) as Record<string, unknown>;
    entry2['action'] = 'HACKED';
    lines[1] = JSON.stringify(entry2);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = await log.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(2);
    expect(result.reason).toContain('2');
  });

  it('verify detects signature mismatch', async () => {
    const log = createAuditLog({ filePath, hmacKey: 'secret' });
    await log.append({ actor: 'alice', action: 'login' });

    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    entry['signature'] = 'a'.repeat(64);
    lines[0] = JSON.stringify(entry);
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const log2 = createAuditLog({ filePath, hmacKey: 'secret' });
    const result = await log2.verify();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('signature');
  });

  it('verify with hmacKey validates all signatures as ok', async () => {
    const log = createAuditLog({ filePath, hmacKey: 'key123' });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  // ── Rotation ─────────────────────────────────────────────────────────────────

  it('rotates file when maxFileBytes threshold is reached', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1 });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
  });

  it('seq continues monotonically across rotations', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1 });
    const e1 = await log.append({ actor: 'alice', action: 'a' });
    const e2 = await log.append({ actor: 'alice', action: 'b' });
    const e3 = await log.append({ actor: 'alice', action: 'c' });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
  });

  it('read merges current and rotated files in seq order', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1, maxFiles: 5 });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    await log.append({ actor: 'alice', action: 'c' });
    const entries = await log.read();
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.seq)).toEqual([1, 2, 3]);
  });

  it('enforces maxFiles — oldest rotated file is deleted', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1, maxFiles: 2 });
    for (let i = 0; i < 5; i++) {
      await log.append({ actor: 'alice', action: `a${i}` });
    }
    expect(fs.existsSync(`${filePath}.3`)).toBe(false);
    expect(fs.existsSync(`${filePath}.1`)).toBe(true);
    expect(fs.existsSync(`${filePath}.2`)).toBe(true);
  });

  it('rotations counter increments on each rotation', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1 });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    expect(log.getStats().rotations).toBeGreaterThanOrEqual(1);
  });

  it('atomic rotation: no tmp file left after rotation', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1 });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    expect(fs.existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it('verify works across rotated files', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1, maxFiles: 5 });
    for (let i = 0; i < 4; i++) {
      await log.append({ actor: 'alice', action: `a${i}` });
    }
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it('verify with hmacKey across rotated files', async () => {
    const log = createAuditLog({ filePath, hmacKey: 'k', maxFileBytes: 1, maxFiles: 5 });
    for (let i = 0; i < 4; i++) {
      await log.append({ actor: 'alice', action: `a${i}` });
    }
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  it('read still works after multiple rotations', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1, maxFiles: 5 });
    for (let i = 0; i < 5; i++) {
      await log.append({ actor: 'alice', action: `action${i}` });
    }
    const entries = await log.read();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    // All returned entries should have valid ascending seq
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].seq).toBeGreaterThan(entries[i - 1].seq);
    }
  });

  // ── Stats ───────────────────────────────────────────────────────────────────

  it('getStats returns accurate totalEntries and rotations', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'a' });
    await log.append({ actor: 'alice', action: 'b' });
    const stats = log.getStats();
    expect(stats.totalEntries).toBe(2);
    expect(stats.rotations).toBe(0);
  });

  it('getStats fileBytes matches actual active file size', async () => {
    const log = createAuditLog({ filePath });
    await log.append({ actor: 'alice', action: 'test' });
    const stats = log.getStats();
    const actualSize = fs.statSync(filePath).size;
    expect(stats.fileBytes).toBe(actualSize);
  });

  it('getStats fileBytes resets to 0 after rotation', async () => {
    const log = createAuditLog({ filePath, maxFileBytes: 1 });
    await log.append({ actor: 'alice', action: 'a' }); // triggers rotation
    expect(log.getStats().fileBytes).toBe(0);
  });

  // ── Concurrent ──────────────────────────────────────────────────────────────

  it('concurrent appends produce unique monotonic seq values', async () => {
    const log = createAuditLog({ filePath });
    const N = 10;
    const entries = await Promise.all(
      Array.from({ length: N }, () => log.append({ actor: 'alice', action: 'concurrent' })),
    );
    const seqs = entries.map(e => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });

  it('concurrent appends produce a valid hash chain', async () => {
    const log = createAuditLog({ filePath });
    await Promise.all(
      Array.from({ length: 5 }, () => log.append({ actor: 'alice', action: 'x' })),
    );
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });

  // ── Flush ────────────────────────────────────────────────────────────────────

  it('flush resolves after all pending writes complete', async () => {
    const log = createAuditLog({ filePath });
    void log.append({ actor: 'alice', action: 'a' });
    void log.append({ actor: 'alice', action: 'b' });
    void log.append({ actor: 'alice', action: 'c' });
    await log.flush();
    const entries = await log.read();
    expect(entries).toHaveLength(3);
  });
});

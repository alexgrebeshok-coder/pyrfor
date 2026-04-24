// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import * as os from 'node:os';
import { createBackupManager } from './backup-restore';
import type { BackupSource, BackupManifest, BackupArchive, RestoreReport } from './backup-restore';

// ── test helpers ─────────────────────────────────────────────────────────────

let testRoot: string;

function mkTestDir(name: string): string {
  const d = path.join(testRoot, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeFile(dir: string, relPath: string, content: string): void {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function makeManager(tag = 'main') {
  const archiveDir = mkTestDir(`archives-${tag}-${Math.random().toString(36).slice(2)}`);
  let tick = 1_000_000;
  const logs: { msg: string; meta?: any }[] = [];
  const mgr = createBackupManager({
    archiveDir,
    clock: () => tick++,
    logger: (msg, meta) => logs.push({ msg, meta }),
  });
  return { mgr, archiveDir, logs, setTick: (v: number) => { tick = v; } };
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-test-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

// ── source management ─────────────────────────────────────────────────────────

describe('addSource / removeSource / listSources', () => {
  it('starts with no sources', () => {
    const { mgr } = makeManager();
    expect(mgr.listSources()).toHaveLength(0);
  });

  it('addSource stores a source', () => {
    const { mgr } = makeManager();
    mgr.addSource({ id: 'sessions', path: '/data/sessions' });
    expect(mgr.listSources()).toHaveLength(1);
    expect(mgr.listSources()[0].id).toBe('sessions');
  });

  it('addSource with include/exclude stored correctly', () => {
    const { mgr } = makeManager();
    const inc = /\.json$/;
    const exc = /tmp/;
    mgr.addSource({ id: 'memory', path: '/data/memory', include: inc, exclude: exc });
    const src = mgr.listSources()[0];
    expect(src.include).toBe(inc);
    expect(src.exclude).toBe(exc);
  });

  it('removeSource removes by id', () => {
    const { mgr } = makeManager();
    mgr.addSource({ id: 'a', path: '/a' });
    mgr.addSource({ id: 'b', path: '/b' });
    mgr.removeSource('a');
    expect(mgr.listSources().map((s) => s.id)).toEqual(['b']);
  });

  it('removeSource on unknown id is a no-op', () => {
    const { mgr } = makeManager();
    mgr.addSource({ id: 'x', path: '/x' });
    mgr.removeSource('nope');
    expect(mgr.listSources()).toHaveLength(1);
  });

  it('listSources returns all added sources', () => {
    const { mgr } = makeManager();
    mgr.addSource({ id: 'a', path: '/a' });
    mgr.addSource({ id: 'b', path: '/b' });
    mgr.addSource({ id: 'c', path: '/c' });
    expect(mgr.listSources()).toHaveLength(3);
  });
});

// ── snapshot ──────────────────────────────────────────────────────────────────

describe('snapshot', () => {
  it('creates a .bk file under archiveDir', async () => {
    const { mgr, archiveDir } = makeManager();
    const srcDir = mkTestDir('src1');
    writeFile(srcDir, 'a.json', '{}');
    mgr.addSource({ id: 's1', path: srcDir });
    const archive = await mgr.snapshot();
    expect(archive.archivePath).toContain(archiveDir);
    expect(archive.archivePath).toMatch(/\.bk$/);
    expect(fs.existsSync(archive.archivePath)).toBe(true);
  });

  it('archive filename contains timestamp and default tag', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src2');
    writeFile(srcDir, 'b.json', '{"x":1}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    expect(path.basename(archive.archivePath)).toMatch(/^\d+-snap\.bk$/);
  });

  it('custom tag appears in filename', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src3');
    writeFile(srcDir, 'c.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot({ tag: 'nightly' });
    expect(path.basename(archive.archivePath)).toContain('nightly');
  });

  it('manifest format is pyrfor-bk-v1', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src4');
    writeFile(srcDir, 'x.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    expect(archive.manifest.format).toBe('pyrfor-bk-v1');
  });

  it('manifest reflects source id and file count', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src5');
    writeFile(srcDir, 'a.json', '{"a":1}');
    writeFile(srcDir, 'b.json', '{"b":2}');
    mgr.addSource({ id: 'mystore', path: srcDir });
    const archive = await mgr.snapshot();
    const entry = archive.manifest.sources.find((s) => s.id === 'mystore')!;
    expect(entry).toBeDefined();
    expect(entry.fileCount).toBe(2);
  });

  it('manifest totalBytes matches sum of source bytes', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src6');
    writeFile(srcDir, 'x.json', 'hello');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    const sourceBytes = archive.manifest.sources.reduce((s, e) => s + e.bytes, 0);
    expect(archive.manifest.totalBytes).toBe(sourceBytes);
  });

  it('manifest bytes match actual file content size', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src7');
    const content = 'content-of-known-length';
    writeFile(srcDir, 'f.json', content);
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    expect(archive.manifest.sources[0].bytes).toBe(Buffer.byteLength(content));
  });

  it('include filter limits files to matching', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src-inc');
    writeFile(srcDir, 'a.json', '{}');
    writeFile(srcDir, 'b.txt', 'text');
    writeFile(srcDir, 'c.json', '{}');
    mgr.addSource({ id: 's', path: srcDir, include: /\.json$/ });
    const archive = await mgr.snapshot();
    expect(archive.manifest.sources[0].fileCount).toBe(2);
  });

  it('exclude filter drops matching files', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('src-exc');
    writeFile(srcDir, 'keep.json', '{}');
    writeFile(srcDir, 'skip.tmp.json', '{}');
    mgr.addSource({ id: 's', path: srcDir, exclude: /\.tmp\./ });
    const archive = await mgr.snapshot();
    expect(archive.manifest.sources[0].fileCount).toBe(1);
  });

  it('empty source dir results in fileCount 0 (no error)', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('empty-src');
    mgr.addSource({ id: 'empty', path: srcDir });
    const archive = await mgr.snapshot();
    const entry = archive.manifest.sources[0];
    expect(entry.fileCount).toBe(0);
    expect(entry.bytes).toBe(0);
  });

  it('missing source dir logs warn and is skipped gracefully', async () => {
    const { mgr, logs } = makeManager();
    mgr.addSource({ id: 'ghost', path: path.join(testRoot, 'does-not-exist') });
    const archive = await mgr.snapshot();
    expect(archive.manifest.sources[0].fileCount).toBe(0);
    expect(logs.some((l) => l.msg.includes('warn'))).toBe(true);
  });

  it('archive is valid gzip', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('gzip-check');
    writeFile(srcDir, 'data.json', '{"ok":true}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    const raw = fs.readFileSync(archive.archivePath);
    expect(() => zlib.gunzipSync(raw)).not.toThrow();
  });

  it('archive JSON contains files map with base64 content', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('b64-check');
    const content = '{"hello":"world"}';
    writeFile(srcDir, 'data.json', content);
    mgr.addSource({ id: 'src', path: srcDir });
    const archive = await mgr.snapshot();
    const raw = fs.readFileSync(archive.archivePath);
    const doc = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
    const key = Object.keys(doc.files)[0];
    expect(Buffer.from(doc.files[key], 'base64').toString('utf8')).toBe(content);
  });

  it('walks subdirectories recursively', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('nested');
    writeFile(srcDir, 'top.json', '{}');
    writeFile(srcDir, 'sub/deep.json', '{}');
    writeFile(srcDir, 'sub/sub2/deeper.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    expect(archive.manifest.sources[0].fileCount).toBe(3);
  });
});

// ── listArchives ──────────────────────────────────────────────────────────────

describe('listArchives', () => {
  it('returns empty array when no archives exist', () => {
    const { mgr } = makeManager();
    expect(mgr.listArchives()).toHaveLength(0);
  });

  it('discovers .bk files with readable manifest', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('la-src');
    writeFile(srcDir, 'x.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    await mgr.snapshot();
    const list = mgr.listArchives();
    expect(list).toHaveLength(1);
    expect(list[0].manifest.format).toBe('pyrfor-bk-v1');
  });

  it('lists multiple archives', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('multi-la');
    writeFile(srcDir, 'a.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    await mgr.snapshot({ tag: 'first' });
    await mgr.snapshot({ tag: 'second' });
    expect(mgr.listArchives()).toHaveLength(2);
  });
});

// ── restore ───────────────────────────────────────────────────────────────────

describe('restore', () => {
  it('round-trip: snapshot then restore produces identical bytes', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('rt-src');
    const content = '{"restore":"me"}';
    writeFile(srcDir, 'data.json', content);
    mgr.addSource({ id: 'store', path: srcDir });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('rt-dest');
    await mgr.restore(archive.archivePath, { targetRoot: restoreDir });

    const restored = readFile(path.join(restoreDir, 'store', 'data.json'));
    expect(restored).toBe(content);
  });

  it('restore returns correct restoredFiles count', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('rc-src');
    writeFile(srcDir, 'a.json', '1');
    writeFile(srcDir, 'b.json', '2');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('rc-dest');
    const report = await mgr.restore(archive.archivePath, { targetRoot: restoreDir });
    expect(report.restoredFiles).toBe(2);
  });

  it('restore with sourceIds filter restores only matching sources', async () => {
    const { mgr } = makeManager();
    const dir1 = mkTestDir('filter-s1');
    const dir2 = mkTestDir('filter-s2');
    writeFile(dir1, 'a.json', 'a');
    writeFile(dir2, 'b.json', 'b');
    mgr.addSource({ id: 'src1', path: dir1 });
    mgr.addSource({ id: 'src2', path: dir2 });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('filter-dest');
    await mgr.restore(archive.archivePath, { targetRoot: restoreDir, sourceIds: ['src1'] });

    expect(fs.existsSync(path.join(restoreDir, 'src1', 'a.json'))).toBe(true);
    expect(fs.existsSync(path.join(restoreDir, 'src2', 'b.json'))).toBe(false);
  });

  it('restore !overwrite skips existing files', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('ow-src');
    writeFile(srcDir, 'data.json', 'original');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('ow-dest');
    const existing = path.join(restoreDir, 's', 'data.json');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'pre-existing');

    const report = await mgr.restore(archive.archivePath, {
      targetRoot: restoreDir,
      overwrite: false,
    });

    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0].reason).toBe('exists');
    expect(readFile(existing)).toBe('pre-existing');
  });

  it('restore with overwrite=true replaces existing files', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('ow2-src');
    writeFile(srcDir, 'data.json', 'new-content');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('ow2-dest');
    const existing = path.join(restoreDir, 's', 'data.json');
    fs.mkdirSync(path.dirname(existing), { recursive: true });
    fs.writeFileSync(existing, 'old-content');

    await mgr.restore(archive.archivePath, { targetRoot: restoreDir, overwrite: true });
    expect(readFile(existing)).toBe('new-content');
  });

  it('restore bytes total matches content', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('bytes-src');
    const content = 'exactly-this';
    writeFile(srcDir, 'f.json', content);
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();

    const restoreDir = mkTestDir('bytes-dest');
    const report = await mgr.restore(archive.archivePath, { targetRoot: restoreDir });
    expect(report.bytes).toBe(Buffer.byteLength(content));
  });
});

// ── verify ────────────────────────────────────────────────────────────────────

describe('verify', () => {
  it('returns ok=true on healthy archive', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('v-src');
    writeFile(srcDir, 'a.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    const archive = await mgr.snapshot();
    const result = await mgr.verify(archive.archivePath);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns ok=false + error for corrupt gzip', async () => {
    const { mgr, archiveDir } = makeManager();
    const corrupt = path.join(archiveDir, '9999-corrupt.bk');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(corrupt, Buffer.from('not-gzip-data'));
    const result = await mgr.verify(corrupt);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns ok=false for malformed manifest (wrong format)', async () => {
    const { mgr, archiveDir } = makeManager();
    fs.mkdirSync(archiveDir, { recursive: true });
    const badDoc = { manifest: { id: 'x', createdAt: 1, sources: [], totalBytes: 0, format: 'bad-format' }, files: {} };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(badDoc)));
    const p = path.join(archiveDir, '1-bad.bk');
    fs.writeFileSync(p, gz);
    const result = await mgr.verify(p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('format'))).toBe(true);
  });

  it('returns ok=false when file count mismatches manifest', async () => {
    const { mgr, archiveDir } = makeManager();
    fs.mkdirSync(archiveDir, { recursive: true });
    // manifest says 1 file, but files map is empty
    const badDoc = {
      manifest: { id: 'abc', createdAt: 1, sources: [{ id: 's', path: '/x', fileCount: 1, bytes: 5 }], totalBytes: 5, format: 'pyrfor-bk-v1' },
      files: {},
    };
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(badDoc)));
    const p = path.join(archiveDir, '2-mismatch.bk');
    fs.writeFileSync(p, gz);
    const result = await mgr.verify(p);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('mismatch'))).toBe(true);
  });
});

// ── prune ─────────────────────────────────────────────────────────────────────

describe('prune', () => {
  it('keepLast N keeps newest N archives', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('prune-src');
    writeFile(srcDir, 'x.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    await mgr.snapshot({ tag: 'a' });
    await mgr.snapshot({ tag: 'b' });
    await mgr.snapshot({ tag: 'c' });
    await mgr.snapshot({ tag: 'd' });
    const result = await mgr.prune({ keepLast: 2 });
    expect(result.deleted).toHaveLength(2);
    expect(mgr.listArchives()).toHaveLength(2);
  });

  it('prune olderThanMs deletes archives older than threshold', async () => {
    const { mgr, setTick } = makeManager();
    const srcDir = mkTestDir('prune-old');
    writeFile(srcDir, 'x.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    setTick(1000);
    await mgr.snapshot({ tag: 'ancient' });
    setTick(5000);
    await mgr.snapshot({ tag: 'recent' });
    // now=5001, olderThanMs=3000 → archives older than 5001-3000=2001 are deleted
    setTick(5001);
    const result = await mgr.prune({ olderThanMs: 3000 });
    expect(result.deleted).toHaveLength(1);
    expect(result.deleted[0]).toContain('ancient');
  });

  it('prune on empty archiveDir returns empty deleted list', async () => {
    const { mgr } = makeManager();
    const result = await mgr.prune({ keepLast: 5 });
    expect(result.deleted).toHaveLength(0);
  });

  it('keepLast 0 deletes all archives', async () => {
    const { mgr } = makeManager();
    const srcDir = mkTestDir('prune-all');
    writeFile(srcDir, 'x.json', '{}');
    mgr.addSource({ id: 's', path: srcDir });
    await mgr.snapshot({ tag: 'one' });
    await mgr.snapshot({ tag: 'two' });
    await mgr.prune({ keepLast: 0 });
    expect(mgr.listArchives()).toHaveLength(0);
  });
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { packEntries, unpackBuffer, packFromDir, unpackToDir } from './tar-bundler';

// ---------------------------------------------------------------------------
// Test directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeTmp(): string {
  const d = path.join(os.tmpdir(), `tar-bundler-test-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

beforeEach(() => {
  tmpDir = makeTmp();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Empty archive (just two zero blocks) → []
// ---------------------------------------------------------------------------

describe('unpackBuffer', () => {
  it('parses an empty archive (two zero blocks) as []', () => {
    const buf = Buffer.alloc(1024, 0);
    expect(unpackBuffer(buf)).toEqual([]);
  });

  // 2. Checksum mismatch throws
  it('throws on checksum mismatch', () => {
    const packed = packEntries([{ name: 'a.txt', data: 'hello' }]);
    // corrupt a byte in the header (outside checksum field)
    packed[0] ^= 0xff;
    expect(() => unpackBuffer(packed)).toThrow('checksum mismatch');
  });
});

// ---------------------------------------------------------------------------
// 2. pack→unpack round-trips
// ---------------------------------------------------------------------------

describe('packEntries / unpackBuffer round-trips', () => {
  it('round-trips a text file', () => {
    const entries = [{ name: 'hello.txt', data: 'hello world' }];
    const buf = packEntries(entries);
    const out = unpackBuffer(buf);
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('hello.txt');
    expect(out[0]!.data.toString()).toBe('hello world');
    expect(out[0]!.type).toBe('file');
  });

  it('round-trips a binary file', () => {
    const data = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
    const buf = packEntries([{ name: 'bin.bin', data }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.data).toEqual(data);
  });

  it('round-trips multiple files', () => {
    const entries = [
      { name: 'a.txt', data: 'alpha' },
      { name: 'b.txt', data: 'beta' },
      { name: 'c.txt', data: 'gamma' },
    ];
    const buf = packEntries(entries);
    const out = unpackBuffer(buf);
    expect(out).toHaveLength(3);
    expect(out.map(e => e.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(out[1]!.data.toString()).toBe('beta');
  });

  it('round-trips a directory entry', () => {
    const buf = packEntries([{ name: 'mydir/', data: '', type: 'dir', mode: 0o755 }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.type).toBe('dir');
    expect(out[0]!.name).toBe('mydir/');
    expect(out[0]!.mode).toBe(0o755);
  });

  it('round-trips a symlink entry', () => {
    const buf = packEntries([{ name: 'link', data: '', type: 'symlink', linkname: '/etc/passwd' }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.type).toBe('symlink');
    expect(out[0]!.linkname).toBe('/etc/passwd');
    expect(out[0]!.name).toBe('link');
  });

  it('preserves mode field', () => {
    const buf = packEntries([{ name: 'exec.sh', data: '#!/bin/sh', mode: 0o755 }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.mode).toBe(0o755);
  });

  it('preserves uid, gid, uname, gname', () => {
    const buf = packEntries([{
      name: 'f.txt', data: 'x',
      uid: 1000, gid: 2000, uname: 'alice', gname: 'staff',
    }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.uid).toBe(1000);
    expect(out[0]!.gid).toBe(2000);
    expect(out[0]!.uname).toBe('alice');
    expect(out[0]!.gname).toBe('staff');
  });

  it('default mtime is 0 (deterministic)', () => {
    const buf = packEntries([{ name: 'f.txt', data: 'x' }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.mtime).toBe(0);
  });

  it('two packs with same entries produce identical bytes (deterministic)', () => {
    const entries = [
      { name: 'a.txt', data: 'hello', mtime: 0 },
      { name: 'b.txt', data: 'world', mtime: 0 },
    ];
    expect(packEntries(entries)).toEqual(packEntries(entries));
  });

  // prefix-split filename round-trip
  it('round-trips a filename longer than 100 chars using prefix split', () => {
    const longName = 'a'.repeat(80) + '/' + 'b'.repeat(80) + '.txt'; // 162 chars
    const buf = packEntries([{ name: longName, data: 'content' }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.name).toBe(longName);
  });

  it('throws for filename that cannot be split to fit', () => {
    // 101-char name without any slash => can't split
    const tooLong = 'x'.repeat(101);
    expect(() => packEntries([{ name: tooLong, data: '' }])).toThrow('filename too long');
  });

  it('throws for prefix part > 155 chars', () => {
    // prefix of 156 chars + / + name of 1 char
    const tooLong = 'p'.repeat(156) + '/n';
    expect(() => packEntries([{ name: tooLong, data: '' }])).toThrow('filename too long');
  });
});

// ---------------------------------------------------------------------------
// 3. packFromDir / unpackToDir
// ---------------------------------------------------------------------------

describe('packFromDir + unpackToDir', () => {
  it('packs a directory and unpacks it back', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'hello.txt'), 'hello');
    fs.writeFileSync(path.join(src, 'world.txt'), 'world');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out);

    expect(fs.readFileSync(path.join(out, 'hello.txt'), 'utf8')).toBe('hello');
    expect(fs.readFileSync(path.join(out, 'world.txt'), 'utf8')).toBe('world');
  });

  it('creates nested directories', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(path.join(src, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(src, 'a', 'b', 'deep.txt'), 'deep');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out);

    expect(fs.readFileSync(path.join(out, 'a', 'b', 'deep.txt'), 'utf8')).toBe('deep');
  });

  it('filter excludes files', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'keep.txt'), 'yes');
    fs.writeFileSync(path.join(src, 'skip.log'), 'no');

    const buf = await packFromDir(src, {
      filter: (rel) => !rel.endsWith('.log'),
    });
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out);

    expect(fs.existsSync(path.join(out, 'keep.txt'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'skip.log'))).toBe(false);
  });

  it('gzip round-trip via packFromDir + unpackToDir', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'data.txt'), 'gzipped content');

    const buf = await packFromDir(src, { gzip: true });
    // verify it is actually gzipped
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);

    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out); // auto-detect
    expect(fs.readFileSync(path.join(out, 'data.txt'), 'utf8')).toBe('gzipped content');
  });

  it('unpackToDir auto-detects gzip', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'f.txt'), 'auto');

    const raw = await packFromDir(src);
    const gzipped = zlib.gzipSync(raw);

    const out = path.join(tmpDir, 'out');
    await unpackToDir(gzipped, out, { gzip: 'auto' });
    expect(fs.readFileSync(path.join(out, 'f.txt'), 'utf8')).toBe('auto');
  });

  it('strip=1 removes leading directory component', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(path.join(src, 'prefix'), { recursive: true });
    fs.writeFileSync(path.join(src, 'prefix', 'file.txt'), 'stripped');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out, { strip: 1 });

    expect(fs.readFileSync(path.join(out, 'file.txt'), 'utf8')).toBe('stripped');
  });

  it('overwrite=false throws when file already exists', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'f.txt'), 'original');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out); // first write succeeds

    await expect(unpackToDir(buf, out, { overwrite: false }))
      .rejects.toThrow('file already exists');
  });

  it('overwrite=true replaces existing files', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'f.txt'), 'v1');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    await unpackToDir(buf, out);

    // change content and repack
    fs.writeFileSync(path.join(src, 'f.txt'), 'v2');
    const buf2 = await packFromDir(src);
    await unpackToDir(buf2, out, { overwrite: true });

    expect(fs.readFileSync(path.join(out, 'f.txt'), 'utf8')).toBe('v2');
  });

  it('blocks path traversal (../etc/passwd)', async () => {
    const maliciousEntry = [{ name: '../etc/passwd', data: 'evil' }];
    const buf = packEntries(maliciousEntry);
    const out = path.join(tmpDir, 'out');
    fs.mkdirSync(out);

    await expect(unpackToDir(buf, out)).rejects.toThrow('path traversal blocked');
  });

  it('blocks absolute path traversal', async () => {
    const buf = packEntries([{ name: '/etc/passwd', data: 'evil' }]);
    const out = path.join(tmpDir, 'out');
    fs.mkdirSync(out);

    await expect(unpackToDir(buf, out)).rejects.toThrow('path traversal blocked');
  });

  it('written list contains paths of extracted files', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'x.txt'), 'x');
    fs.writeFileSync(path.join(src, 'y.txt'), 'y');

    const buf = await packFromDir(src);
    const out = path.join(tmpDir, 'out');
    const result = await unpackToDir(buf, out);

    expect(result.written).toHaveLength(2);
    expect(result.written.every(p => p.startsWith(out))).toBe(true);
  });

  it('round-trips file mode from packFromDir', async () => {
    const src = path.join(tmpDir, 'src');
    fs.mkdirSync(src);
    const scriptPath = path.join(src, 'run.sh');
    fs.writeFileSync(scriptPath, '#!/bin/sh\necho hi');
    fs.chmodSync(scriptPath, 0o755);

    const buf = await packFromDir(src);
    const entries = unpackBuffer(buf);
    const entry = entries.find(e => e.name === 'run.sh');
    expect(entry).toBeDefined();
    expect(entry!.mode & 0o777).toBe(0o755);
  });
});

// ---------------------------------------------------------------------------
// 4. Edge-case: large binary data round-trip
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('round-trips a 64KB binary buffer', () => {
    const data = crypto.randomBytes(65536);
    const buf = packEntries([{ name: 'big.bin', data }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.data).toEqual(data);
  });

  it('round-trips an empty file (0 bytes)', () => {
    const buf = packEntries([{ name: 'empty.txt', data: '' }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.data.length).toBe(0);
    expect(out[0]!.name).toBe('empty.txt');
  });

  it('round-trips data whose length is exactly 512 bytes', () => {
    const data = Buffer.alloc(512, 0x42);
    const buf = packEntries([{ name: 'full.bin', data }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.data).toEqual(data);
  });

  it('round-trips data whose length is 511 bytes', () => {
    const data = Buffer.alloc(511, 0xab);
    const buf = packEntries([{ name: 'odd.bin', data }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.data).toEqual(data);
  });

  it('round-trips a filename exactly 100 chars (no prefix needed)', () => {
    const name = 'n'.repeat(100);
    const buf = packEntries([{ name, data: 'x' }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.name).toBe(name);
  });

  it('round-trips mtime value', () => {
    const mtime = 1700000000;
    const buf = packEntries([{ name: 'f.txt', data: 'x', mtime }]);
    const out = unpackBuffer(buf);
    expect(out[0]!.mtime).toBe(mtime);
  });
});

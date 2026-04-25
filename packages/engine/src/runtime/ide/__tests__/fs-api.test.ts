// @vitest-environment node
/**
 * Unit tests for the IDE filesystem API (fs-api.ts).
 * Each test creates an isolated temp workspace under os.tmpdir().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  listDir,
  readFile,
  writeFile,
  searchFiles,
  FsApiError,
  EXCLUDED_DIRS,
  type FsApiConfig,
} from '../fs-api.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

function makeCfg(root: string, maxFileSize?: number): FsApiConfig {
  return { workspaceRoot: root, maxFileSize };
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'pyrfor-fs-test-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ─── EXCLUDED_DIRS ────────────────────────────────────────────────────────

describe('EXCLUDED_DIRS', () => {
  it('contains expected directory names', () => {
    expect(EXCLUDED_DIRS.has('node_modules')).toBe(true);
    expect(EXCLUDED_DIRS.has('.git')).toBe(true);
    expect(EXCLUDED_DIRS.has('dist')).toBe(true);
    expect(EXCLUDED_DIRS.has('dist-cjs')).toBe(true);
    expect(EXCLUDED_DIRS.has('.next')).toBe(true);
    expect(EXCLUDED_DIRS.has('.cache')).toBe(true);
    expect(EXCLUDED_DIRS.has('coverage')).toBe(true);
    expect(EXCLUDED_DIRS.has('__pycache__')).toBe(true);
  });
});

// ─── listDir ──────────────────────────────────────────────────────────────

describe('listDir', () => {
  it('returns entries with correct relative paths and types', async () => {
    writeFileSync(join(workspace, 'hello.txt'), 'hi');
    mkdirSync(join(workspace, 'subdir'));
    writeFileSync(join(workspace, 'subdir', 'nested.ts'), 'export {}');

    const result = await listDir(makeCfg(workspace), '');
    expect(result.entries.length).toBeGreaterThanOrEqual(2);

    const names = result.entries.map(e => e.name);
    expect(names).toContain('hello.txt');
    expect(names).toContain('subdir');

    const fileEntry = result.entries.find(e => e.name === 'hello.txt')!;
    expect(fileEntry.type).toBe('file');
    expect(fileEntry.path).toBe('hello.txt');
    expect(fileEntry.size).toBeGreaterThan(0);
    expect(fileEntry.modifiedMs).toBeGreaterThan(0);

    const dirEntry = result.entries.find(e => e.name === 'subdir')!;
    expect(dirEntry.type).toBe('directory');
    expect(dirEntry.path).toBe('subdir');
  });

  it('lists subdirectory entries with correct relative path prefix', async () => {
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'index.ts'), 'const x = 1;');

    const result = await listDir(makeCfg(workspace), 'src');
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.path).toBe('src/index.ts');
  });

  it('includes hidden files (starting with dot)', async () => {
    writeFileSync(join(workspace, '.env'), 'SECRET=yes');

    const result = await listDir(makeCfg(workspace), '');
    const names = result.entries.map(e => e.name);
    expect(names).toContain('.env');
  });

  it('excludes node_modules and other excluded dirs', async () => {
    mkdirSync(join(workspace, 'node_modules'));
    mkdirSync(join(workspace, '.git'));
    mkdirSync(join(workspace, 'dist'));
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'a.ts'), '');

    const result = await listDir(makeCfg(workspace), '');
    const names = result.entries.map(e => e.name);
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.git');
    expect(names).not.toContain('dist');
    expect(names).toContain('src');
  });

  it('throws ENOENT for missing path', async () => {
    await expect(listDir(makeCfg(workspace), 'nonexistent')).rejects.toThrow(FsApiError);
    await expect(listDir(makeCfg(workspace), 'nonexistent')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws ENOTDIR when listing a file', async () => {
    writeFileSync(join(workspace, 'myfile.txt'), 'content');
    await expect(listDir(makeCfg(workspace), 'myfile.txt')).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('rejects path traversal with ../', async () => {
    await expect(listDir(makeCfg(workspace), '../')).rejects.toMatchObject({ code: 'EACCES' });
    await expect(listDir(makeCfg(workspace), '../../etc/passwd')).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('rejects absolute paths', async () => {
    await expect(listDir(makeCfg(workspace), '/etc')).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('rejects symlinks pointing outside workspace', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'outside-'));
    try {
      symlinkSync(outsideDir, join(workspace, 'evil-link'));
      await expect(listDir(makeCfg(workspace), 'evil-link')).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// ─── readFile ─────────────────────────────────────────────────────────────

describe('readFile', () => {
  it('reads UTF-8 content correctly', async () => {
    writeFileSync(join(workspace, 'hello.txt'), 'Hello, World!');
    const result = await readFile(makeCfg(workspace), 'hello.txt');
    expect(result.content).toBe('Hello, World!');
    expect(result.path).toBe('hello.txt');
    expect(result.size).toBe(13);
  });

  it('throws EISDIR when reading a directory', async () => {
    mkdirSync(join(workspace, 'adir'));
    await expect(readFile(makeCfg(workspace), 'adir')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('throws ENOENT for missing file', async () => {
    await expect(readFile(makeCfg(workspace), 'ghost.txt')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws E2BIG when file exceeds maxFileSize', async () => {
    writeFileSync(join(workspace, 'big.txt'), 'x'.repeat(100));
    await expect(readFile(makeCfg(workspace, 50), 'big.txt')).rejects.toMatchObject({ code: 'E2BIG' });
  });

  it('rejects path traversal', async () => {
    await expect(readFile(makeCfg(workspace), '../etc/passwd')).rejects.toMatchObject({ code: 'EACCES' });
  });
});

// ─── writeFile ────────────────────────────────────────────────────────────

describe('writeFile', () => {
  it('creates file and returns path and size', async () => {
    const result = await writeFile(makeCfg(workspace), 'newfile.txt', 'hello');
    expect(result.path).toBe('newfile.txt');
    expect(result.size).toBeGreaterThan(0);
  });

  it('creates nested parent directories', async () => {
    await writeFile(makeCfg(workspace), 'a/b/c/deep.txt', 'deep content');
    const readResult = await readFile(makeCfg(workspace), 'a/b/c/deep.txt');
    expect(readResult.content).toBe('deep content');
  });

  it('round-trips: writeFile then readFile returns same content', async () => {
    const content = 'round trip test 🚀';
    await writeFile(makeCfg(workspace), 'rt.txt', content);
    const result = await readFile(makeCfg(workspace), 'rt.txt');
    expect(result.content).toBe(content);
  });

  it('rejects path traversal', async () => {
    await expect(writeFile(makeCfg(workspace), '../evil.txt', 'bad')).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('rejects content exceeding maxFileSize', async () => {
    const bigContent = 'x'.repeat(200);
    await expect(writeFile(makeCfg(workspace, 100), 'too-big.txt', bigContent)).rejects.toMatchObject({ code: 'E2BIG' });
  });

  it('rejects empty relPath', async () => {
    await expect(writeFile(makeCfg(workspace), '', 'content')).rejects.toMatchObject({ code: 'EINVAL' });
  });
});

// ─── searchFiles ──────────────────────────────────────────────────────────

describe('searchFiles', () => {
  it('finds hits with correct line, column, and preview', async () => {
    writeFileSync(join(workspace, 'code.ts'), 'const foo = 1;\nconst bar = foo + 2;\n');

    const result = await searchFiles(makeCfg(workspace), 'foo');
    expect(result.query).toBe('foo');
    expect(result.hits.length).toBeGreaterThanOrEqual(2);

    const firstHit = result.hits[0]!;
    expect(firstHit.path).toBe('code.ts');
    expect(firstHit.line).toBe(1);
    expect(firstHit.column).toBe(7); // "const foo" → index 6, column 7
    expect(firstHit.preview).toContain('foo');
  });

  it('searches in subdirectories recursively', async () => {
    mkdirSync(join(workspace, 'src'));
    writeFileSync(join(workspace, 'src', 'util.ts'), 'export function findMe() {}');

    const result = await searchFiles(makeCfg(workspace), 'findMe');
    expect(result.hits.some(h => h.path === 'src/util.ts')).toBe(true);
  });

  it('skips binary files', async () => {
    // Write a buffer with a NULL byte
    const binaryBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x61, 0x62, 0x63]);
    const { writeFileSync: wfs } = await import('fs');
    wfs(join(workspace, 'image.png'), binaryBuf);

    const result = await searchFiles(makeCfg(workspace), 'abc');
    const paths = result.hits.map(h => h.path);
    expect(paths).not.toContain('image.png');
  });

  it('skips excluded directories (node_modules, .git, etc.)', async () => {
    mkdirSync(join(workspace, 'node_modules'));
    writeFileSync(join(workspace, 'node_modules', 'dep.js'), 'const needle = 1;');
    writeFileSync(join(workspace, 'real.js'), 'const needle = 2;');

    const result = await searchFiles(makeCfg(workspace), 'needle');
    const paths = result.hits.map(h => h.path);
    expect(paths).not.toContain('node_modules/dep.js');
    expect(paths).toContain('real.js');
  });

  it('respects maxHits and sets truncated: true when exceeded', async () => {
    // Write a file with many matches
    const lines = Array.from({ length: 50 }, (_, i) => `const x${i} = "match";`).join('\n');
    writeFileSync(join(workspace, 'many.ts'), lines);

    const result = await searchFiles(makeCfg(workspace), 'match', { maxHits: 5 });
    expect(result.hits.length).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('returns truncated: false when hits are within limit', async () => {
    writeFileSync(join(workspace, 'few.ts'), 'const a = "needle";\nconst b = 1;\n');

    const result = await searchFiles(makeCfg(workspace), 'needle');
    expect(result.truncated).toBe(false);
    expect(result.hits.length).toBe(1);
  });

  it('throws EINVAL for empty query', async () => {
    await expect(searchFiles(makeCfg(workspace), '')).rejects.toMatchObject({ code: 'EINVAL' });
  });

  it('throws ENOENT when relPath does not exist', async () => {
    await expect(searchFiles(makeCfg(workspace), 'x', { relPath: 'ghost/' })).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('can search within a sub-directory (relPath option)', async () => {
    mkdirSync(join(workspace, 'sub'));
    writeFileSync(join(workspace, 'sub', 'target.ts'), 'const target = true;');
    writeFileSync(join(workspace, 'root.ts'), 'const target = false;');

    const result = await searchFiles(makeCfg(workspace), 'target', { relPath: 'sub' });
    expect(result.hits.every(h => h.path.startsWith('sub/'))).toBe(true);
  });
});

// @vitest-environment node
/**
 * Unit tests for runtime/git/api.ts
 *
 * Each test creates a fresh tmp git repo, performs setup, then asserts behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import {
  gitStatus,
  gitDiff,
  gitFileContent,
  gitStage,
  gitUnstage,
  gitCommit,
  gitLog,
  gitBlame,
  validateRelPath,
} from '../api.js';

const execFileAsync = promisify(execFile);

// ─── Helpers ───────────────────────────────────────────────────────────────

async function initRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@pyrfor.test'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Pyrfor Test'], { cwd: dir });
}

async function gitAdd(dir: string, ...files: string[]): Promise<void> {
  await execFileAsync('git', ['add', '--', ...files], { cwd: dir });
}

async function gitRawCommit(dir: string, msg: string): Promise<void> {
  await execFileAsync('git', ['commit', '-m', msg], { cwd: dir });
}

let tmpDir = '';

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), 'pyrfor-git-test-'));
  await initRepo(tmpDir);
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ─── validateRelPath ────────────────────────────────────────────────────────

describe('validateRelPath', () => {
  it('accepts simple relative paths', () => {
    expect(() => validateRelPath('src/index.ts')).not.toThrow();
    expect(() => validateRelPath('file.txt')).not.toThrow();
    expect(() => validateRelPath('a/b/c.js')).not.toThrow();
  });

  it('rejects empty path', () => {
    expect(() => validateRelPath('')).toThrow('must not be empty');
  });

  it('rejects absolute paths', () => {
    expect(() => validateRelPath('/etc/passwd')).toThrow('must be relative');
  });

  it('rejects paths with ..', () => {
    expect(() => validateRelPath('../secret')).toThrow('must not contain ..');
    expect(() => validateRelPath('a/../b')).toThrow('must not contain ..');
  });
});

// ─── gitStatus ──────────────────────────────────────────────────────────────

describe('gitStatus', () => {
  it('returns clean status on empty repo (no commits)', async () => {
    const status = await gitStatus(tmpDir);
    expect(status.branch).toBeTruthy();
    expect(status.files).toEqual([]);
    expect(status.ahead).toBe(0);
    expect(status.behind).toBe(0);
  });

  it('detects untracked files', async () => {
    await writeFile(path.join(tmpDir, 'hello.txt'), 'hello');
    const status = await gitStatus(tmpDir);
    const f = status.files.find((f) => f.path === 'hello.txt');
    expect(f).toBeDefined();
    expect(f!.x).toBe('?');
    expect(f!.y).toBe('?');
  });

  it('detects staged new file', async () => {
    await writeFile(path.join(tmpDir, 'staged.txt'), 'staged content');
    await gitAdd(tmpDir, 'staged.txt');
    const status = await gitStatus(tmpDir);
    const f = status.files.find((f) => f.path === 'staged.txt');
    expect(f).toBeDefined();
    // Index status = 'A' (Added), worktree = '.' (clean)
    expect(f!.x).toBe('A');
  });

  it('detects modified tracked file', async () => {
    await writeFile(path.join(tmpDir, 'file.txt'), 'original');
    await gitAdd(tmpDir, 'file.txt');
    await gitRawCommit(tmpDir, 'initial');
    await writeFile(path.join(tmpDir, 'file.txt'), 'modified');
    const status = await gitStatus(tmpDir);
    const f = status.files.find((f) => f.path === 'file.txt');
    expect(f).toBeDefined();
    expect(f!.y).toBe('M'); // worktree modified
  });

  it('returns branch name after first commit', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'a');
    await gitAdd(tmpDir, 'a.txt');
    await gitRawCommit(tmpDir, 'first');
    const status = await gitStatus(tmpDir);
    // Branch name varies (main/master), just ensure non-empty
    expect(status.branch.length).toBeGreaterThan(0);
  });

  it('throws on non-absolute workspace', async () => {
    await expect(gitStatus('relative/path')).rejects.toThrow('absolute');
  });

  it('throws on non-git directory', async () => {
    const nonGit = await mkdtemp(path.join(tmpdir(), 'pyrfor-nongit-'));
    try {
      await expect(gitStatus(nonGit)).rejects.toThrow('not a git repository');
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});

// ─── gitDiff ────────────────────────────────────────────────────────────────

describe('gitDiff', () => {
  it('returns unified diff for modified working tree file', async () => {
    await writeFile(path.join(tmpDir, 'code.ts'), 'const x = 1;');
    await gitAdd(tmpDir, 'code.ts');
    await gitRawCommit(tmpDir, 'add code.ts');
    await writeFile(path.join(tmpDir, 'code.ts'), 'const x = 2;');
    const diff = await gitDiff(tmpDir, 'code.ts');
    expect(diff).toContain('-const x = 1;');
    expect(diff).toContain('+const x = 2;');
  });

  it('returns staged diff', async () => {
    await writeFile(path.join(tmpDir, 'code.ts'), 'const x = 1;');
    await gitAdd(tmpDir, 'code.ts');
    await gitRawCommit(tmpDir, 'add code.ts');
    await writeFile(path.join(tmpDir, 'code.ts'), 'const x = 99;');
    await gitAdd(tmpDir, 'code.ts');
    const diff = await gitDiff(tmpDir, 'code.ts', true);
    expect(diff).toContain('-const x = 1;');
    expect(diff).toContain('+const x = 99;');
  });

  it('returns empty string for unmodified file', async () => {
    await writeFile(path.join(tmpDir, 'clean.ts'), 'unchanged');
    await gitAdd(tmpDir, 'clean.ts');
    await gitRawCommit(tmpDir, 'add clean.ts');
    const diff = await gitDiff(tmpDir, 'clean.ts');
    expect(diff).toBe('');
  });
});

// ─── gitFileContent ──────────────────────────────────────────────────────────

describe('gitFileContent', () => {
  it('returns HEAD content of committed file', async () => {
    await writeFile(path.join(tmpDir, 'readme.md'), '# Hello');
    await gitAdd(tmpDir, 'readme.md');
    await gitRawCommit(tmpDir, 'add readme');
    const content = await gitFileContent(tmpDir, 'readme.md');
    expect(content).toBe('# Hello');
  });

  it('returns empty string for new (untracked) file', async () => {
    await writeFile(path.join(tmpDir, 'new.ts'), 'new content');
    const content = await gitFileContent(tmpDir, 'new.ts');
    expect(content).toBe('');
  });

  it('throws for invalid ref characters', async () => {
    await expect(gitFileContent(tmpDir, 'file.ts', 'HEAD; rm -rf')).rejects.toThrow('invalid ref');
  });
});

// ─── gitStage / gitUnstage ───────────────────────────────────────────────────

describe('gitStage and gitUnstage', () => {
  it('stages a file', async () => {
    await writeFile(path.join(tmpDir, 'stage-me.txt'), 'content');
    await gitStage(tmpDir, ['stage-me.txt']);
    const status = await gitStatus(tmpDir);
    const f = status.files.find((f) => f.path === 'stage-me.txt');
    expect(f).toBeDefined();
    expect(f!.x).toBe('A');
  });

  it('unstages a staged file', async () => {
    await writeFile(path.join(tmpDir, 'unstage-me.txt'), 'content');
    await gitStage(tmpDir, ['unstage-me.txt']);
    await gitUnstage(tmpDir, ['unstage-me.txt']);
    const status = await gitStatus(tmpDir);
    const f = status.files.find((f) => f.path === 'unstage-me.txt');
    // After unstage, should be untracked
    expect(f?.x).toBe('?');
  });

  it('throws for empty paths array in stage', async () => {
    await expect(gitStage(tmpDir, [])).rejects.toThrow('non-empty array');
  });

  it('throws for path with .. in stage', async () => {
    await expect(gitStage(tmpDir, ['../evil'])).rejects.toThrow('must not contain ..');
  });
});

// ─── gitCommit ──────────────────────────────────────────────────────────────

describe('gitCommit', () => {
  it('creates a commit and returns SHA', async () => {
    await writeFile(path.join(tmpDir, 'commit-me.txt'), 'committed');
    await gitStage(tmpDir, ['commit-me.txt']);
    const result = await gitCommit(tmpDir, 'my test commit');
    expect(result.sha).toMatch(/^[0-9a-f]+$/);
    expect(result.sha.length).toBeGreaterThan(4);
  });

  it('rejects empty commit message', async () => {
    await expect(gitCommit(tmpDir, '')).rejects.toThrow('must not be empty');
    await expect(gitCommit(tmpDir, '   ')).rejects.toThrow('must not be empty');
  });
});

// ─── gitLog ─────────────────────────────────────────────────────────────────

describe('gitLog', () => {
  it('returns empty array on repo with no commits', async () => {
    const log = await gitLog(tmpDir);
    expect(log).toEqual([]);
  });

  it('returns commit entries after commits', async () => {
    await writeFile(path.join(tmpDir, 'a.txt'), 'a');
    await gitAdd(tmpDir, 'a.txt');
    await gitRawCommit(tmpDir, 'first commit');

    await writeFile(path.join(tmpDir, 'b.txt'), 'b');
    await gitAdd(tmpDir, 'b.txt');
    await gitRawCommit(tmpDir, 'second commit');

    const log = await gitLog(tmpDir, 10);
    expect(log.length).toBe(2);
    expect(log[0]!.subject).toBe('second commit');
    expect(log[0]!.author).toBe('Pyrfor Test');
    expect(log[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(log[0]!.dateUnix).toBeGreaterThan(0);
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await writeFile(path.join(tmpDir, `f${i}.txt`), `content ${i}`);
      await gitAdd(tmpDir, `f${i}.txt`);
      await gitRawCommit(tmpDir, `commit ${i}`);
    }
    const log = await gitLog(tmpDir, 3);
    expect(log.length).toBe(3);
  });
});

// ─── gitBlame ───────────────────────────────────────────────────────────────

describe('gitBlame', () => {
  it('returns blame entries for a committed file', async () => {
    await writeFile(path.join(tmpDir, 'blame.ts'), 'line one\nline two\nline three\n');
    await gitAdd(tmpDir, 'blame.ts');
    await gitRawCommit(tmpDir, 'add blame.ts');

    const blame = await gitBlame(tmpDir, 'blame.ts');
    expect(blame.length).toBe(3);
    expect(blame[0]!.line).toBe(1);
    expect(blame[0]!.content).toBe('line one');
    expect(blame[0]!.author).toBe('Pyrfor Test');
    expect(blame[0]!.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});

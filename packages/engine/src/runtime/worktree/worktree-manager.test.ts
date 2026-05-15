// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeWorktreeManager } from './worktree-manager';
import { initTestGitRepo, removeTestGitRepo } from '../../test-utils/git-repo.js';

const execFileAsync = promisify(execFile);

let repoDir = '';
let repoGitDir = '';
let worktreeRoot = '';
let manager: RuntimeWorktreeManager;

describe('RuntimeWorktreeManager', () => {
  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-worktree-manager-'));
    worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-worktree-root-'));
    const { gitDir } = await initTestGitRepo(repoDir, { branch: 'main' });
    repoGitDir = gitDir;
    await writeFile(path.join(repoDir, 'note.txt'), 'base\n', 'utf8');
    await execFileAsync('git', ['add', '--', 'note.txt'], { cwd: repoDir });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repoDir });
    manager = new RuntimeWorktreeManager({
      getWorkspacePath: () => repoDir,
      rootDir: path.join(worktreeRoot, 'managed'),
    });
  });

  afterEach(async () => {
    await removeTestGitRepo(repoDir, repoGitDir);
    await rm(worktreeRoot, { recursive: true, force: true });
    repoDir = '';
    repoGitDir = '';
  });

  it('creates isolated per-run git worktrees and deletes them during cleanup', async () => {
    const worktree = await manager.createForRun('run-1');

    expect(worktree.branch).toMatch(/^pyrfor\/governed\//);
    await writeFile(path.join(worktree.path, 'note.txt'), 'worker\n', 'utf8');

    expect(await readFile(path.join(repoDir, 'note.txt'), 'utf8')).toBe('base\n');
    expect(await readFile(path.join(worktree.path, 'note.txt'), 'utf8')).toBe('worker\n');

    await manager.cleanupForRun('run-1');

    await expect(stat(worktree.path)).rejects.toThrow();
    expect((await execFileAsync('git', ['branch', '--list', worktree.branch], { cwd: repoDir })).stdout.trim()).toBe('');
  });

  it('cleans orphaned managed worktrees while retaining requested runs', async () => {
    const keep = await manager.createForRun('run-keep');
    const remove = await manager.createForRun('run-remove');

    const removed = await manager.cleanupOrphans(['run-keep']);

    expect(removed).toContain(remove.id);
    await expect(stat(remove.path)).rejects.toThrow();
    expect((await stat(keep.path)).isDirectory()).toBe(true);
  });

  it('creates parallel isolated worktrees for subagent-style run ids', async () => {
    const wts = await Promise.all([
      manager.createForRun('subagent:task-a'),
      manager.createForRun('subagent:task-b'),
      manager.createForRun('subagent:task-c'),
    ]);
    const paths = new Set(wts.map((w) => w.path));
    expect(paths.size).toBe(3);

    await writeFile(path.join(wts[0]!.path, 'a-only.txt'), 'A', 'utf8');
    await writeFile(path.join(wts[1]!.path, 'b-only.txt'), 'B', 'utf8');
    await writeFile(path.join(wts[2]!.path, 'c-only.txt'), 'C', 'utf8');

    expect(await readFile(path.join(wts[0]!.path, 'a-only.txt'), 'utf8')).toBe('A');
    await expect(readFile(path.join(wts[1]!.path, 'a-only.txt'), 'utf8')).rejects.toThrow();

    await manager.cleanupForRun('subagent:task-a');
    await manager.cleanupForRun('subagent:task-b');
    await manager.cleanupForRun('subagent:task-c');
  });
});

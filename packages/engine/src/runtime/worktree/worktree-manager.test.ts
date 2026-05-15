// @vitest-environment node

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeWorktreeManager } from './worktree-manager';

const execFileAsync = promisify(execFile);

let repoDir = '';
let worktreeRoot = '';
let manager: RuntimeWorktreeManager;

async function initRepo(dir: string): Promise<void> {
  await execFileAsync('git', ['init', '--initial-branch=main'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.email', 'test@pyrfor.test'], { cwd: dir });
  await execFileAsync('git', ['config', 'user.name', 'Pyrfor Test'], { cwd: dir });
  await writeFile(path.join(dir, 'note.txt'), 'base\n', 'utf8');
  await execFileAsync('git', ['add', '--', 'note.txt'], { cwd: dir });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: dir });
}

describe('RuntimeWorktreeManager', () => {
  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-worktree-manager-'));
    worktreeRoot = await mkdtemp(path.join(os.tmpdir(), 'pyrfor-worktree-root-'));
    await initRepo(repoDir);
    manager = new RuntimeWorktreeManager({
      getWorkspacePath: () => repoDir,
      rootDir: path.join(worktreeRoot, 'managed'),
    });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(worktreeRoot, { recursive: true, force: true });
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
});

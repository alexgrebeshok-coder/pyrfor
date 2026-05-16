/**
 * Sandbox-safe git repo bootstrap for unit tests.
 *
 * Cursor/agent sandboxes block creating `.git/hooks/` under a normal worktree.
 * Bare init + `git init --separate-git-dir` avoids that path while keeping a
 * standard working tree for git CLI wrappers under test.
 */

import { execFile, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface InitTestGitRepoOptions {
  branch?: string;
  userEmail?: string;
  userName?: string;
}

export function testGitBareDir(workDir: string): string {
  return path.join(path.dirname(workDir), `${path.basename(workDir)}.git`);
}

/** Initialize `workDir` as a git worktree; returns bare dir path for cleanup. */
export async function initTestGitRepo(
  workDir: string,
  opts: InitTestGitRepoOptions = {},
): Promise<{ gitDir: string }> {
  const branch = opts.branch ?? 'main';
  const gitDir = testGitBareDir(workDir);
  const userEmail = opts.userEmail ?? 'test@pyrfor.test';
  const userName = opts.userName ?? 'Pyrfor Test';

  await mkdir(workDir, { recursive: true });
  await execFileAsync('git', ['init', '--bare', gitDir]);
  await execFileAsync('git', ['-C', gitDir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  await execFileAsync('git', ['init', '--separate-git-dir', gitDir, '-b', branch], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.email', userEmail], { cwd: workDir });
  await execFileAsync('git', ['config', 'user.name', userName], { cwd: workDir });

  return { gitDir };
}

export async function removeTestGitRepo(workDir: string, gitDir?: string): Promise<void> {
  if (!workDir) return;
  const bare = gitDir ?? testGitBareDir(workDir);
  await rm(workDir, { recursive: true, force: true });
  await rm(bare, { recursive: true, force: true });
}

/** Synchronous variant for tests that already use execFileSync. */
export function initTestGitRepoSync(
  workDir: string,
  opts: InitTestGitRepoOptions = {},
): string {
  const branch = opts.branch ?? 'main';
  const gitDir = testGitBareDir(workDir);
  const userEmail = opts.userEmail ?? 'test@pyrfor.test';
  const userName = opts.userName ?? 'Pyrfor Test';

  execFileSync('git', ['init', '--bare', gitDir], { stdio: 'ignore' });
  execFileSync('git', ['-C', gitDir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });
  execFileSync('git', ['init', '--separate-git-dir', gitDir, '-b', branch], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', userEmail], { cwd: workDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', userName], { cwd: workDir, stdio: 'ignore' });
  return gitDir;
}

export function removeTestGitRepoSync(workDir: string, gitDir?: string): void {
  if (!workDir) return;
  const bare = gitDir ?? testGitBareDir(workDir);
  rmSync(workDir, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
}

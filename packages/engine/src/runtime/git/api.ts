/**
 * Git CLI wrapper for the Pyrfor IDE sidecar.
 *
 * Uses node:child_process.execFile (NOT shell exec) — no shell injection risk.
 * All public functions take `workspace: string` as first parameter.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const execFileAsync = promisify(execFile);

// ─── Public types ──────────────────────────────────────────────────────────

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  files: Array<{ path: string; x: string; y: string }>;
}

export interface GitLogEntry {
  sha: string;
  author: string;
  dateUnix: number;
  subject: string;
}

export interface GitRemoteResult {
  name: string;
  url: string;
}

export interface GitBlameEntry {
  sha: string;
  author: string;
  line: number;
  content: string;
}

export interface GitWorktreeRemoveOptions {
  force?: boolean;
  branch?: string;
  prune?: boolean;
}

// ─── Validation helpers ────────────────────────────────────────────────────

export async function validateWorkspace(workspace: string): Promise<void> {
  if (!path.isAbsolute(workspace)) {
    throw new Error(`workspace must be an absolute path: ${workspace}`);
  }
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(workspace);
  } catch {
    throw new Error(`workspace does not exist: ${workspace}`);
  }
  if (!s.isDirectory()) {
    throw new Error(`workspace is not a directory: ${workspace}`);
  }
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspace });
  } catch {
    throw new Error(`workspace is not a git repository: ${workspace}`);
  }
}

export function validateRelPath(p: string): void {
  if (!p) throw new Error('path must not be empty');
  if (path.isAbsolute(p)) throw new Error(`path must be relative: ${p}`);
  // Reject any path component that is '..'
  const parts = p.split('/');
  for (const part of parts) {
    if (part === '..') throw new Error(`path must not contain ..: ${p}`);
  }
}

function validateBranch(branch: string): void {
  if (!branch || !branch.trim()) {
    throw new Error('branch must not be empty');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/')) {
    throw new Error(`invalid branch: ${branch}`);
  }
}

function validateAbsoluteDir(label: string, dir: string): void {
  if (!path.isAbsolute(dir)) {
    throw new Error(`${label} must be an absolute path: ${dir}`);
  }
}

// ─── Porcelain v2 parser ───────────────────────────────────────────────────

/**
 * Parse `git status --porcelain=v2 --branch -z` output.
 *
 * With -z, each entry is NUL-terminated. Rename/copy entries (type '2')
 * produce two consecutive NUL-separated fields: the entry itself and the
 * original path — so we skip the origPath chunk after processing a '2 ' entry.
 */
function parsePortcelainV2(raw: string): GitStatusResult {
  const result: GitStatusResult = { branch: 'HEAD', ahead: 0, behind: 0, files: [] };

  const chunks = raw.split('\0');
  let i = 0;
  while (i < chunks.length) {
    const chunk = chunks[i++]!;
    if (!chunk) continue;

    if (chunk.startsWith('# branch.head ')) {
      result.branch = chunk.slice('# branch.head '.length).trim();
    } else if (chunk.startsWith('# branch.ab ')) {
      const m = chunk.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        result.ahead = parseInt(m[1]!, 10);
        result.behind = parseInt(m[2]!, 10);
      }
    } else if (chunk.startsWith('1 ')) {
      // 1 XY sub mH mI mW hH hI path
      const fields = chunk.split(' ');
      const xy = fields[1] ?? '..';
      const filePath = fields.slice(8).join(' ');
      result.files.push({ path: filePath, x: xy[0] ?? '.', y: xy[1] ?? '.' });
    } else if (chunk.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path — followed by origPath as next chunk
      const fields = chunk.split(' ');
      const xy = fields[1] ?? '..';
      const filePath = fields.slice(9).join(' ');
      result.files.push({ path: filePath, x: xy[0] ?? '.', y: xy[1] ?? '.' });
      i++; // skip the orig-path chunk
    } else if (chunk.startsWith('u ')) {
      // u xy sub m1 m2 m3 mW h1 h2 h3 path  (unmerged)
      const fields = chunk.split(' ');
      const xy = fields[1] ?? '..';
      const filePath = fields.slice(10).join(' ');
      result.files.push({ path: filePath, x: xy[0] ?? 'U', y: xy[1] ?? 'U' });
    } else if (chunk.startsWith('? ')) {
      // Untracked file
      const filePath = chunk.slice(2);
      result.files.push({ path: filePath, x: '?', y: '?' });
    }
    // '#' headers we don't need (branch.oid, branch.upstream) are silently skipped
  }

  return result;
}

// ─── Blame parser ──────────────────────────────────────────────────────────

function parseBlame(raw: string): GitBlameEntry[] {
  const lines = raw.split('\n');
  const result: GitBlameEntry[] = [];
  const commitAuthors = new Map<string, string>(); // sha → author name

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Each blame hunk starts with: <40-char sha> <orig-lineno> <final-lineno> [<group-size>]
    const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
    if (headerMatch) {
      const sha = headerMatch[1]!;
      const finalLine = parseInt(headerMatch[2]!, 10);
      i++;
      let author = commitAuthors.get(sha) ?? '';
      while (i < lines.length && !lines[i]!.startsWith('\t')) {
        const meta = lines[i]!;
        if (meta.startsWith('author ') && !meta.startsWith('author-')) {
          author = meta.slice(7);
          commitAuthors.set(sha, author);
        }
        i++;
      }
      if (!author) author = commitAuthors.get(sha) ?? 'Unknown';
      const content = lines[i]?.startsWith('\t') ? lines[i]!.slice(1) : '';
      result.push({ sha, author, line: finalLine, content });
      i++;
    } else {
      i++;
    }
  }

  return result;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function gitStatus(workspace: string): Promise<GitStatusResult> {
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync(
    'git',
    ['status', '--porcelain=v2', '--branch', '-z'],
    { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
  );
  return parsePortcelainV2(stdout);
}

export async function gitHeadSha(workspace: string): Promise<string> {
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
    cwd: workspace,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

export async function gitRepoRoot(workspace: string): Promise<string> {
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
    cwd: workspace,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

export async function gitCurrentBranch(workspace: string): Promise<string> {
  await validateWorkspace(workspace);
  try {
    const { stdout } = await execFileAsync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      cwd: workspace,
      maxBuffer: 1024 * 1024,
    });
    const branch = stdout.trim();
    if (!branch) {
      throw new Error(`workspace is on a detached HEAD: ${workspace}`);
    }
    return branch;
  } catch (error) {
    const err = error as { stderr?: string };
    const stderr = typeof err.stderr === 'string' ? err.stderr.trim() : '';
    if (stderr.includes('not a symbolic ref') || stderr.includes('HEAD')) {
      throw new Error(`workspace is on a detached HEAD: ${workspace}`);
    }
    throw error;
  }
}

export async function gitRemote(workspace: string, remote = 'origin'): Promise<GitRemoteResult | null> {
  await validateWorkspace(workspace);
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', remote], {
      cwd: workspace,
      maxBuffer: 1024 * 1024,
    });
    const url = stdout.trim();
    return url ? { name: remote, url } : null;
  } catch {
    return null;
  }
}

export async function gitPushHeadToBranch(
  workspace: string,
  remote: string,
  branch: string,
): Promise<void> {
  if (!/^[A-Za-z0-9._/-]+$/.test(remote) || remote.includes('..') || remote.startsWith('-')) {
    throw new Error(`invalid remote: ${remote}`);
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.includes('..') || branch.startsWith('-') || branch.endsWith('/')) {
    throw new Error(`invalid branch: ${branch}`);
  }
  await validateWorkspace(workspace);
  await execFileAsync('git', ['push', remote, `HEAD:refs/heads/${branch}`], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function gitWorktreeAdd(
  workspace: string,
  worktreePath: string,
  branch: string,
  ref = 'HEAD',
): Promise<void> {
  validateAbsoluteDir('worktreePath', worktreePath);
  validateBranch(branch);
  if (!/^[a-zA-Z0-9_.^~:/\-]+$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }
  await validateWorkspace(workspace);
  await mkdir(path.dirname(worktreePath), { recursive: true });
  await execFileAsync('git', ['worktree', 'add', '--force', '-b', branch, worktreePath, ref], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function gitWorktreePrune(workspace: string): Promise<void> {
  await validateWorkspace(workspace);
  await execFileAsync('git', ['worktree', 'prune', '--expire', 'now'], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function gitWorktreeRemove(
  workspace: string,
  worktreePath: string,
  options: GitWorktreeRemoveOptions = {},
): Promise<void> {
  validateAbsoluteDir('worktreePath', worktreePath);
  if (options.branch) {
    validateBranch(options.branch);
  }
  await validateWorkspace(workspace);
  await execFileAsync(
    'git',
    ['worktree', 'remove', ...(options.force === false ? [] : ['--force']), worktreePath],
    { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
  );
  if (options.branch) {
    await execFileAsync('git', ['branch', '-D', options.branch], {
      cwd: workspace,
      maxBuffer: 10 * 1024 * 1024,
    });
  }
  if (options.prune !== false) {
    await gitWorktreePrune(workspace);
  }
}

export async function gitDiff(
  workspace: string,
  filePath: string,
  staged = false,
): Promise<string> {
  validateRelPath(filePath);
  await validateWorkspace(workspace);
  const args = ['diff', '--no-color'];
  if (staged) args.push('--cached');
  args.push('--', filePath);
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: workspace,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    // execFile rejects on non-zero exit — diff can exit 1 when there are diffs
    const e = err as { stdout?: string; code?: number };
    if (typeof e.stdout === 'string') return e.stdout;
    throw err;
  }
}

export async function gitFileContent(
  workspace: string,
  filePath: string,
  ref = 'HEAD',
): Promise<string> {
  validateRelPath(filePath);
  await validateWorkspace(workspace);
  // Validate ref is safe (alphanumeric, dots, slashes, dashes, tildes, carets, colons)
  if (!/^[a-zA-Z0-9_.^~:/\-]+$/.test(ref)) {
    throw new Error(`invalid ref: ${ref}`);
  }
  try {
    const { stdout } = await execFileAsync('git', ['show', `${ref}:${filePath}`], {
      cwd: workspace,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    });
    return stdout;
  } catch {
    // File doesn't exist in this ref (e.g. new untracked file)
    return '';
  }
}

export async function gitStage(workspace: string, paths: string[]): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }
  paths.forEach(validateRelPath);
  await validateWorkspace(workspace);
  await execFileAsync('git', ['add', '--', ...paths], { cwd: workspace });
}

export async function gitUnstage(workspace: string, paths: string[]): Promise<void> {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('paths must be a non-empty array');
  }
  paths.forEach(validateRelPath);
  await validateWorkspace(workspace);
  // git restore --staged requires git >= 2.23 (available since 2019)
  try {
    await execFileAsync('git', ['restore', '--staged', '--', ...paths], { cwd: workspace });
  } catch {
    // Fallback for repos with no commits yet or older git
    await execFileAsync('git', ['reset', 'HEAD', '--', ...paths], { cwd: workspace });
  }
}

export async function gitCommit(
  workspace: string,
  message: string,
): Promise<{ sha: string }> {
  if (!message || !message.trim()) {
    throw new Error('commit message must not be empty');
  }
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync('git', ['commit', '-m', message], {
    cwd: workspace,
  });
  // Parse SHA from output like: "[main (root-commit) abc1234] message"
  const shaMatch = stdout.match(/\[[\w/.-]+(?:\s+\([^)]+\))?\s+([0-9a-f]+)\]/);
  const sha = shaMatch?.[1] ?? 'unknown';
  return { sha };
}

export async function gitLog(workspace: string, limit = 50): Promise<GitLogEntry[]> {
  await validateWorkspace(workspace);
  const n = Math.min(Math.max(1, limit), 1000);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '--pretty=format:%H%x09%an%x09%at%x09%s', `-n`, String(n)],
      { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
    );
    if (!stdout.trim()) return [];
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('\t');
        return {
          sha: parts[0] ?? '',
          author: parts[1] ?? '',
          dateUnix: parseInt(parts[2] ?? '0', 10),
          subject: parts[3] ?? '',
        };
      });
  } catch {
    return [];
  }
}

export async function gitBlame(workspace: string, filePath: string): Promise<GitBlameEntry[]> {
  validateRelPath(filePath);
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync(
    'git',
    ['blame', '--porcelain', '--', filePath],
    { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
  );
  return parseBlame(stdout);
}

// ─── Merge / cherry-pick (structured results) ───────────────────────────────

export type GitMergeOk = { ok: true; mergeCommitSha?: string };
export type GitMergeConflict = {
  ok: false;
  kind: 'conflict';
  conflictPaths: string[];
  stderr?: string;
};
export type GitMergeError = { ok: false; kind: 'error'; message: string };
export type GitMergeResult = GitMergeOk | GitMergeConflict | GitMergeError;

export type GitCherryPickOk = { ok: true; headSha?: string };
export type GitCherryPickConflict = {
  ok: false;
  kind: 'conflict';
  conflictPaths: string[];
  stderr?: string;
};
export type GitCherryPickError = { ok: false; kind: 'error'; message: string };
export type GitCherryPickResult = GitCherryPickOk | GitCherryPickConflict | GitCherryPickError;

export async function gitUnmergedPaths(workspace: string): Promise<string[]> {
  await validateWorkspace(workspace);
  const { stdout } = await execFileAsync(
    'git',
    ['diff', '--name-only', '--diff-filter=U'],
    { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function gitMergeAbort(workspace: string): Promise<void> {
  await validateWorkspace(workspace);
  await execFileAsync('git', ['merge', '--abort'], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function gitCherryPickAbort(workspace: string): Promise<void> {
  await validateWorkspace(workspace);
  await execFileAsync('git', ['cherry-pick', '--abort'], {
    cwd: workspace,
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Merge `branch` into the current HEAD of `workspace`.
 * On conflict: records unmerged paths, runs `merge --abort`, and returns `kind: 'conflict'`.
 */
export async function gitMergeBranch(
  workspace: string,
  branch: string,
  options: { noFf?: boolean } = {},
): Promise<GitMergeResult> {
  validateBranch(branch);
  await validateWorkspace(workspace);
  const extra = options.noFf ? ['--no-ff'] : [];
  try {
    await execFileAsync(
      'git',
      ['merge', '--no-edit', ...extra, branch],
      { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
    );
    let mergeCommitSha: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: workspace,
        maxBuffer: 1024 * 1024,
      });
      mergeCommitSha = stdout.trim();
    } catch {
      mergeCommitSha = undefined;
    }
    return { ok: true, mergeCommitSha };
  } catch (error: unknown) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? '')
        : '';
    let conflictPaths: string[] = [];
    try {
      conflictPaths = await gitUnmergedPaths(workspace);
    } catch {
      conflictPaths = [];
    }
    const looksLikeConflict =
      conflictPaths.length > 0 ||
      /conflict/i.test(stderr) ||
      /Automatic merge failed/i.test(stderr);

    if (looksLikeConflict) {
      try {
        await gitMergeAbort(workspace);
      } catch {
        // best-effort: leave repo as-is if abort is not applicable
      }
      return {
        ok: false,
        kind: 'conflict',
        conflictPaths,
        stderr: stderr.trim() || undefined,
      };
    }

    return {
      ok: false,
      kind: 'error',
      message: stderr.trim() || (error instanceof Error ? error.message : String(error)),
    };
  }
}

/**
 * Cherry-pick one or more commits onto the current HEAD of `workspace`.
 * On conflict: records unmerged paths, runs `cherry-pick --abort`, and returns `kind: 'conflict'`.
 */
export async function gitCherryPickCommits(
  workspace: string,
  commits: string[],
): Promise<GitCherryPickResult> {
  if (!Array.isArray(commits) || commits.length === 0) {
    return { ok: false, kind: 'error', message: 'commits must be a non-empty array' };
  }
  for (const sha of commits) {
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
      return { ok: false, kind: 'error', message: `invalid commit sha: ${sha}` };
    }
  }
  await validateWorkspace(workspace);
  try {
    await execFileAsync(
      'git',
      ['cherry-pick', ...commits],
      { cwd: workspace, maxBuffer: 10 * 1024 * 1024 },
    );
    let headSha: string | undefined;
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: workspace,
        maxBuffer: 1024 * 1024,
      });
      headSha = stdout.trim();
    } catch {
      headSha = undefined;
    }
    return { ok: true, headSha };
  } catch (error: unknown) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr?: Buffer | string }).stderr ?? '')
        : '';
    let conflictPaths: string[] = [];
    try {
      conflictPaths = await gitUnmergedPaths(workspace);
    } catch {
      conflictPaths = [];
    }
    const looksLikeConflict =
      conflictPaths.length > 0 ||
      /conflict/i.test(stderr) ||
      /Cherry-pick .*conflict/i.test(stderr);

    if (looksLikeConflict) {
      try {
        await gitCherryPickAbort(workspace);
      } catch {
        // ignore
      }
      return {
        ok: false,
        kind: 'conflict',
        conflictPaths,
        stderr: stderr.trim() || undefined,
      };
    }

    return {
      ok: false,
      kind: 'error',
      message: stderr.trim() || (error instanceof Error ? error.message : String(error)),
    };
  }
}

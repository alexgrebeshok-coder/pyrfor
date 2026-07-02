/**
 * Restrict git HTTP API workspaces to the configured IDE workspace root (symlink-safe).
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export class GitWorkspaceGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitWorkspaceGuardError';
  }
}

function lexicalInsideRoot(candidate: string, root: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

/**
 * Resolve and validate that `workspace` is under `workspaceRoot`.
 * Uses realpath when paths exist to prevent symlink escape (same pattern as fs-api).
 */
export async function assertGitWorkspaceAllowed(
  workspace: string,
  workspaceRoot: string,
): Promise<string> {
  if (!workspace.trim()) {
    throw new GitWorkspaceGuardError('workspace is required');
  }
  if (!path.isAbsolute(workspace)) {
    throw new GitWorkspaceGuardError('workspace must be an absolute path');
  }

  const root = path.resolve(workspaceRoot);
  const candidate = path.resolve(workspace);

  if (!lexicalInsideRoot(candidate, root)) {
    throw new GitWorkspaceGuardError(`workspace is outside allowed root: ${workspace}`);
  }

  let realRoot: string;
  try {
    realRoot = await fsp.realpath(root);
  } catch {
    realRoot = root;
  }

  let realWorkspace: string;
  try {
    realWorkspace = await fsp.realpath(candidate);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // New/uninitialized repo path — lexical check above is sufficient.
      return candidate;
    }
    throw err;
  }

  if (realWorkspace !== realRoot && !realWorkspace.startsWith(realRoot + path.sep)) {
    throw new GitWorkspaceGuardError(`workspace escapes allowed root via symlink: ${workspace}`);
  }

  return realWorkspace;
}

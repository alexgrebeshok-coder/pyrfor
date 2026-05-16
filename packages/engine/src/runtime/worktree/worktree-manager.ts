import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  gitCurrentBranch,
  gitWorktreeAdd,
  gitWorktreePrune,
  gitWorktreeRemove,
} from '../git/api';

export interface ManagedGitWorktree {
  id: string;
  branch: string;
  path: string;
  baseBranch: string;
}

export interface RuntimeWorktreeManagerOptions {
  getWorkspacePath(): string;
  rootDir: string;
}

export class RuntimeWorktreeManager {
  private readonly getWorkspacePathValue: () => string;
  private readonly rootDir: string;

  constructor(options: RuntimeWorktreeManagerOptions) {
    this.getWorkspacePathValue = options.getWorkspacePath;
    this.rootDir = options.rootDir;
  }

  async createForRun(runId: string): Promise<ManagedGitWorktree> {
    const worktree = this.describe(runId);
    const workspacePath = this.getWorkspacePathValue();
    const baseBranch = await gitCurrentBranch(workspacePath);
    await this.cleanupWorktree(worktree).catch(() => {});
    await gitWorktreeAdd(workspacePath, worktree.path, worktree.branch);
    return {
      ...worktree,
      baseBranch,
    };
  }

  async cleanupForRun(runId: string): Promise<void> {
    await this.cleanupWorktree(this.describe(runId));
  }

  async cleanupOrphans(retainRunIds: string[] = []): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.rootDir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return [];
    }

    const retained = new Set(retainRunIds.map((runId) => this.describe(runId).id));
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || retained.has(entry.name)) {
        continue;
      }
      await this.cleanupWorktree({
        id: entry.name,
        branch: `pyrfor/governed/${entry.name}`,
        path: path.join(this.rootDir, entry.name),
      });
      removed.push(entry.name);
    }
    return removed;
  }

  async cleanupAll(): Promise<string[]> {
    return this.cleanupOrphans();
  }

  describe(runId: string): Pick<ManagedGitWorktree, 'id' | 'branch' | 'path'> {
    const id = this.worktreeIdForRun(runId);
    return {
      id,
      branch: `pyrfor/governed/${id}`,
      path: path.join(this.rootDir, id),
    };
  }

  private worktreeIdForRun(runId: string): string {
    const slug = runId
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'run';
    const hash = createHash('sha256').update(runId).digest('hex').slice(0, 8);
    return `${slug}-${hash}`;
  }

  private async cleanupWorktree(worktree: Pick<ManagedGitWorktree, 'id' | 'branch' | 'path'>): Promise<void> {
    const workspacePath = this.getWorkspacePathValue();
    try {
      await gitWorktreeRemove(workspacePath, worktree.path, {
        force: true,
        branch: worktree.branch,
        prune: false,
      });
    } catch {
      // Fall through to filesystem cleanup so partial/orphaned worktrees are still removed.
    }
    await rm(worktree.path, { recursive: true, force: true });
    try {
      await gitWorktreePrune(workspacePath);
    } catch {
      // Ignore prune failures during best-effort cleanup.
    }
  }
}

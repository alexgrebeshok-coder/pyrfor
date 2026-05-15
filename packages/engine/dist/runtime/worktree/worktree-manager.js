var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { gitCurrentBranch, gitWorktreeAdd, gitWorktreePrune, gitWorktreeRemove, } from '../git/api.js';
export class RuntimeWorktreeManager {
    constructor(options) {
        this.getWorkspacePathValue = options.getWorkspacePath;
        this.rootDir = options.rootDir;
    }
    createForRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            const worktree = this.describe(runId);
            const workspacePath = this.getWorkspacePathValue();
            const baseBranch = yield gitCurrentBranch(workspacePath);
            yield this.cleanupWorktree(worktree).catch(() => { });
            yield gitWorktreeAdd(workspacePath, worktree.path, worktree.branch);
            return Object.assign(Object.assign({}, worktree), { baseBranch });
        });
    }
    cleanupForRun(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.cleanupWorktree(this.describe(runId));
        });
    }
    cleanupOrphans() {
        return __awaiter(this, arguments, void 0, function* (retainRunIds = []) {
            let entries;
            try {
                entries = yield readdir(this.rootDir, { withFileTypes: true, encoding: 'utf8' });
            }
            catch (_a) {
                return [];
            }
            const retained = new Set(retainRunIds.map((runId) => this.describe(runId).id));
            const removed = [];
            for (const entry of entries) {
                if (!entry.isDirectory() || retained.has(entry.name)) {
                    continue;
                }
                yield this.cleanupWorktree({
                    id: entry.name,
                    branch: `pyrfor/governed/${entry.name}`,
                    path: path.join(this.rootDir, entry.name),
                });
                removed.push(entry.name);
            }
            return removed;
        });
    }
    cleanupAll() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.cleanupOrphans();
        });
    }
    describe(runId) {
        const id = this.worktreeIdForRun(runId);
        return {
            id,
            branch: `pyrfor/governed/${id}`,
            path: path.join(this.rootDir, id),
        };
    }
    worktreeIdForRun(runId) {
        const slug = runId
            .toLowerCase()
            .replace(/[^a-z0-9._-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 48) || 'run';
        const hash = createHash('sha256').update(runId).digest('hex').slice(0, 8);
        return `${slug}-${hash}`;
    }
    cleanupWorktree(worktree) {
        return __awaiter(this, void 0, void 0, function* () {
            const workspacePath = this.getWorkspacePathValue();
            try {
                yield gitWorktreeRemove(workspacePath, worktree.path, {
                    force: true,
                    branch: worktree.branch,
                    prune: false,
                });
            }
            catch (_a) {
                // Fall through to filesystem cleanup so partial/orphaned worktrees are still removed.
            }
            yield rm(worktree.path, { recursive: true, force: true });
            try {
                yield gitWorktreePrune(workspacePath);
            }
            catch (_b) {
                // Ignore prune failures during best-effort cleanup.
            }
        });
    }
}

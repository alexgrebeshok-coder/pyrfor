/**
 * Sandbox-safe git repo bootstrap for unit tests.
 *
 * Cursor/agent sandboxes block creating `.git/hooks/` under a normal worktree.
 * Bare init + `git init --separate-git-dir` avoids that path while keeping a
 * standard working tree for git CLI wrappers under test.
 */
export interface InitTestGitRepoOptions {
    branch?: string;
    userEmail?: string;
    userName?: string;
}
export declare function testGitBareDir(workDir: string): string;
/** Initialize `workDir` as a git worktree; returns bare dir path for cleanup. */
export declare function initTestGitRepo(workDir: string, opts?: InitTestGitRepoOptions): Promise<{
    gitDir: string;
}>;
export declare function removeTestGitRepo(workDir: string, gitDir?: string): Promise<void>;
/** Synchronous variant for tests that already use execFileSync. */
export declare function initTestGitRepoSync(workDir: string, opts?: InitTestGitRepoOptions): string;
export declare function removeTestGitRepoSync(workDir: string, gitDir?: string): void;
//# sourceMappingURL=git-repo.d.ts.map
/**
 * Sandbox-safe git repo bootstrap for unit tests.
 *
 * Cursor/agent sandboxes block creating `.git/hooks/` under a normal worktree.
 * Bare init + `git init --separate-git-dir` avoids that path while keeping a
 * standard working tree for git CLI wrappers under test.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { execFile, execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
export function testGitBareDir(workDir) {
    return path.join(path.dirname(workDir), `${path.basename(workDir)}.git`);
}
/** Initialize `workDir` as a git worktree; returns bare dir path for cleanup. */
export function initTestGitRepo(workDir_1) {
    return __awaiter(this, arguments, void 0, function* (workDir, opts = {}) {
        var _a, _b, _c;
        const branch = (_a = opts.branch) !== null && _a !== void 0 ? _a : 'main';
        const gitDir = testGitBareDir(workDir);
        const userEmail = (_b = opts.userEmail) !== null && _b !== void 0 ? _b : 'test@pyrfor.test';
        const userName = (_c = opts.userName) !== null && _c !== void 0 ? _c : 'Pyrfor Test';
        yield mkdir(workDir, { recursive: true });
        yield execFileAsync('git', ['init', '--bare', gitDir]);
        yield execFileAsync('git', ['-C', gitDir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
        yield execFileAsync('git', ['init', '--separate-git-dir', gitDir, '-b', branch], { cwd: workDir });
        yield execFileAsync('git', ['config', 'user.email', userEmail], { cwd: workDir });
        yield execFileAsync('git', ['config', 'user.name', userName], { cwd: workDir });
        return { gitDir };
    });
}
export function removeTestGitRepo(workDir, gitDir) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!workDir)
            return;
        const bare = gitDir !== null && gitDir !== void 0 ? gitDir : testGitBareDir(workDir);
        yield rm(workDir, { recursive: true, force: true });
        yield rm(bare, { recursive: true, force: true });
    });
}
/** Synchronous variant for tests that already use execFileSync. */
export function initTestGitRepoSync(workDir, opts = {}) {
    var _a, _b, _c;
    const branch = (_a = opts.branch) !== null && _a !== void 0 ? _a : 'main';
    const gitDir = testGitBareDir(workDir);
    const userEmail = (_b = opts.userEmail) !== null && _b !== void 0 ? _b : 'test@pyrfor.test';
    const userName = (_c = opts.userName) !== null && _c !== void 0 ? _c : 'Pyrfor Test';
    execFileSync('git', ['init', '--bare', gitDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', gitDir, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`], { stdio: 'ignore' });
    execFileSync('git', ['init', '--separate-git-dir', gitDir, '-b', branch], { cwd: workDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', userEmail], { cwd: workDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', userName], { cwd: workDir, stdio: 'ignore' });
    return gitDir;
}
export function removeTestGitRepoSync(workDir, gitDir) {
    if (!workDir)
        return;
    const bare = gitDir !== null && gitDir !== void 0 ? gitDir : testGitBareDir(workDir);
    rmSync(workDir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
}

/**
 * Git CLI wrapper for the Pyrfor IDE sidecar.
 *
 * Uses node:child_process.execFile (NOT shell exec) — no shell injection risk.
 * All public functions take `workspace: string` as first parameter.
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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';
import path from 'node:path';
const execFileAsync = promisify(execFile);
// ─── Validation helpers ────────────────────────────────────────────────────
export function validateWorkspace(workspace) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!path.isAbsolute(workspace)) {
            throw new Error(`workspace must be an absolute path: ${workspace}`);
        }
        let s;
        try {
            s = yield stat(workspace);
        }
        catch (_a) {
            throw new Error(`workspace does not exist: ${workspace}`);
        }
        if (!s.isDirectory()) {
            throw new Error(`workspace is not a directory: ${workspace}`);
        }
        try {
            yield execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: workspace });
        }
        catch (_b) {
            throw new Error(`workspace is not a git repository: ${workspace}`);
        }
    });
}
export function validateRelPath(p) {
    if (!p)
        throw new Error('path must not be empty');
    if (path.isAbsolute(p))
        throw new Error(`path must be relative: ${p}`);
    // Reject any path component that is '..'
    const parts = p.split('/');
    for (const part of parts) {
        if (part === '..')
            throw new Error(`path must not contain ..: ${p}`);
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
function parsePortcelainV2(raw) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const result = { branch: 'HEAD', ahead: 0, behind: 0, files: [] };
    const chunks = raw.split('\0');
    let i = 0;
    while (i < chunks.length) {
        const chunk = chunks[i++];
        if (!chunk)
            continue;
        if (chunk.startsWith('# branch.head ')) {
            result.branch = chunk.slice('# branch.head '.length).trim();
        }
        else if (chunk.startsWith('# branch.ab ')) {
            const m = chunk.match(/\+(\d+)\s+-(\d+)/);
            if (m) {
                result.ahead = parseInt(m[1], 10);
                result.behind = parseInt(m[2], 10);
            }
        }
        else if (chunk.startsWith('1 ')) {
            // 1 XY sub mH mI mW hH hI path
            const fields = chunk.split(' ');
            const xy = (_a = fields[1]) !== null && _a !== void 0 ? _a : '..';
            const filePath = fields.slice(8).join(' ');
            result.files.push({ path: filePath, x: (_b = xy[0]) !== null && _b !== void 0 ? _b : '.', y: (_c = xy[1]) !== null && _c !== void 0 ? _c : '.' });
        }
        else if (chunk.startsWith('2 ')) {
            // 2 XY sub mH mI mW hH hI Xscore path — followed by origPath as next chunk
            const fields = chunk.split(' ');
            const xy = (_d = fields[1]) !== null && _d !== void 0 ? _d : '..';
            const filePath = fields.slice(9).join(' ');
            result.files.push({ path: filePath, x: (_e = xy[0]) !== null && _e !== void 0 ? _e : '.', y: (_f = xy[1]) !== null && _f !== void 0 ? _f : '.' });
            i++; // skip the orig-path chunk
        }
        else if (chunk.startsWith('u ')) {
            // u xy sub m1 m2 m3 mW h1 h2 h3 path  (unmerged)
            const fields = chunk.split(' ');
            const xy = (_g = fields[1]) !== null && _g !== void 0 ? _g : '..';
            const filePath = fields.slice(10).join(' ');
            result.files.push({ path: filePath, x: (_h = xy[0]) !== null && _h !== void 0 ? _h : 'U', y: (_j = xy[1]) !== null && _j !== void 0 ? _j : 'U' });
        }
        else if (chunk.startsWith('? ')) {
            // Untracked file
            const filePath = chunk.slice(2);
            result.files.push({ path: filePath, x: '?', y: '?' });
        }
        // '#' headers we don't need (branch.oid, branch.upstream) are silently skipped
    }
    return result;
}
// ─── Blame parser ──────────────────────────────────────────────────────────
function parseBlame(raw) {
    var _a, _b, _c;
    const lines = raw.split('\n');
    const result = [];
    const commitAuthors = new Map(); // sha → author name
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        // Each blame hunk starts with: <40-char sha> <orig-lineno> <final-lineno> [<group-size>]
        const headerMatch = line.match(/^([0-9a-f]{40}) \d+ (\d+)/);
        if (headerMatch) {
            const sha = headerMatch[1];
            const finalLine = parseInt(headerMatch[2], 10);
            i++;
            let author = (_a = commitAuthors.get(sha)) !== null && _a !== void 0 ? _a : '';
            while (i < lines.length && !lines[i].startsWith('\t')) {
                const meta = lines[i];
                if (meta.startsWith('author ') && !meta.startsWith('author-')) {
                    author = meta.slice(7);
                    commitAuthors.set(sha, author);
                }
                i++;
            }
            if (!author)
                author = (_b = commitAuthors.get(sha)) !== null && _b !== void 0 ? _b : 'Unknown';
            const content = ((_c = lines[i]) === null || _c === void 0 ? void 0 : _c.startsWith('\t')) ? lines[i].slice(1) : '';
            result.push({ sha, author, line: finalLine, content });
            i++;
        }
        else {
            i++;
        }
    }
    return result;
}
// ─── Public API ────────────────────────────────────────────────────────────
export function gitStatus(workspace) {
    return __awaiter(this, void 0, void 0, function* () {
        yield validateWorkspace(workspace);
        const { stdout } = yield execFileAsync('git', ['status', '--porcelain=v2', '--branch', '-z'], { cwd: workspace, maxBuffer: 10 * 1024 * 1024 });
        return parsePortcelainV2(stdout);
    });
}
export function gitHeadSha(workspace) {
    return __awaiter(this, void 0, void 0, function* () {
        yield validateWorkspace(workspace);
        const { stdout } = yield execFileAsync('git', ['rev-parse', 'HEAD'], {
            cwd: workspace,
            maxBuffer: 1024 * 1024,
        });
        return stdout.trim();
    });
}
export function gitRemote(workspace_1) {
    return __awaiter(this, arguments, void 0, function* (workspace, remote = 'origin') {
        yield validateWorkspace(workspace);
        try {
            const { stdout } = yield execFileAsync('git', ['remote', 'get-url', remote], {
                cwd: workspace,
                maxBuffer: 1024 * 1024,
            });
            const url = stdout.trim();
            return url ? { name: remote, url } : null;
        }
        catch (_a) {
            return null;
        }
    });
}
export function gitDiff(workspace_1, filePath_1) {
    return __awaiter(this, arguments, void 0, function* (workspace, filePath, staged = false) {
        validateRelPath(filePath);
        yield validateWorkspace(workspace);
        const args = ['diff', '--no-color'];
        if (staged)
            args.push('--cached');
        args.push('--', filePath);
        try {
            const { stdout } = yield execFileAsync('git', args, {
                cwd: workspace,
                maxBuffer: 10 * 1024 * 1024,
            });
            return stdout;
        }
        catch (err) {
            // execFile rejects on non-zero exit — diff can exit 1 when there are diffs
            const e = err;
            if (typeof e.stdout === 'string')
                return e.stdout;
            throw err;
        }
    });
}
export function gitFileContent(workspace_1, filePath_1) {
    return __awaiter(this, arguments, void 0, function* (workspace, filePath, ref = 'HEAD') {
        validateRelPath(filePath);
        yield validateWorkspace(workspace);
        // Validate ref is safe (alphanumeric, dots, slashes, dashes, tildes, carets, colons)
        if (!/^[a-zA-Z0-9_.^~:/\-]+$/.test(ref)) {
            throw new Error(`invalid ref: ${ref}`);
        }
        try {
            const { stdout } = yield execFileAsync('git', ['show', `${ref}:${filePath}`], {
                cwd: workspace,
                maxBuffer: 10 * 1024 * 1024,
                encoding: 'utf8',
            });
            return stdout;
        }
        catch (_a) {
            // File doesn't exist in this ref (e.g. new untracked file)
            return '';
        }
    });
}
export function gitStage(workspace, paths) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('paths must be a non-empty array');
        }
        paths.forEach(validateRelPath);
        yield validateWorkspace(workspace);
        yield execFileAsync('git', ['add', '--', ...paths], { cwd: workspace });
    });
}
export function gitUnstage(workspace, paths) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Array.isArray(paths) || paths.length === 0) {
            throw new Error('paths must be a non-empty array');
        }
        paths.forEach(validateRelPath);
        yield validateWorkspace(workspace);
        // git restore --staged requires git >= 2.23 (available since 2019)
        try {
            yield execFileAsync('git', ['restore', '--staged', '--', ...paths], { cwd: workspace });
        }
        catch (_a) {
            // Fallback for repos with no commits yet or older git
            yield execFileAsync('git', ['reset', 'HEAD', '--', ...paths], { cwd: workspace });
        }
    });
}
export function gitCommit(workspace, message) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!message || !message.trim()) {
            throw new Error('commit message must not be empty');
        }
        yield validateWorkspace(workspace);
        const { stdout } = yield execFileAsync('git', ['commit', '-m', message], {
            cwd: workspace,
        });
        // Parse SHA from output like: "[main (root-commit) abc1234] message"
        const shaMatch = stdout.match(/\[[\w/.-]+(?:\s+\([^)]+\))?\s+([0-9a-f]+)\]/);
        const sha = (_a = shaMatch === null || shaMatch === void 0 ? void 0 : shaMatch[1]) !== null && _a !== void 0 ? _a : 'unknown';
        return { sha };
    });
}
export function gitLog(workspace_1) {
    return __awaiter(this, arguments, void 0, function* (workspace, limit = 50) {
        yield validateWorkspace(workspace);
        const n = Math.min(Math.max(1, limit), 1000);
        try {
            const { stdout } = yield execFileAsync('git', ['log', '--pretty=format:%H%x09%an%x09%at%x09%s', `-n`, String(n)], { cwd: workspace, maxBuffer: 10 * 1024 * 1024 });
            if (!stdout.trim())
                return [];
            return stdout
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                var _a, _b, _c, _d;
                const parts = line.split('\t');
                return {
                    sha: (_a = parts[0]) !== null && _a !== void 0 ? _a : '',
                    author: (_b = parts[1]) !== null && _b !== void 0 ? _b : '',
                    dateUnix: parseInt((_c = parts[2]) !== null && _c !== void 0 ? _c : '0', 10),
                    subject: (_d = parts[3]) !== null && _d !== void 0 ? _d : '',
                };
            });
        }
        catch (_a) {
            return [];
        }
    });
}
export function gitBlame(workspace, filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        validateRelPath(filePath);
        yield validateWorkspace(workspace);
        const { stdout } = yield execFileAsync('git', ['blame', '--porcelain', '--', filePath], { cwd: workspace, maxBuffer: 10 * 1024 * 1024 });
        return parseBlame(stdout);
    });
}

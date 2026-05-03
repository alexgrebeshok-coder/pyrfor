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
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { storeMemory } from '../ai/memory/agent-memory-store.js';
const ROOT_PERSONALITY_FILES = {
    'IDENTITY.md': { sourceKind: 'personality', memoryType: 'policy' },
    'SOUL.md': { sourceKind: 'personality', memoryType: 'policy' },
    'USER.md': { sourceKind: 'personality', memoryType: 'semantic' },
    'MEMORY.md': { sourceKind: 'personality', memoryType: 'semantic' },
    'AGENTS.md': { sourceKind: 'personality', memoryType: 'policy' },
    'HEARTBEAT.md': { sourceKind: 'personality', memoryType: 'procedural' },
    'TOOLS.md': { sourceKind: 'personality', memoryType: 'policy' },
};
const MAX_FILE_BYTES = 256 * 1024;
export function previewOpenClawMigration(deps, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const report = yield buildOpenClawMigrationReport(deps, options);
        const artifact = yield deps.artifactStore.writeJSON('summary', report, {
            meta: Object.assign({ memoryKind: 'openclaw_import_report', schemaVersion: report.schemaVersion, workspaceId: options.workspaceId }, (options.projectId ? { projectId: options.projectId } : {})),
        });
        return { artifact, report };
    });
}
export function importOpenClawMigration(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        if (input.expectedReportSha256 && ((_a = input.reportArtifact) === null || _a === void 0 ? void 0 : _a.sha256) !== input.expectedReportSha256) {
            throw new Error('OpenClaw migration report sha256 mismatch');
        }
        const report = yield resolveImportReport(deps, input);
        const memoryWriter = (_b = deps.memoryWriter) !== null && _b !== void 0 ? _b : storeMemory;
        const memoryIds = [];
        let skipped = 0;
        for (const entry of report.entries) {
            const absolutePath = safeResolve(report.sourceRoot, entry.sourceRelPath);
            const raw = yield readOpenClawTextFile(report.sourceRoot, entry.sourceRelPath);
            const normalized = normalizeContent(raw);
            if (fingerprint(entry.sourceRelPath, normalized) !== entry.fingerprint) {
                skipped += 1;
                continue;
            }
            const redacted = redactContent(normalized).content;
            const memoryId = yield memoryWriter({
                agentId: 'pyrfor-runtime',
                workspaceId: report.workspaceId,
                projectId: report.projectId,
                memoryType: entry.memoryType,
                content: redacted,
                summary: entry.summary,
                importance: entry.sourceKind === 'personality' ? 0.86 : 0.74,
                metadata: {
                    migratedFrom: 'openclaw',
                    sourcePath: absolutePath,
                    sourceRelPath: entry.sourceRelPath,
                    sourceKind: entry.sourceKind,
                    fingerprint: entry.fingerprint,
                    rollupKind: entry.sourceKind === 'personality' ? 'openclaw_personality' : 'openclaw_memory',
                    scope: Object.assign({ visibility: report.projectId ? 'project' : 'workspace', workspaceId: report.workspaceId }, (report.projectId ? { projectId: report.projectId } : {})),
                    confidence: 0.82,
                    provenance: [{ kind: 'external', ref: entry.sourceRelPath, ts: entry.mtime }],
                },
            });
            if (memoryId === 'short-term-only')
                throw new Error('OpenClaw migration memory was not durably persisted');
            memoryIds.push(memoryId);
        }
        const artifact = yield deps.artifactStore.writeJSON('summary', {
            schemaVersion: 'openclaw_migration_result.v1',
            importedAt: ((_c = deps.now) !== null && _c !== void 0 ? _c : (() => new Date()))().toISOString(),
            reportArtifactId: (_d = input.reportArtifact) === null || _d === void 0 ? void 0 : _d.id,
            reportSha256: (_e = input.reportArtifact) === null || _e === void 0 ? void 0 : _e.sha256,
            workspaceId: report.workspaceId,
            projectId: report.projectId,
            imported: memoryIds.length,
            skipped,
            memoryIds,
        }, {
            meta: Object.assign({ memoryKind: 'openclaw_import_result', workspaceId: report.workspaceId }, (report.projectId ? { projectId: report.projectId } : {})),
        });
        return { imported: memoryIds.length, skipped, memoryIds, artifact };
    });
}
function resolveImportReport(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (input.reportArtifact && input.expectedReportSha256) {
            const report = yield deps.artifactStore.readJSONVerified(input.reportArtifact, input.expectedReportSha256);
            if (((_a = input.reportArtifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) !== 'openclaw_import_report') {
                throw new Error('OpenClaw migration artifact kind mismatch');
            }
            if (((_b = input.reportArtifact.meta) === null || _b === void 0 ? void 0 : _b.workspaceId) !== report.workspaceId) {
                throw new Error('OpenClaw migration artifact workspace mismatch');
            }
            const artifactProjectId = (_c = input.reportArtifact.meta) === null || _c === void 0 ? void 0 : _c.projectId;
            if ((artifactProjectId !== null && artifactProjectId !== void 0 ? artifactProjectId : undefined) !== ((_d = report.projectId) !== null && _d !== void 0 ? _d : undefined)) {
                throw new Error('OpenClaw migration artifact project mismatch');
            }
            assertAllowedReportSourceRoot(report, input.allowNonCanonicalSourceRoot === true);
            return report;
        }
        if (!input.report)
            throw new Error('OpenClaw migration report is required');
        assertAllowedReportSourceRoot(input.report, input.allowNonCanonicalSourceRoot === true);
        return input.report;
    });
}
export function isAllowedOpenClawReportSourceRoot(report) {
    return isAllowedSourceRoot(report.sourceRoot);
}
function assertAllowedReportSourceRoot(report, allowNonCanonicalSourceRoot) {
    if (!isAllowedSourceRoot(report.sourceRoot, allowNonCanonicalSourceRoot)) {
        throw new Error('OpenClaw migration report source root is not an allowed workspace root');
    }
}
export function discoverOpenClawSourceRoots() {
    return __awaiter(this, void 0, void 0, function* () {
        const candidates = [
            path.join(homedir(), '.openclaw', 'workspace'),
            path.join(homedir(), 'openclaw-workspace'),
        ];
        const existing = [];
        for (const candidate of candidates) {
            const info = yield stat(candidate).catch(() => null);
            if (info === null || info === void 0 ? void 0 : info.isDirectory())
                existing.push(candidate);
        }
        return existing;
    });
}
export function buildOpenClawMigrationReport(deps, options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const sourceRoot = yield resolveSourceRoot(options.sourcePath, options.allowNonCanonicalSourceRoot === true);
        const includePersonality = options.includePersonality !== false;
        const includeMemories = options.includeMemories !== false;
        const maxFiles = Math.max(1, Math.min((_a = options.maxFiles) !== null && _a !== void 0 ? _a : 500, 2000));
        const skipped = [];
        const discovered = yield discoverImportableFiles(sourceRoot, { includePersonality, includeMemories, maxFiles, skipped });
        const entries = [];
        const seen = new Set();
        for (const file of discovered) {
            const absolutePath = path.join(sourceRoot, file.sourceRelPath);
            const info = yield lstat(absolutePath);
            if (!info.isFile()) {
                skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'denied_path' });
                continue;
            }
            if (info.size > MAX_FILE_BYTES) {
                skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'file_too_large' });
                continue;
            }
            const normalized = normalizeContent(yield readOpenClawTextFile(sourceRoot, file.sourceRelPath));
            const fp = fingerprint(file.sourceRelPath, normalized);
            if (seen.has(fp)) {
                skipped.push({ sourceRelPath: file.sourceRelPath, reason: 'duplicate_in_batch' });
                continue;
            }
            seen.add(fp);
            const redacted = redactContent(normalized);
            entries.push({
                sourceRelPath: file.sourceRelPath,
                sourceKind: file.sourceKind,
                memoryType: file.memoryType,
                fingerprint: fp,
                bytes: Buffer.byteLength(redacted.content, 'utf-8'),
                mtime: info.mtime.toISOString(),
                summary: summarize(file.sourceRelPath, redacted.content),
                redactionCount: redacted.count,
            });
        }
        return Object.assign(Object.assign({ schemaVersion: 'openclaw_migration_report.v1', generatedAt: ((_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date()))().toISOString(), workspaceId: options.workspaceId }, (options.projectId ? { projectId: options.projectId } : {})), { sourceRoot, counts: {
                importable: entries.length,
                skipped: skipped.length,
                personality: entries.filter((entry) => entry.sourceKind === 'personality').length,
                memories: entries.filter((entry) => entry.sourceKind === 'memory').length,
                skills: entries.filter((entry) => entry.sourceKind === 'skill').length,
                redactions: entries.reduce((sum, entry) => sum + entry.redactionCount, 0),
            }, entries,
            skipped });
    });
}
function resolveSourceRoot(sourcePath, allowNonCanonicalSourceRoot) {
    return __awaiter(this, void 0, void 0, function* () {
        const roots = sourcePath ? [path.resolve(sourcePath)] : yield discoverOpenClawSourceRoots();
        const sourceRoot = roots[0];
        if (!sourceRoot)
            throw new Error('No OpenClaw workspace source found');
        if (!isAllowedSourceRoot(sourceRoot, allowNonCanonicalSourceRoot))
            throw new Error('OpenClaw source path is not an allowed workspace root');
        const linkInfo = yield lstat(sourceRoot).catch(() => null);
        if (!(linkInfo === null || linkInfo === void 0 ? void 0 : linkInfo.isDirectory()))
            throw new Error('OpenClaw source path is not a directory');
        const realRoot = yield realpath(sourceRoot);
        if (!isAllowedSourceRoot(realRoot, allowNonCanonicalSourceRoot))
            throw new Error('OpenClaw source path is not an allowed workspace root');
        return realRoot;
    });
}
function isAllowedSourceRoot(sourceRoot, allowNonCanonicalSourceRoot = false) {
    const normalized = path.resolve(sourceRoot);
    const canonicalRoots = [
        path.resolve(homedir(), '.openclaw', 'workspace'),
        path.resolve(homedir(), 'openclaw-workspace'),
    ];
    if (canonicalRoots.includes(normalized))
        return true;
    if (!allowNonCanonicalSourceRoot)
        return false;
    const base = path.basename(normalized);
    const parentBase = path.basename(path.dirname(normalized));
    return base === 'openclaw-workspace'
        || (base === 'workspace' && parentBase === '.openclaw');
}
function discoverImportableFiles(sourceRoot, opts) {
    return __awaiter(this, void 0, void 0, function* () {
        const files = [];
        if (opts.includePersonality) {
            for (const [file, mapping] of Object.entries(ROOT_PERSONALITY_FILES)) {
                if (yield isFile(path.join(sourceRoot, file)))
                    files.push(Object.assign({ sourceRelPath: file }, mapping));
            }
            files.push(...yield discoverMarkdownTree(sourceRoot, 'skills', 'skill', 'procedural', opts.skipped));
        }
        if (opts.includeMemories) {
            files.push(...yield discoverMarkdownTree(sourceRoot, 'memory', 'memory', 'episodic', opts.skipped));
        }
        return files
            .sort((a, b) => a.sourceRelPath.localeCompare(b.sourceRelPath))
            .slice(0, opts.maxFiles);
    });
}
function discoverMarkdownTree(sourceRoot, relDir, sourceKind, memoryType, skipped) {
    return __awaiter(this, void 0, void 0, function* () {
        const root = path.join(sourceRoot, relDir);
        const info = yield lstat(root).catch(() => null);
        if (!(info === null || info === void 0 ? void 0 : info.isDirectory()))
            return [];
        const results = [];
        function walk(dir) {
            return __awaiter(this, void 0, void 0, function* () {
                const entries = yield readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name.endsWith('~') || entry.name.includes('.backup')) {
                        skipped.push({ sourceRelPath: path.relative(sourceRoot, path.join(dir, entry.name)), reason: 'denied_path' });
                        continue;
                    }
                    const full = path.join(dir, entry.name);
                    const rel = path.relative(sourceRoot, full);
                    if (entry.isDirectory()) {
                        yield walk(full);
                    }
                    else if (entry.isFile() && entry.name.endsWith('.md')) {
                        results.push({ sourceRelPath: rel, sourceKind, memoryType });
                    }
                    else {
                        skipped.push({ sourceRelPath: rel, reason: 'unsupported_file_type' });
                    }
                }
            });
        }
        yield walk(root);
        return results;
    });
}
function isFile(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const info = yield lstat(filePath).catch(() => null);
        return Boolean(info === null || info === void 0 ? void 0 : info.isFile());
    });
}
function safeResolve(root, relPath) {
    const resolved = path.resolve(root, relPath);
    const normalizedRoot = path.resolve(root);
    const relative = path.relative(normalizedRoot, resolved);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('OpenClaw source path escaped source root');
    }
    return resolved;
}
function readOpenClawTextFile(root, relPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const absolutePath = safeResolve(root, relPath);
        const linkInfo = yield lstat(absolutePath);
        if (!linkInfo.isFile())
            throw new Error('OpenClaw source path is not a regular file');
        const [realRoot, realFile] = yield Promise.all([realpath(root), realpath(absolutePath)]);
        const relative = path.relative(realRoot, realFile);
        if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('OpenClaw source path escaped source root');
        }
        return readFile(realFile, 'utf-8');
    });
}
function normalizeContent(value) {
    return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}
function fingerprint(relPath, normalizedBody) {
    return createHash('sha256').update(`${relPath}\n${normalizedBody}`).digest('hex');
}
function redactContent(value) {
    let count = 0;
    const replace = (input, pattern, replacement) => input.replace(pattern, () => {
        count += 1;
        return replacement;
    });
    let content = value;
    content = replace(content, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
    content = replace(content, /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
    content = replace(content, /\b(api[_-]?key|token|secret|password)\b\s*[:=]\s*["']?[^"'\s]{6,}["']?/gi, '$1=[REDACTED]');
    return { content, count };
}
function summarize(relPath, content) {
    var _a;
    const firstLine = (_a = content
        .split('\n')
        .map((line) => line.replace(/^#+\s*/, '').trim())
        .find((line) => line.length > 0)) !== null && _a !== void 0 ? _a : 'OpenClaw memory';
    return `${relPath}: ${firstLine.slice(0, 160)}`;
}

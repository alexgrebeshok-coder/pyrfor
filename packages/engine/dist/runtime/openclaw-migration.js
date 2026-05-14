var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { revokeImportedMemories, searchMemory, storeMemory, } from '../ai/memory/agent-memory-store.js';
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
        const now = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const memoryWriter = (_c = deps.memoryWriter) !== null && _c !== void 0 ? _c : storeMemory;
        const memoryIds = [];
        const importedEntries = [];
        const skippedEntries = [];
        for (const entry of report.entries) {
            const absolutePath = safeResolve(report.sourceRoot, entry.sourceRelPath);
            const raw = yield readOpenClawTextFile(report.sourceRoot, entry.sourceRelPath);
            const normalized = normalizeContent(raw);
            if (fingerprint(entry.sourceRelPath, normalized) !== entry.fingerprint) {
                skippedEntries.push({
                    sourceRelPath: entry.sourceRelPath,
                    fingerprint: entry.fingerprint,
                    reason: 'fingerprint_mismatch',
                });
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
                skipShortTerm: true,
                metadata: {
                    migratedFrom: 'openclaw',
                    sourcePath: absolutePath,
                    sourceRelPath: entry.sourceRelPath,
                    sourceKind: entry.sourceKind,
                    fingerprint: entry.fingerprint,
                    importState: 'imported_quarantined',
                    approvalState: 'pending_approval',
                    plannerEligible: false,
                    importedAt: now().toISOString(),
                    importedFrom: 'openclaw',
                    rollupKind: entry.sourceKind === 'personality' ? 'openclaw_personality' : 'openclaw_memory',
                    scope: Object.assign({ visibility: report.projectId ? 'project' : 'workspace', workspaceId: report.workspaceId }, (report.projectId ? { projectId: report.projectId } : {})),
                    confidence: 0.82,
                    provenance: [{ kind: 'external', ref: entry.sourceRelPath, ts: entry.mtime }],
                },
            });
            if (memoryId === 'short-term-only')
                throw new Error('OpenClaw migration memory was not durably persisted');
            memoryIds.push(memoryId);
            importedEntries.push({
                sourceRelPath: entry.sourceRelPath,
                sourceKind: entry.sourceKind,
                memoryType: entry.memoryType,
                fingerprint: entry.fingerprint,
                memoryId,
            });
        }
        const migrationId = `openclaw-${randomUUID()}`;
        const rollbackPlan = {
            status: 'prepared_not_executed',
            action: 'revoke_imported_memories',
            memoryIds,
            note: 'Use this manifest to revoke or tombstone imported memories if the operator rolls back this migration.',
        };
        const document = {
            schemaVersion: 'openclaw_migration_result.v1',
            migrationId,
            importedAt: now().toISOString(),
            reportArtifactId: (_d = input.reportArtifact) === null || _d === void 0 ? void 0 : _d.id,
            reportSha256: (_e = input.reportArtifact) === null || _e === void 0 ? void 0 : _e.sha256,
            workspaceId: report.workspaceId,
            projectId: report.projectId,
            imported: memoryIds.length,
            skipped: skippedEntries.length,
            memoryIds,
            importedEntries,
            skippedEntries,
            rollbackPlan,
        };
        const artifact = yield deps.artifactStore.writeJSON('summary', document, {
            meta: Object.assign({ memoryKind: 'openclaw_import_result', migrationId, workspaceId: report.workspaceId }, (report.projectId ? { projectId: report.projectId } : {})),
        });
        return {
            schemaVersion: document.schemaVersion,
            migrationId,
            imported: memoryIds.length,
            skipped: skippedEntries.length,
            memoryIds,
            importedEntries,
            skippedEntries,
            rollbackPlan,
            artifact,
        };
    });
}
export function rollbackOpenClawMigration(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const resultDocument = yield resolveImportResultDocument(deps, input.resultArtifact, input.expectedResultSha256);
        if (resultDocument.rollbackPlan.action !== 'revoke_imported_memories') {
            throw new Error('OpenClaw migration rollback action is not supported');
        }
        const revoker = (_a = deps.memoryRevoker) !== null && _a !== void 0 ? _a : revokeImportedMemories;
        const revokedAt = (_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date());
        const rollbackAt = revokedAt();
        const revocation = yield revoker(Object.assign(Object.assign({ memoryIds: resultDocument.rollbackPlan.memoryIds, agentId: 'pyrfor-runtime', workspaceId: resultDocument.workspaceId }, (resultDocument.projectId ? { projectId: resultDocument.projectId } : {})), { migratedFrom: 'openclaw', reason: `openclaw_migration_rollback:${resultDocument.migrationId}`, revokedAt: rollbackAt }));
        const rollbackDocument = Object.assign(Object.assign(Object.assign({ schemaVersion: 'openclaw_migration_rollback_result.v1', migrationId: resultDocument.migrationId, workspaceId: resultDocument.workspaceId }, (resultDocument.projectId ? { projectId: resultDocument.projectId } : {})), { rolledBackAt: rollbackAt.toISOString() }), revocation);
        const artifact = yield deps.artifactStore.writeJSON('summary', rollbackDocument, {
            meta: Object.assign({ memoryKind: 'openclaw_rollback_result', migrationId: resultDocument.migrationId, workspaceId: resultDocument.workspaceId }, (resultDocument.projectId ? { projectId: resultDocument.projectId } : {})),
        });
        return Object.assign(Object.assign({}, rollbackDocument), { artifact });
    });
}
export function verifyOpenClawMigration(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const resultDocument = yield resolveImportResultDocument(deps, input.resultArtifact, input.expectedResultSha256);
        const memorySearcher = (_a = deps.memorySearcher) !== null && _a !== void 0 ? _a : searchMemory;
        const queryLimit = normalizeQueryLimit(input.queryLimit);
        const verifiedAt = ((_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date()))();
        const entries = [];
        for (const entry of resultDocument.importedEntries) {
            const publicEntry = publicVerificationEntryBase(entry);
            const queries = buildVerificationQueries(entry);
            let found = null;
            let failedError;
            let attempts = 0;
            for (const query of queries) {
                attempts += 1;
                try {
                    const results = yield memorySearcher(Object.assign(Object.assign({ agentId: 'pyrfor-runtime', workspaceId: resultDocument.workspaceId }, (resultDocument.projectId ? { projectId: resultDocument.projectId } : {})), { memoryType: entry.memoryType, query, limit: queryLimit }));
                    const matched = results.find((memory) => memory.id === entry.memoryId);
                    if (matched) {
                        found = Object.assign(Object.assign({}, publicEntry), { searchAttempts: attempts, foundInResults: true, matchedSummary: matched.summary });
                        break;
                    }
                }
                catch (err) {
                    failedError = err instanceof Error ? err.message : String(err);
                    break;
                }
            }
            if (found) {
                entries.push(found);
                continue;
            }
            entries.push(Object.assign(Object.assign(Object.assign({}, publicEntry), { searchAttempts: attempts, foundInResults: false }), (failedError ? { searchFailed: true, error: failedError } : {})));
        }
        const foundCount = entries.filter((entry) => entry.foundInResults).length;
        const searchAttemptsFailed = entries.filter((entry) => entry.searchFailed === true).length;
        const document = {
            schemaVersion: 'openclaw_migration_verification_result.v1',
            migrationId: resultDocument.migrationId,
            verifiedAt: verifiedAt.toISOString(),
            totalMemories: entries.length,
            foundCount,
            missCount: entries.length - foundCount,
            searchAttemptsFailed,
            entries,
        };
        const artifact = yield deps.artifactStore.writeJSON('summary', document, {
            meta: Object.assign({ memoryKind: 'openclaw_verification_result', migrationId: resultDocument.migrationId, workspaceId: resultDocument.workspaceId }, (resultDocument.projectId ? { projectId: resultDocument.projectId } : {})),
        });
        return Object.assign(Object.assign({}, document), { artifact });
    });
}
export function buildOpenClawMigrationAudit(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const projectId = ((_a = input.projectId) === null || _a === void 0 ? void 0 : _a.trim()) || undefined;
        const limit = normalizeAuditLimit(input.limit);
        const warnings = [];
        const summaryArtifacts = yield deps.artifactStore.list({ kind: 'summary' });
        const scopedArtifacts = summaryArtifacts.filter((artifact) => {
            var _a, _b, _c;
            return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.workspaceId) === input.workspaceId
                && ((projectId ? ((_b = artifact.meta) === null || _b === void 0 ? void 0 : _b.projectId) === projectId : ((_c = artifact.meta) === null || _c === void 0 ? void 0 : _c.projectId) === undefined));
        });
        const importArtifacts = scopedArtifacts.filter((artifact) => { var _a; return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) === 'openclaw_import_result'; });
        const verificationArtifacts = scopedArtifacts.filter((artifact) => { var _a; return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) === 'openclaw_verification_result'; });
        const rollbackArtifacts = scopedArtifacts.filter((artifact) => { var _a; return ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) === 'openclaw_rollback_result'; });
        const imports = [];
        for (const artifact of importArtifacts) {
            try {
                const document = yield readArtifactJson(deps.artifactStore, artifact);
                if (document.schemaVersion !== 'openclaw_migration_result.v1') {
                    throw new Error('schema mismatch');
                }
                if (document.workspaceId !== input.workspaceId) {
                    throw new Error('workspace mismatch');
                }
                if (((_b = document.projectId) !== null && _b !== void 0 ? _b : undefined) !== projectId) {
                    throw new Error('project mismatch');
                }
                imports.push({ artifact, document });
            }
            catch (err) {
                warnings.push(auditWarning(artifact, err));
            }
        }
        const verificationsByMigration = new Map();
        for (const artifact of verificationArtifacts) {
            try {
                const migrationId = requireMigrationArtifactId(artifact);
                const document = yield readArtifactJson(deps.artifactStore, artifact);
                if (document.schemaVersion !== 'openclaw_migration_verification_result.v1') {
                    throw new Error('schema mismatch');
                }
                if (document.migrationId !== migrationId) {
                    throw new Error('migration mismatch');
                }
                const entries = (_c = verificationsByMigration.get(migrationId)) !== null && _c !== void 0 ? _c : [];
                entries.push({ artifact, document });
                verificationsByMigration.set(migrationId, entries);
            }
            catch (err) {
                warnings.push(auditWarning(artifact, err));
            }
        }
        const rollbacksByMigration = new Map();
        for (const artifact of rollbackArtifacts) {
            try {
                const migrationId = requireMigrationArtifactId(artifact);
                const document = yield readArtifactJson(deps.artifactStore, artifact);
                if (document.schemaVersion !== 'openclaw_migration_rollback_result.v1') {
                    throw new Error('schema mismatch');
                }
                if (document.migrationId !== migrationId) {
                    throw new Error('migration mismatch');
                }
                if (document.workspaceId !== input.workspaceId) {
                    throw new Error('workspace mismatch');
                }
                if (((_d = document.projectId) !== null && _d !== void 0 ? _d : undefined) !== projectId) {
                    throw new Error('project mismatch');
                }
                const entries = (_e = rollbacksByMigration.get(migrationId)) !== null && _e !== void 0 ? _e : [];
                entries.push({ artifact, document });
                rollbacksByMigration.set(migrationId, entries);
            }
            catch (err) {
                warnings.push(auditWarning(artifact, err));
            }
        }
        const migrations = imports
            .sort((a, b) => b.document.importedAt.localeCompare(a.document.importedAt))
            .slice(0, limit)
            .map(({ artifact, document }) => {
            var _a, _b, _c, _d;
            const latestVerification = latestBy((_a = verificationsByMigration.get(document.migrationId)) !== null && _a !== void 0 ? _a : [], (entry) => entry.document.verifiedAt);
            const latestRollback = latestBy((_b = rollbacksByMigration.get(document.migrationId)) !== null && _b !== void 0 ? _b : [], (entry) => entry.document.rolledBackAt);
            const quarantineCandidates = latestRollback ? [] : ((_c = latestVerification === null || latestVerification === void 0 ? void 0 : latestVerification.document.entries) !== null && _c !== void 0 ? _c : [])
                .filter((entry) => !entry.foundInResults && entry.searchFailed !== true)
                .map((entry) => quarantineCandidate(document.migrationId, latestVerification.artifact, entry, 'verification_missed'));
            const searchFailures = latestRollback ? [] : ((_d = latestVerification === null || latestVerification === void 0 ? void 0 : latestVerification.document.entries) !== null && _d !== void 0 ? _d : [])
                .filter((entry) => !entry.foundInResults && entry.searchFailed === true)
                .map((entry) => quarantineCandidate(document.migrationId, latestVerification.artifact, entry, 'verification_search_failed'));
            const migration = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ migrationId: document.migrationId, workspaceId: document.workspaceId }, (document.projectId ? { projectId: document.projectId } : {})), { status: auditStatus(latestVerification === null || latestVerification === void 0 ? void 0 : latestVerification.document, latestRollback === null || latestRollback === void 0 ? void 0 : latestRollback.document, quarantineCandidates, searchFailures), importedAt: document.importedAt, imported: document.imported, skipped: document.skipped, memoryIds: document.memoryIds, importArtifact: artifact }), (latestVerification ? { latestVerification: verificationSummary(latestVerification.artifact, latestVerification.document) } : {})), (latestRollback ? { latestRollback: rollbackSummary(latestRollback.artifact, latestRollback.document) } : {})), { quarantineCandidates,
                searchFailures });
            return migration;
        });
        return Object.assign(Object.assign({ schemaVersion: 'openclaw_migration_audit.v1', generatedAt: ((_f = deps.now) !== null && _f !== void 0 ? _f : (() => new Date()))().toISOString(), workspaceId: input.workspaceId }, (projectId ? { projectId } : {})), { migrations, quarantineCandidates: migrations.flatMap((migration) => migration.quarantineCandidates), searchFailures: migrations.flatMap((migration) => migration.searchFailures), artifactCounts: {
                importResults: imports.length,
                verificationResults: Array.from(verificationsByMigration.values()).reduce((sum, entries) => sum + entries.length, 0),
                rollbackResults: Array.from(rollbacksByMigration.values()).reduce((sum, entries) => sum + entries.length, 0),
                invalidArtifacts: warnings.length,
            }, warnings });
    });
}
export function buildOpenClawMigrationQuarantine(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        const audit = yield buildOpenClawMigrationAudit(deps, input);
        return Object.assign(Object.assign({ schemaVersion: 'openclaw_quarantine_state.v1', generatedAt: audit.generatedAt, workspaceId: audit.workspaceId }, (audit.projectId ? { projectId: audit.projectId } : {})), { candidateCount: audit.quarantineCandidates.length, searchFailureCount: audit.searchFailures.length, candidates: audit.quarantineCandidates, searchFailures: audit.searchFailures, sourceMigrationCount: audit.migrations.length });
    });
}
function resolveImportResultDocument(deps, resultArtifact, expectedResultSha256) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        if (resultArtifact.sha256 !== expectedResultSha256) {
            throw new Error('OpenClaw migration result sha256 mismatch');
        }
        if (((_a = resultArtifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) !== 'openclaw_import_result') {
            throw new Error('OpenClaw migration result artifact kind mismatch');
        }
        const resultDocument = yield deps.artifactStore.readJSONVerified(resultArtifact, expectedResultSha256);
        if (resultDocument.schemaVersion !== 'openclaw_migration_result.v1') {
            throw new Error('OpenClaw migration result schema mismatch');
        }
        if (((_b = resultArtifact.meta) === null || _b === void 0 ? void 0 : _b.migrationId) !== resultDocument.migrationId) {
            throw new Error('OpenClaw migration result migration mismatch');
        }
        if (((_c = resultArtifact.meta) === null || _c === void 0 ? void 0 : _c.workspaceId) !== resultDocument.workspaceId) {
            throw new Error('OpenClaw migration result workspace mismatch');
        }
        return resultDocument;
    });
}
function readArtifactJson(artifactStore, artifact) {
    return __awaiter(this, void 0, void 0, function* () {
        if (artifact.sha256)
            return artifactStore.readJSONVerified(artifact, artifact.sha256);
        return artifactStore.readJSON(artifact);
    });
}
function requireMigrationArtifactId(artifact) {
    var _a;
    const migrationId = (_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.migrationId;
    if (typeof migrationId !== 'string' || !migrationId.trim()) {
        throw new Error('migration metadata missing');
    }
    return migrationId;
}
function latestBy(entries, getTimestamp) {
    return [...entries].sort((a, b) => getTimestamp(b).localeCompare(getTimestamp(a)))[0];
}
function quarantineCandidate(migrationId, verificationArtifact, entry, reason) {
    return Object.assign({ migrationId, memoryId: entry.memoryId, sourceRelPath: entry.sourceRelPath, sourceKind: entry.sourceKind, memoryType: entry.memoryType, reason, verificationArtifactId: verificationArtifact.id }, (verificationArtifact.sha256 ? { verificationSha256: verificationArtifact.sha256 } : {}));
}
function verificationSummary(artifact, document) {
    return {
        artifact,
        verifiedAt: document.verifiedAt,
        totalMemories: document.totalMemories,
        foundCount: document.foundCount,
        missCount: document.missCount,
        searchAttemptsFailed: document.searchAttemptsFailed,
        quarantineCandidateCount: document.entries.filter((entry) => !entry.foundInResults && entry.searchFailed !== true).length,
        searchFailureCount: document.entries.filter((entry) => !entry.foundInResults && entry.searchFailed === true).length,
    };
}
function rollbackSummary(artifact, document) {
    return {
        artifact,
        rolledBackAt: document.rolledBackAt,
        requested: document.requested,
        matched: document.matched,
        revoked: document.revoked,
        missingIds: document.missingIds,
        skippedIds: document.skippedIds,
        alreadyRevokedIds: document.alreadyRevokedIds,
    };
}
function auditStatus(verification, rollback, quarantineCandidates, searchFailures) {
    if (rollback)
        return 'rolled_back';
    if (!verification)
        return 'imported';
    if (quarantineCandidates.length > 0)
        return 'needs_review';
    if (searchFailures.length > 0)
        return 'search_unverified';
    return 'verified';
}
function auditWarning(artifact, err) {
    var _a;
    return Object.assign(Object.assign({ artifactId: artifact.id }, (typeof ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a.memoryKind) === 'string' ? { memoryKind: artifact.meta.memoryKind } : {})), { reason: safeAuditWarningReason(err) });
}
function safeAuditWarningReason(err) {
    if (err instanceof SyntaxError)
        return 'artifact_json_invalid';
    if (err && typeof err === 'object' && 'code' in err) {
        const code = String(err.code);
        if (code === 'ENOENT')
            return 'artifact_missing';
        if (code === 'EACCES' || code === 'EPERM')
            return 'artifact_read_denied';
        if (code)
            return 'artifact_read_failed';
    }
    const message = err instanceof Error ? err.message : String(err);
    switch (message) {
        case 'schema mismatch':
        case 'workspace mismatch':
        case 'project mismatch':
        case 'migration mismatch':
        case 'migration metadata missing':
            return message;
        default:
            return 'artifact_read_failed';
    }
}
function publicVerificationEntryBase(entry) {
    return {
        memoryId: entry.memoryId,
        sourceRelPath: entry.sourceRelPath,
        sourceKind: entry.sourceKind,
        memoryType: entry.memoryType,
    };
}
function normalizeQueryLimit(value) {
    if (value === undefined)
        return 10;
    if (!Number.isFinite(value))
        return 10;
    return Math.max(1, Math.min(100, Math.floor(value)));
}
function normalizeAuditLimit(value) {
    if (value === undefined)
        return 50;
    if (!Number.isFinite(value))
        return 50;
    return Math.max(1, Math.min(500, Math.floor(value)));
}
function buildVerificationQueries(entry) {
    const basename = path.basename(entry.sourceRelPath, path.extname(entry.sourceRelPath));
    return [...new Set([
            entry.sourceRelPath,
            basename,
            entry.sourceKind,
        ].map((query) => query.trim()).filter(Boolean))];
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

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
import { filterMemoryForScope, searchDurableMemoryForContext, } from '../ai/memory/agent-memory-store.js';
import { hashContextPack, stableStringify, withContextPackHash, } from './context-pack.js';
const EVIDENCE_ARTIFACT_LIMIT = 5;
const EVIDENCE_SOURCE_LIMIT = 3;
const EVIDENCE_TEXT_LIMIT = 400;
export class ContextCompiler {
    constructor(deps = {}) {
        this.deps = deps;
    }
    compile(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const sections = [];
            sections.push(makeSection({
                id: 'task_contract',
                kind: 'task_contract',
                title: 'Task contract',
                priority: 10,
                content: input.task,
                sources: [{ kind: 'task', ref: (_b = (_a = input.task.id) !== null && _a !== void 0 ? _a : input.runId) !== null && _b !== void 0 ? _b : 'task', role: 'input' }],
            }));
            const workspace = inputWorkspace(this.deps);
            const policySection = collectPolicySection(workspace, (_c = input.policyFacts) !== null && _c !== void 0 ? _c : []);
            if (policySection)
                sections.push(policySection);
            const workspaceSection = collectWorkspaceSection(workspace);
            if (workspaceSection)
                sections.push(workspaceSection);
            const filesSection = collectFilesOfInterest((_d = input.filesOfInterest) !== null && _d !== void 0 ? _d : []);
            if (filesSection)
                sections.push(filesSection);
            const ledgerSection = yield this.collectLedgerHistory(input);
            if (ledgerSection)
                sections.push(ledgerSection);
            const sessionSection = yield this.collectSessionHistory(input);
            if (sessionSection)
                sections.push(sessionSection);
            const dagSection = collectDependencyGraph(this.deps.dag);
            if (dagSection)
                sections.push(dagSection);
            const evidenceSection = yield this.collectRunEvidence(input);
            if (evidenceSection)
                sections.push(evidenceSection);
            const memorySections = yield this.collectMemory(input);
            sections.push(...memorySections);
            const domainSection = collectDomainFacts((_e = input.domainFacts) !== null && _e !== void 0 ? _e : []);
            if (domainSection)
                sections.push(domainSection);
            const sortedSections = sections.sort(compareSections);
            const sourceRefs = sortedSections
                .flatMap((section) => section.sources)
                .sort(compareSourceRefs);
            const withoutHash = {
                schemaVersion: 'context_pack.v1',
                packId: `ctx:${(_g = (_f = input.runId) !== null && _f !== void 0 ? _f : input.task.id) !== null && _g !== void 0 ? _g : input.workspaceId}`,
                compiledAt: (_h = input.compiledAt) !== null && _h !== void 0 ? _h : new Date().toISOString(),
                runId: input.runId,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                task: input.task,
                sections: sortedSections,
                sourceRefs,
            };
            const pack = withContextPackHash(withoutHash);
            return {
                pack,
                hash: pack.hash,
                canonicalJson: stableStringify(withoutHash),
            };
        });
    }
    persist(result_1) {
        return __awaiter(this, arguments, void 0, function* (result, opts = {}) {
            var _a, _b;
            const artifactStore = (_a = opts.artifactStore) !== null && _a !== void 0 ? _a : this.deps.artifactStore;
            if (!artifactStore)
                throw new Error('ContextCompiler: artifactStore is required to persist context packs');
            return artifactStore.writeJSON('context_pack', result.pack, {
                runId: (_b = opts.runId) !== null && _b !== void 0 ? _b : result.pack.runId,
                meta: {
                    context_hash: result.hash,
                    schemaVersion: result.pack.schemaVersion,
                },
            });
        });
    }
    compileRunEvidenceSection(runId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.collectRunEvidence({ runId });
        });
    }
    collectLedgerHistory(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const runIds = (_a = input.historyRunIds) !== null && _a !== void 0 ? _a : (input.runId ? [input.runId] : []);
            if (runIds.length === 0)
                return undefined;
            const events = [];
            for (const runId of [...runIds].sort()) {
                const runEvents = this.deps.runLedger
                    ? yield this.deps.runLedger.eventsForRun(runId)
                    : yield ((_b = this.deps.eventLedger) === null || _b === void 0 ? void 0 : _b.byRun(runId));
                events.push(...(runEvents !== null && runEvents !== void 0 ? runEvents : []));
            }
            const limited = events
                .sort((a, b) => a.seq - b.seq || a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id))
                .slice(-((_c = input.ledgerEventLimit) !== null && _c !== void 0 ? _c : 50));
            if (limited.length === 0)
                return undefined;
            return makeSection({
                id: 'ledger_history',
                kind: 'ledger',
                title: 'Ledger history',
                priority: 50,
                content: limited.map((event) => ({
                    id: event.id,
                    seq: event.seq,
                    ts: event.ts,
                    type: event.type,
                    run_id: event.run_id,
                })),
                sources: limited.map((event) => ({
                    kind: 'ledger_event',
                    ref: event.id,
                    role: 'history',
                    meta: { run_id: event.run_id, type: event.type, seq: event.seq },
                })),
            });
        });
    }
    collectSessionHistory(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!input.sessionId || !this.deps.sessionStore)
                return undefined;
            const session = yield this.deps.sessionStore.get(input.workspaceId, input.sessionId);
            if (!session)
                return undefined;
            const content = session.summary
                ? { sessionId: session.id, title: session.title, summary: session.summary }
                : {
                    sessionId: session.id,
                    title: session.title,
                    messages: cloneSessionMessages(session.messages.slice(-((_a = input.sessionMessageLimit) !== null && _a !== void 0 ? _a : 10))),
                };
            return makeSection({
                id: 'session_history',
                kind: 'session',
                title: 'Session history',
                priority: 60,
                content,
                sources: [{ kind: 'session', ref: session.id, role: 'history' }],
            });
        });
    }
    collectMemory(input) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            if (!input.agentId)
                return [];
            const query = (_a = input.query) !== null && _a !== void 0 ? _a : [
                input.task.title,
                input.task.description,
                ...((_b = input.task.acceptanceCriteria) !== null && _b !== void 0 ? _b : []),
            ].filter(Boolean).join('\n');
            const memorySearch = (_d = (_c = this.deps.memorySearch) !== null && _c !== void 0 ? _c : this.deps.durableMemorySearch) !== null && _d !== void 0 ? _d : searchDurableMemoryForContext;
            const memoryTypes = (_e = input.memoryTypes) !== null && _e !== void 0 ? _e : ['policy', 'episodic', 'semantic', 'procedural'];
            const scope = (_f = input.memoryScope) !== null && _f !== void 0 ? _f : {
                visibility: input.projectId ? 'project' : 'workspace',
                workspaceId: input.workspaceId,
                projectId: input.projectId,
            };
            const results = [];
            for (const memoryType of memoryTypes) {
                const entries = yield memorySearch({
                    agentId: input.agentId,
                    query,
                    workspaceId: input.workspaceId,
                    projectId: input.projectId,
                    memoryType,
                    limit: (_g = input.memoryLimit) !== null && _g !== void 0 ? _g : 8,
                    audience: (_h = input.memoryAudience) !== null && _h !== void 0 ? _h : 'planner',
                });
                results.push(...entries);
            }
            const seen = new Set();
            const scoped = filterMemoryForScope(results, scope)
                .filter((entry) => {
                if (seen.has(entry.id))
                    return false;
                seen.add(entry.id);
                return true;
            })
                .sort(compareMemoryEntries);
            const policy = scoped.filter((entry) => entry.memoryType === 'policy');
            const projectMemory = scoped.filter(isProjectMemoryEntry);
            const nonPolicy = scoped.filter((entry) => entry.memoryType !== 'policy' && !isProjectMemoryEntry(entry));
            return [
                memorySection('memory_policy', 'Policy memory', 20, policy),
                memorySection('project_memory', 'Project memory', 65, projectMemory),
                memorySection('memory_working_set', 'Relevant memory', 70, nonPolicy),
            ].filter((section) => section !== undefined);
        });
    }
    collectRunEvidence(input) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!input.runId || !this.deps.artifactStore)
                return undefined;
            const artifactStore = this.deps.artifactStore;
            const [summaryArtifacts, sourceArtifacts, deliveryArtifacts, actorProofArtifacts] = yield Promise.all([
                artifactStore.list({ runId: input.runId, kind: 'summary' }),
                artifactStore.list({ runId: input.runId, kind: 'research_source_capture' }),
                artifactStore.list({ runId: input.runId, kind: 'delivery_evidence' }),
                this.collectActorWorkProofArtifacts(input.runId, artifactStore),
            ]);
            const artifacts = dedupeArtifacts([...summaryArtifacts, ...sourceArtifacts, ...deliveryArtifacts, ...actorProofArtifacts])
                .filter(isContextEvidenceArtifact)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
                .slice(0, EVIDENCE_ARTIFACT_LIMIT);
            if (artifacts.length === 0)
                return undefined;
            const items = yield Promise.all(artifacts.map((artifact) => readContextEvidenceArtifactSafe(artifactStore, artifact)));
            if (items.length === 0)
                return undefined;
            return makeSection({
                id: 'run_evidence',
                kind: 'evidence',
                title: 'Run evidence',
                priority: 58,
                content: { items },
                sources: artifacts.map((artifact) => (Object.assign(Object.assign({ kind: 'artifact', ref: artifact.id, role: 'evidence' }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { meta: {
                        artifactKind: contextEvidenceArtifactKind(artifact),
                        createdAt: artifact.createdAt,
                    } }))),
            });
        });
    }
    collectActorWorkProofArtifacts(runId, artifactStore) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const proofRunIds = new Set([runId]);
            for (const run of (_b = (_a = this.deps.runLedger) === null || _a === void 0 ? void 0 : _a.listRuns()) !== null && _b !== void 0 ? _b : []) {
                if (run.parent_run_id === runId)
                    proofRunIds.add(run.run_id);
            }
            const artifacts = yield Promise.all(Array.from(proofRunIds).sort().map((proofRunId) => artifactStore.list({ runId: proofRunId, kind: 'summary' })));
            return artifacts.flat().filter((artifact) => isActorWorkProofArtifactForRun(artifact, runId));
        });
    }
}
function isContextEvidenceArtifact(artifact) {
    return contextEvidenceArtifactKind(artifact) !== null;
}
function contextEvidenceArtifactKind(artifact) {
    var _a;
    const logicalKind = (_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['artifactKind'];
    if (logicalKind === 'research_evidence' || logicalKind === 'browser_smoke')
        return logicalKind;
    if (artifact.kind === 'research_source_capture' || logicalKind === 'research_source_capture')
        return 'research_source_capture';
    if (artifact.kind === 'delivery_evidence' || logicalKind === 'delivery_evidence')
        return 'delivery_evidence';
    if (logicalKind === 'actor_work_proof')
        return 'actor_work_proof';
    return null;
}
function dedupeArtifacts(artifacts) {
    const seen = new Set();
    const deduped = [];
    for (const artifact of artifacts) {
        if (seen.has(artifact.id))
            continue;
        seen.add(artifact.id);
        deduped.push(artifact);
    }
    return deduped;
}
function isActorWorkProofArtifactForRun(artifact, runId) {
    var _a;
    if (contextEvidenceArtifactKind(artifact) !== 'actor_work_proof')
        return false;
    return artifact.runId === runId || ((_a = artifact.meta) === null || _a === void 0 ? void 0 : _a['parentRunId']) === runId;
}
function readContextEvidenceArtifact(artifactStore, artifact) {
    return __awaiter(this, void 0, void 0, function* () {
        const artifactKind = contextEvidenceArtifactKind(artifact);
        if (artifactKind === 'research_evidence') {
            const snapshot = artifact.sha256
                ? yield artifactStore.readJSONVerified(artifact, artifact.sha256)
                : yield artifactStore.readJSON(artifact);
            return publicResearchEvidenceContext(artifact, snapshot);
        }
        if (artifactKind === 'research_source_capture') {
            const document = artifact.sha256
                ? yield artifactStore.readJSONVerified(artifact, artifact.sha256)
                : yield artifactStore.readJSON(artifact);
            return publicResearchSourceCaptureContext(artifact, document.snapshot);
        }
        if (artifactKind === 'browser_smoke') {
            const snapshot = artifact.sha256
                ? yield artifactStore.readJSONVerified(artifact, artifact.sha256)
                : yield artifactStore.readJSON(artifact);
            return publicBrowserSmokeContext(artifact, snapshot);
        }
        if (artifactKind === 'delivery_evidence') {
            const snapshot = artifact.sha256
                ? yield artifactStore.readJSONVerified(artifact, artifact.sha256)
                : yield artifactStore.readJSON(artifact);
            return publicDeliveryEvidenceContext(artifact, snapshot);
        }
        if (artifactKind === 'actor_work_proof') {
            const proof = artifact.sha256
                ? yield artifactStore.readJSONVerified(artifact, artifact.sha256)
                : yield artifactStore.readJSON(artifact);
            return publicActorWorkProofContext(artifact, proof);
        }
        throw new Error(`ContextCompiler: unsupported evidence artifact ${artifact.id}`);
    });
}
function readContextEvidenceArtifactSafe(artifactStore, artifact) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            return yield readContextEvidenceArtifact(artifactStore, artifact);
        }
        catch (error) {
            return Object.assign(Object.assign({ artifactKind: (_a = contextEvidenceArtifactKind(artifact)) !== null && _a !== void 0 ? _a : 'unknown', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: artifact.createdAt, status: 'evidence_unavailable', reason: sanitizeContextEvidenceText(error instanceof Error ? error.message : String(error), 200) });
        }
    });
}
function publicResearchEvidenceContext(artifact, snapshot) {
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ artifactKind: 'research_evidence', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: snapshot.createdAt, sourceMode: snapshot.sourceMode, queryHash: snapshot.queryHash, queryPreview: sanitizeContextEvidenceText(snapshot.query, 160), sourceCount: snapshot.sources.length, sources: snapshot.sources.slice(0, EVIDENCE_SOURCE_LIMIT).map((source) => (Object.assign(Object.assign(Object.assign({ host: hostFromHttpUrl(source.url), urlHash: hashText(source.url) }, (source.title ? { title: sanitizeContextEvidenceText(source.title, 160) } : {})), (source.snippet ? { snippet: sanitizeContextEvidenceText(source.snippet, EVIDENCE_TEXT_LIMIT) } : {})), (source.observedAt ? { observedAt: sanitizeContextEvidenceText(source.observedAt, 80) } : {})))) }), (snapshot.summary ? { summary: sanitizeContextEvidenceText(snapshot.summary, EVIDENCE_TEXT_LIMIT) } : {})), (snapshot.conclusion ? { conclusion: sanitizeContextEvidenceText(snapshot.conclusion, EVIDENCE_TEXT_LIMIT) } : {})), { notes: snapshot.notes.slice(0, 3).map((note) => sanitizeContextEvidenceText(note, 200)), effects: snapshot.effectsExecuted.map((effect) => ({
            kind: effect.kind,
            provider: effect.provider,
            executedAt: effect.executedAt,
            maxResults: effect.maxResults,
            resultCount: effect.resultCount,
        })) });
}
function publicResearchSourceCaptureContext(artifact, snapshot) {
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ artifactKind: 'research_source_capture', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: snapshot.createdAt, sourceMode: snapshot.sourceMode, requestedHost: snapshot.requestedHost, requestedUrlHash: snapshot.requestedUrlHash, requestedPathHash: snapshot.requestedPathHash, finalHost: snapshot.finalHost, finalUrlHash: snapshot.finalUrlHash, statusCode: snapshot.statusCode, contentType: snapshot.contentType, contentHash: snapshot.contentHash, capturedBytes: snapshot.capturedBytes, truncated: snapshot.truncated }), (snapshot.title ? { title: sanitizeContextEvidenceText(snapshot.title, 160) } : {})), { excerpt: sanitizeContextEvidenceText(snapshot.excerpt, EVIDENCE_TEXT_LIMIT) }), (snapshot.note ? { note: sanitizeContextEvidenceText(snapshot.note, 200) } : {}));
}
function publicBrowserSmokeContext(artifact, snapshot) {
    return Object.assign(Object.assign(Object.assign({ artifactKind: 'browser_smoke', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: snapshot.createdAt, sourceMode: snapshot.sourceMode, status: snapshot.status, targetHost: snapshot.targetHost, targetUrlHash: snapshot.targetUrlHash, targetPathHash: snapshot.targetPathHash, finalHost: snapshot.finalHost, finalUrlHash: snapshot.finalUrlHash, title: sanitizeContextEvidenceText(snapshot.title, 160), screenshotArtifactId: snapshot.screenshot.artifactId }), (snapshot.assertion ? {
        assertion: Object.assign(Object.assign(Object.assign({}, (snapshot.assertion.selector ? { selector: sanitizeContextEvidenceText(snapshot.assertion.selector, 120) } : {})), (snapshot.assertion.containsTextHash ? { containsTextHash: snapshot.assertion.containsTextHash } : {})), { matched: snapshot.assertion.matched }),
    } : {}));
}
function publicDeliveryEvidenceContext(artifact, snapshot) {
    var _a;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ artifactKind: 'delivery_evidence', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: snapshot.capturedAt, verifierStatus: snapshot.verifierStatus }), (snapshot.summary ? { summary: sanitizeContextEvidenceText(snapshot.summary, EVIDENCE_TEXT_LIMIT) } : {})), (snapshot.deliveryArtifactId ? { deliveryArtifactId: snapshot.deliveryArtifactId } : {})), { deliveryChecklist: snapshot.deliveryChecklist.slice(0, 5).map((item) => sanitizeContextEvidenceText(item, 160)), verifier: snapshot.verifier ? Object.assign(Object.assign(Object.assign(Object.assign({ status: snapshot.verifier.status }, (snapshot.verifier.rawStatus ? { rawStatus: snapshot.verifier.rawStatus } : {})), (snapshot.verifier.waivedFrom ? { waivedFrom: snapshot.verifier.waivedFrom } : {})), (snapshot.verifier.waiverArtifactId ? { waiverArtifactId: snapshot.verifier.waiverArtifactId } : {})), (snapshot.verifier.reason ? { reason: sanitizeContextEvidenceText(snapshot.verifier.reason, 200) } : {})) : undefined, git: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ available: snapshot.git.available }, (snapshot.git.branch ? { branch: sanitizeContextEvidenceText(snapshot.git.branch, 120) } : {})), (snapshot.git.headSha ? { headSha: snapshot.git.headSha } : {})), { ahead: snapshot.git.ahead, behind: snapshot.git.behind, dirtyFileCount: snapshot.git.dirtyFiles.length, latestCommits: snapshot.git.latestCommits.slice(0, 3).map((commit) => (Object.assign({ sha: commit.sha, subject: sanitizeContextEvidenceText(commit.subject, 160) }, (commit.author ? { author: sanitizeContextEvidenceText(commit.author, 120) } : {})))) }), (((_a = snapshot.git.remote) === null || _a === void 0 ? void 0 : _a.repository) ? { remoteRepository: sanitizeContextEvidenceText(snapshot.git.remote.repository, 120) } : {})), (snapshot.git.error ? { error: sanitizeContextEvidenceText(snapshot.git.error, 200) } : {})), github: Object.assign(Object.assign({ available: snapshot.github.available }, (snapshot.github.repository ? { repository: sanitizeContextEvidenceText(snapshot.github.repository, 120) } : {})), { branch: snapshot.github.branch ? Object.assign(Object.assign({ name: sanitizeContextEvidenceText(snapshot.github.branch.name, 120), protected: snapshot.github.branch.protected }, (snapshot.github.branch.commitSha ? { commitSha: snapshot.github.branch.commitSha } : {})), (snapshot.github.branch.url ? { urlHost: hostFromHttpUrl(snapshot.github.branch.url), urlHash: hashText(snapshot.github.branch.url) } : {})) : null, pullRequests: snapshot.github.pullRequests.slice(0, 3).map((pullRequest) => (Object.assign(Object.assign(Object.assign(Object.assign({ number: pullRequest.number, state: pullRequest.state }, (pullRequest.title ? { title: sanitizeContextEvidenceText(pullRequest.title, 160) } : {})), (pullRequest.headRef ? { headRef: sanitizeContextEvidenceText(pullRequest.headRef, 120) } : {})), (pullRequest.baseRef ? { baseRef: sanitizeContextEvidenceText(pullRequest.baseRef, 120) } : {})), { urlHost: hostFromHttpUrl(pullRequest.url), urlHash: hashText(pullRequest.url) }))), workflowRuns: snapshot.github.workflowRuns.slice(0, 3).map((workflowRun) => (Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: workflowRun.id }, (workflowRun.name ? { name: sanitizeContextEvidenceText(workflowRun.name, 120) } : {})), (workflowRun.status ? { status: workflowRun.status } : {})), (workflowRun.conclusion !== undefined ? { conclusion: workflowRun.conclusion } : {})), (workflowRun.headSha ? { headSha: workflowRun.headSha } : {})), (workflowRun.url ? { urlHost: hostFromHttpUrl(workflowRun.url), urlHash: hashText(workflowRun.url) } : {})))), issue: snapshot.github.issue ? Object.assign(Object.assign(Object.assign({ number: snapshot.github.issue.number }, (snapshot.github.issue.state ? { state: snapshot.github.issue.state } : {})), (snapshot.github.issue.title ? { title: sanitizeContextEvidenceText(snapshot.github.issue.title, 160) } : {})), (snapshot.github.issue.url ? { urlHost: hostFromHttpUrl(snapshot.github.issue.url), urlHash: hashText(snapshot.github.issue.url) } : {})) : null, errors: snapshot.github.errors.slice(0, 3).map((error) => (Object.assign(Object.assign({ scope: sanitizeContextEvidenceText(error.scope, 120) }, (error.status !== undefined ? { status: error.status } : {})), { message: sanitizeContextEvidenceText(error.message, 200) }))) }) });
}
function publicActorWorkProofContext(artifact, proof) {
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ artifactKind: 'actor_work_proof', artifactId: artifact.id }, (artifact.sha256 ? { sha256: artifact.sha256 } : {})), { createdAt: proof.completedAt, runId: proof.runId, proofRunId: proof.proofRunId, actorId: sanitizeContextEvidenceText(proof.actorId, 120), nodeId: sanitizeContextEvidenceText(proof.nodeId, 120) }), (proof.owner ? { owner: sanitizeContextEvidenceText(proof.owner, 120) } : {})), (proof.task !== undefined ? { task: sanitizeContextEvidenceText(proof.task, 200) } : {})), (proof.summary ? { summary: sanitizeContextEvidenceText(proof.summary, EVIDENCE_TEXT_LIMIT) } : {})), (proof.output ? { output: sanitizeContextEvidenceText(proof.output, EVIDENCE_TEXT_LIMIT) } : {}));
}
function inputWorkspace(deps) {
    var _a, _b, _c;
    return (_c = (_a = deps.workspace) !== null && _a !== void 0 ? _a : (_b = deps.workspaceLoader) === null || _b === void 0 ? void 0 : _b.getWorkspace()) !== null && _c !== void 0 ? _c : null;
}
function collectPolicySection(workspace, policyFacts) {
    const workspacePolicy = workspace
        ? [
            { path: 'AGENTS.md', content: workspace.files.agents },
            { path: 'TOOLS.md', content: workspace.files.tools },
        ].filter((file) => file.content.length > 0)
        : [];
    if (workspacePolicy.length === 0 && policyFacts.length === 0)
        return undefined;
    const facts = [...policyFacts].sort((a, b) => a.id.localeCompare(b.id));
    return makeSection({
        id: 'policy',
        kind: 'policy',
        title: 'Policy and tool constraints',
        priority: 15,
        content: {
            workspaceFiles: workspacePolicy,
            facts: facts.map((fact) => ({ id: fact.id, content: fact.content })),
        },
        sources: [
            ...workspacePolicy.map((file) => ({
                kind: 'workspace_file',
                ref: file.path,
                role: 'policy',
            })),
            ...facts.map((fact) => {
                var _a;
                return (_a = fact.source) !== null && _a !== void 0 ? _a : ({
                    kind: 'policy',
                    ref: fact.id,
                    role: 'policy',
                });
            }),
        ],
    });
}
function collectWorkspaceSection(workspace) {
    if (!workspace)
        return undefined;
    const files = [
        { path: 'IDENTITY.md', content: workspace.files.identity },
        { path: 'SOUL.md', content: workspace.files.soul },
        { path: 'USER.md', content: workspace.files.user },
        { path: 'MEMORY.md', content: workspace.files.memory },
        { path: 'HEARTBEAT.md', content: workspace.files.heartbeat },
        ...Array.from(workspace.files.daily.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, content]) => ({ path: `memory/${date}.md`, content })),
        ...workspace.files.skills.map((content, index) => ({ path: `SKILL-${index}.md`, content })),
    ].filter((file) => file.content.length > 0);
    if (files.length === 0)
        return undefined;
    return makeSection({
        id: 'workspace_files',
        kind: 'workspace',
        title: 'Workspace memory files',
        priority: 30,
        content: files,
        sources: files.map((file) => ({ kind: 'workspace_file', ref: file.path, role: 'input' })),
    });
}
function collectFilesOfInterest(filesOfInterest) {
    const files = [...filesOfInterest].sort((a, b) => a.path.localeCompare(b.path));
    if (files.length === 0)
        return undefined;
    return makeSection({
        id: 'files_of_interest',
        kind: 'files',
        title: 'Files of interest',
        priority: 40,
        content: files,
        sources: files.map((file) => ({
            kind: 'file',
            ref: file.path,
            role: 'input',
            sha256: file.sha256,
        })),
    });
}
function collectDependencyGraph(dag) {
    var _a;
    const nodes = (_a = dag === null || dag === void 0 ? void 0 : dag.listNodes().sort((a, b) => a.id.localeCompare(b.id))) !== null && _a !== void 0 ? _a : [];
    if (nodes.length === 0)
        return undefined;
    return makeSection({
        id: 'dependency_graph',
        kind: 'dag',
        title: 'Dependency graph',
        priority: 55,
        content: nodes.map((node) => ({
            id: node.id,
            kind: node.kind,
            status: node.status,
            dependsOn: [...node.dependsOn].sort(),
            attempts: node.attempts,
            provenance: node.provenance,
        })),
        sources: nodes.map((node) => ({ kind: 'dag_node', ref: node.id, role: 'evidence' })),
    });
}
function collectDomainFacts(domainFacts) {
    const facts = [...domainFacts].sort((a, b) => a.id.localeCompare(b.id));
    if (facts.length === 0)
        return undefined;
    return makeSection({
        id: 'domain_facts',
        kind: 'domain',
        title: 'Domain facts',
        priority: 80,
        content: facts.map((fact) => ({ id: fact.id, content: fact.content })),
        sources: facts.map((fact) => {
            var _a;
            return (_a = fact.source) !== null && _a !== void 0 ? _a : ({
                kind: 'domain_fact',
                ref: fact.id,
                role: 'input',
            });
        }),
    });
}
const SENSITIVE_CONTEXT_TEXT_RE = /\b(?:gh[pousr]_[A-Za-z0-9_-]+|github_pat_[A-Za-z0-9_]+)\b|\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_.-]*(?:token|secret|password|passwd|credential|signature|authorization|api[-_]?key|access[-_]?key|awsaccesskeyid|key[-_]?pair[-_]?id)[A-Za-z0-9_.-]*)\s*[:=]\s*(?:"[^"]*"|'[^']*'|`[^`]*`|[^\s,;\n]+)/gi;
function hashText(value) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
}
function sanitizeContextEvidenceText(value, maxChars) {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    return raw
        .replace(/https?:\/\/[^\s'"`<>),]+/gi, (match) => {
        const host = hostFromHttpUrl(match);
        return host ? `[redacted-url host=${host} hash=${hashText(match).slice(0, 16)}]` : '[redacted-url]';
    })
        .replace(SENSITIVE_CONTEXT_TEXT_RE, '[redacted-token]')
        .replace(SECRET_ASSIGNMENT_RE, '$1=[redacted]')
        .replace(/file:\/\/[^\s'"`<>),]+/g, '[redacted-file-uri]')
        .replace(/\b[A-Za-z]:\\[^\s'"`<>),]+/g, '[redacted-path]')
        .replace(/\\\\[^\s\\/"'`<>),]+\\[^\s'"`<>),]+/g, '[redacted-path]')
        .replace(/(^|[^:])\/\/(?:Users|home|var|tmp|private|Volumes)\b[^\s'"`<>),]*/g, '$1/[redacted-path]')
        .replace(/(^|[\s'"`(=:-])\/(?!\/)(?=[^\s'"`<>),]*\/)[^\s'"`<>),]+/g, '$1[redacted-path]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxChars);
}
function hostFromHttpUrl(value) {
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return undefined;
        return parsed.host;
    }
    catch (_a) {
        return undefined;
    }
}
function memorySection(id, title, priority, entries) {
    if (entries.length === 0)
        return undefined;
    const content = entries.map((entry) => {
        var _a, _b, _c, _d, _e, _f;
        return ({
            id: entry.id,
            memoryType: entry.memoryType,
            projectMemoryCategory: typeof ((_a = entry.metadata) === null || _a === void 0 ? void 0 : _a.projectMemoryCategory) === 'string'
                ? entry.metadata.projectMemoryCategory
                : undefined,
            content: entry.content,
            summary: entry.summary,
            importance: entry.importance,
            provenance: (_b = entry.metadata) === null || _b === void 0 ? void 0 : _b.provenance,
            scope: (_c = entry.metadata) === null || _c === void 0 ? void 0 : _c.scope,
            confidence: (_d = entry.metadata) === null || _d === void 0 ? void 0 : _d.confidence,
            lastValidatedAt: (_e = entry.metadata) === null || _e === void 0 ? void 0 : _e.lastValidatedAt,
            frozen: (_f = entry.metadata) === null || _f === void 0 ? void 0 : _f.frozen,
        });
    });
    return makeSection({
        id,
        kind: 'memory',
        title,
        priority,
        content,
        sources: entries.map((entry) => ({ kind: 'memory', ref: entry.id, role: 'memory' })),
    });
}
function isProjectMemoryEntry(entry) {
    var _a;
    return typeof ((_a = entry.metadata) === null || _a === void 0 ? void 0 : _a.projectMemoryCategory) === 'string';
}
function makeSection(input) {
    return Object.assign(Object.assign({}, input), { sources: [...input.sources].sort(compareSourceRefs) });
}
function cloneSessionMessages(messages) {
    return messages
        .map((message) => {
        var _a;
        return (Object.assign(Object.assign({}, message), { toolCalls: (_a = message.toolCalls) === null || _a === void 0 ? void 0 : _a.map((toolCall) => (Object.assign({}, toolCall))), metadata: message.metadata ? Object.assign({}, message.metadata) : undefined }));
    })
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
function compareSections(a, b) {
    return a.priority - b.priority || a.id.localeCompare(b.id);
}
function compareSourceRefs(a, b) {
    return (a.kind.localeCompare(b.kind) ||
        a.ref.localeCompare(b.ref) ||
        a.role.localeCompare(b.role));
}
function compareMemoryEntries(a, b) {
    if (a.memoryType !== b.memoryType) {
        const rank = { policy: 0, semantic: 1, procedural: 2, episodic: 3 };
        return rank[a.memoryType] - rank[b.memoryType];
    }
    return b.importance - a.importance || a.id.localeCompare(b.id);
}
export { hashContextPack };

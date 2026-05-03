var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { filterMemoryForScope, searchDurableMemoryForContext, } from '../ai/memory/agent-memory-store.js';
import { hashContextPack, stableStringify, withContextPackHash, } from './context-pack.js';
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
            var _a, _b, _c, _d, _e, _f, _g;
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

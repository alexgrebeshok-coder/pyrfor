var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { storeMemory } from '../ai/memory/agent-memory-store.js';
const CATEGORY_DEFS = [
    { category: 'decision', memoryType: 'semantic', title: 'Decisions', importance: 0.9 },
    { category: 'convention', memoryType: 'procedural', title: 'Conventions', importance: 0.82 },
    { category: 'risk', memoryType: 'semantic', title: 'Risks', importance: 0.88 },
    { category: 'active_thread', memoryType: 'episodic', title: 'Active threads', importance: 0.78 },
    { category: 'unresolved_task', memoryType: 'semantic', title: 'Unresolved tasks', importance: 0.86 },
];
export function createProjectMemoryRollup(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        if (!input.projectId.trim())
            throw new Error('Project memory rollup requires projectId');
        const agentId = (_a = input.agentId) !== null && _a !== void 0 ? _a : 'pyrfor-runtime';
        const createdAt = ((_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date()))().toISOString();
        const sessions = (yield deps.sessionStore.list(input.workspaceId, {
            limit: (_c = input.sessionLimit) !== null && _c !== void 0 ? _c : 200,
            orderBy: 'updatedAt',
            direction: 'desc',
        })).filter((session) => sessionProjectId(session) === input.projectId);
        const allEvents = yield readLedgerEvents(deps.eventLedger);
        const projectRunIds = mapProjectRunIds(allEvents, sessions, input.projectId);
        const ledgerEvents = allEvents.filter((event) => event.run_id && projectRunIds.has(event.run_id));
        const runIds = [...projectRunIds].sort();
        const categoryContents = buildCategoryContents({ sessions, ledgerEvents, runIds, projectId: input.projectId });
        const artifact = deps.artifactStore
            ? yield deps.artifactStore.writeJSON('summary', {
                schemaVersion: 'project_memory_rollup.v1',
                createdAt,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                agentId,
                sessionIds: sessions.map((session) => session.id),
                runIds,
                categories: categoryContents,
            }, {
                meta: {
                    memoryKind: 'project_rollup',
                    workspaceId: input.workspaceId,
                    projectId: input.projectId,
                    agentId,
                },
            })
            : undefined;
        const memories = [];
        for (const def of CATEGORY_DEFS) {
            const content = categoryContents[def.category];
            const summary = `${def.title} for project ${input.projectId}: ${firstContentLine(content)}`;
            const memoryId = yield ((_d = deps.memoryWriter) !== null && _d !== void 0 ? _d : storeMemory)({
                agentId,
                workspaceId: input.workspaceId,
                projectId: input.projectId,
                memoryType: def.memoryType,
                content,
                summary,
                importance: def.importance,
                metadata: {
                    projectMemoryCategory: def.category,
                    rollupKind: 'project',
                    scope: {
                        visibility: 'project',
                        workspaceId: input.workspaceId,
                        projectId: input.projectId,
                    },
                    confidence: 0.72,
                    provenance: [
                        ...sessions.map((session) => ({ kind: 'session', ref: session.id, ts: session.updatedAt })),
                        ...ledgerEvents.slice(-50).map((event) => ({ kind: 'ledger_event', ref: event.id, ts: event.ts })),
                        ...(artifact ? [{ kind: 'artifact', ref: artifact.id, ts: artifact.createdAt }] : []),
                    ],
                },
            });
            if (memoryId === 'short-term-only')
                throw new Error('Project memory rollup was not durably persisted');
            memories.push({ category: def.category, memoryType: def.memoryType, summary, content, memoryId });
        }
        return Object.assign(Object.assign({ workspaceId: input.workspaceId, projectId: input.projectId, agentId, sessionCount: sessions.length, ledgerEventCount: ledgerEvents.length, runIds }, (artifact ? { artifact } : {})), { memories });
    });
}
function buildCategoryContents(input) {
    const sessionSummaries = input.sessions.map((session) => { var _a; return `- ${session.title} (${session.id}): ${(_a = session.summary) !== null && _a !== void 0 ? _a : summarizeRecentMessages(session)}`; });
    const decisionEvents = input.ledgerEvents.filter((event) => event.type.includes('approval') || event.type === 'verifier.waived');
    const blockedEvents = input.ledgerEvents.filter((event) => event.type === 'run.blocked' || event.type === 'run.failed' || event.type === 'dag.node.failed');
    const textLines = input.sessions.flatMap((session) => session.messages.map((message) => message.content));
    return {
        decision: sectionContent('decision', input.projectId, [
            ...matchingLines(textLines, /\b(decid|approved|approval|waiv)\w*/i),
            ...decisionEvents.map((event) => eventLine(event)),
        ]),
        convention: sectionContent('convention', input.projectId, matchingLines(textLines, /\b(always|never|must|convention|policy)\b/i)),
        risk: sectionContent('risk', input.projectId, [
            ...matchingLines(textLines, /\b(risk|block|fail)\w*/i),
            ...blockedEvents.map((event) => eventLine(event)),
        ]),
        active_thread: sectionContent('active_thread', input.projectId, [
            ...sessionSummaries,
            ...(input.runIds.length > 0 ? [`- Active/recent project runs: ${input.runIds.join(', ')}`] : []),
        ]),
        unresolved_task: sectionContent('unresolved_task', input.projectId, [
            ...matchingLines(textLines, /\b(todo|next|continue|remaining)\w*/i),
            ...blockedEvents.map((event) => `- Follow up ${event.run_id}: ${eventLine(event)}`),
        ]),
    };
}
function sectionContent(category, projectId, lines) {
    const unique = [...new Set(lines.map((line) => line.trim()).filter(Boolean))].slice(0, 12);
    const body = unique.length > 0 ? unique : [`- No explicit ${category.replace('_', ' ')} facts detected yet.`];
    return [`# Pyrfor project memory: ${category}`, `Project: ${projectId}`, '', ...body].join('\n');
}
function matchingLines(lines, pattern) {
    return lines
        .filter((line) => pattern.test(line))
        .map((line) => `- ${truncateLine(line, 220)}`);
}
function eventLine(event) {
    var _a, _b;
    const reason = (_b = (_a = event.reason) !== null && _a !== void 0 ? _a : event.error) !== null && _b !== void 0 ? _b : event.status;
    return `- ${event.type} for ${event.run_id}${typeof reason === 'string' ? `: ${truncateLine(reason, 160)}` : ''}`;
}
function summarizeRecentMessages(session) {
    const messages = session.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-4)
        .map((message) => `${message.role}: ${truncateLine(message.content, 120)}`);
    return messages.length > 0 ? messages.join(' | ') : 'No conversational messages.';
}
function sessionProjectId(session) {
    var _a;
    const projectId = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.projectId;
    return typeof projectId === 'string' ? projectId : undefined;
}
function readLedgerEvents(eventLedger) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!eventLedger)
            return [];
        return eventLedger.readAll();
    });
}
function mapProjectRunIds(events, sessions, projectId) {
    var _a;
    const runIds = new Set(sessions.map((session) => session.runId).filter((runId) => typeof runId === 'string'));
    for (const event of events) {
        const eventProjectId = (_a = event.projectId) !== null && _a !== void 0 ? _a : event.project_id;
        if (event.run_id && eventProjectId === projectId)
            runIds.add(event.run_id);
    }
    return runIds;
}
function firstContentLine(content) {
    var _a, _b;
    return (_b = (_a = content.split('\n').find((line) => line.startsWith('- '))) === null || _a === void 0 ? void 0 : _a.slice(2)) !== null && _b !== void 0 ? _b : 'no explicit facts yet';
}
function truncateLine(value, maxChars) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

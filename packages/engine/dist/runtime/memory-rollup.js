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
export function createDailyMemoryRollup(deps, input) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const date = (_a = input.date) !== null && _a !== void 0 ? _a : toDateKey(((_b = deps.now) !== null && _b !== void 0 ? _b : (() => new Date()))());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
            throw new Error(`Invalid daily rollup date: ${date}`);
        const agentId = (_c = input.agentId) !== null && _c !== void 0 ? _c : 'pyrfor-runtime';
        const sessions = (yield deps.sessionStore.list(input.workspaceId, {
            mode: 'chat',
            limit: (_d = input.sessionLimit) !== null && _d !== void 0 ? _d : 200,
            orderBy: 'updatedAt',
            direction: 'desc',
        })).filter((session) => sessionTouchesDate(session, date));
        const allLedgerEvents = yield readLedgerEvents(deps.eventLedger);
        const runWorkspaceIds = mapRunWorkspaceIds(allLedgerEvents);
        const dailyLedgerEvents = allLedgerEvents.filter((event) => event.ts.startsWith(date));
        const ledgerEvents = filterWorkspaceEvents(dailyLedgerEvents, input.workspaceId, runWorkspaceIds);
        const runIds = [...new Set(ledgerEvents.map((event) => event.run_id).filter(Boolean))].sort();
        const messageCount = sessions.reduce((sum, session) => sum + session.messages.length, 0);
        const summary = `Daily rollup for ${date}: ${sessions.length} sessions, ${messageCount} messages, ${ledgerEvents.length} ledger events.`;
        const content = renderDailyRollup({
            date,
            workspaceId: input.workspaceId,
            sessions,
            ledgerEvents,
            runIds,
            summary,
        });
        const artifact = deps.artifactStore
            ? yield deps.artifactStore.writeJSON('summary', {
                schemaVersion: 'memory_daily_rollup.v1',
                date,
                workspaceId: input.workspaceId,
                agentId,
                projectId: input.projectId,
                summary,
                content,
                sessionIds: sessions.map((session) => session.id),
                runIds,
            }, {
                meta: Object.assign({ memoryKind: 'daily_rollup', workspaceId: input.workspaceId, agentId,
                    date }, (input.projectId ? { projectId: input.projectId } : {})),
            })
            : undefined;
        const memoryId = yield ((_e = deps.memoryWriter) !== null && _e !== void 0 ? _e : storeMemory)({
            agentId,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            memoryType: 'semantic',
            content,
            summary,
            importance: 0.85,
            metadata: {
                rollupKind: 'daily',
                date,
                scope: Object.assign({ visibility: input.projectId ? 'project' : 'workspace', workspaceId: input.workspaceId }, (input.projectId ? { projectId: input.projectId } : {})),
                confidence: 0.75,
                provenance: [
                    ...sessions.map((session) => ({ kind: 'session', ref: session.id, ts: session.updatedAt })),
                    ...ledgerEvents.slice(-50).map((event) => ({ kind: 'ledger_event', ref: event.id, ts: event.ts })),
                    ...(artifact ? [{ kind: 'artifact', ref: artifact.id, ts: artifact.createdAt }] : []),
                ],
            },
        });
        if (memoryId === 'short-term-only') {
            throw new Error('Daily memory rollup was not durably persisted');
        }
        return Object.assign({ date, workspaceId: input.workspaceId, agentId, sessionCount: sessions.length, messageCount, ledgerEventCount: ledgerEvents.length, runIds,
            summary,
            content,
            memoryId }, (artifact ? { artifact } : {}));
    });
}
function renderDailyRollup(input) {
    const lines = [
        `# Pyrfor daily memory rollup — ${input.date}`,
        '',
        input.summary,
        `Workspace: ${input.workspaceId}`,
        '',
        '## Sessions',
        ...sessionLines(input.sessions),
        '',
        '## Runs and ledger',
        ...ledgerLines(input.ledgerEvents, input.runIds),
        '',
        '## Next-session continuity hints',
        ...continuityHints(input.sessions, input.ledgerEvents),
    ];
    return lines.join('\n').trim();
}
function sessionLines(sessions) {
    if (sessions.length === 0)
        return ['- No chat sessions touched this date.'];
    return sessions.slice(0, 20).map((session) => {
        var _a;
        const summary = (_a = session.summary) !== null && _a !== void 0 ? _a : summarizeRecentMessages(session);
        return `- ${session.title} (${session.id}): ${session.messages.length} messages. ${summary}`;
    });
}
function ledgerLines(events, runIds) {
    var _a;
    if (events.length === 0)
        return ['- No ledger events recorded this date.'];
    const counts = new Map();
    for (const event of events)
        counts.set(event.type, ((_a = counts.get(event.type)) !== null && _a !== void 0 ? _a : 0) + 1);
    const typeCounts = [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([type, count]) => `${type}:${count}`)
        .join(', ');
    return [
        `- Runs: ${runIds.join(', ') || 'none'}`,
        `- Event counts: ${typeCounts}`,
    ];
}
function continuityHints(sessions, events) {
    const hints = new Set();
    for (const session of sessions) {
        const lastUserMessage = [...session.messages].reverse().find((message) => message.role === 'user');
        if (lastUserMessage === null || lastUserMessage === void 0 ? void 0 : lastUserMessage.content)
            hints.add(`Resume from session "${session.title}": ${truncateLine(lastUserMessage.content, 180)}`);
    }
    const blockedRuns = events.filter((event) => event.type === 'run.blocked' || event.type === 'dag.node.failed' || event.type === 'run.failed');
    for (const event of blockedRuns)
        hints.add(`Review blocked/failed run ${event.run_id} (${event.type}).`);
    return hints.size > 0 ? [...hints].slice(0, 10).map((hint) => `- ${hint}`) : ['- No explicit follow-up hints detected.'];
}
function summarizeRecentMessages(session) {
    const messages = session.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-4)
        .map((message) => `${message.role}: ${truncateLine(message.content, 120)}`);
    return messages.length > 0 ? messages.join(' | ') : 'No conversational messages.';
}
function sessionTouchesDate(session, date) {
    if (session.updatedAt.startsWith(date) || session.createdAt.startsWith(date))
        return true;
    return session.messages.some((message) => message.createdAt.startsWith(date));
}
function readLedgerEvents(eventLedger) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!eventLedger)
            return [];
        return eventLedger.readAll();
    });
}
function mapRunWorkspaceIds(events) {
    const map = new Map();
    for (const event of events) {
        const eventWorkspaceId = event.workspace_id;
        if (event.run_id && typeof eventWorkspaceId === 'string')
            map.set(event.run_id, eventWorkspaceId);
    }
    return map;
}
function filterWorkspaceEvents(events, workspaceId, runWorkspaceIds) {
    return events.filter((event) => {
        const eventWorkspaceId = event.workspace_id;
        if (typeof eventWorkspaceId === 'string')
            return eventWorkspaceId === workspaceId;
        return Boolean(event.run_id && runWorkspaceIds.get(event.run_id) === workspaceId);
    });
}
function toDateKey(date) {
    return date.toISOString().slice(0, 10);
}
function truncateLine(value, maxChars) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`;
}

var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
import { randomUUID } from 'node:crypto';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function extractMessageText(content) {
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return null;
    const parts = content
        .map((entry) => {
        if (!isRecord(entry))
            return null;
        return entry.type === 'text' && typeof entry.text === 'string' ? entry.text : null;
    })
        .filter((entry) => typeof entry === 'string');
    return parts.length > 0 ? parts.join('\n') : null;
}
function normalizeOpenFiles(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = value.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.path !== 'string' || typeof entry.content !== 'string')
            return [];
        return [Object.assign({ path: entry.path, content: entry.content }, (typeof entry.language === 'string' ? { language: entry.language } : {}))];
    });
    return out.length > 0 ? out : undefined;
}
export function parseAgUiRunRequest(body) {
    var _a;
    if (!isRecord(body))
        return { ok: false, error: 'invalid_json' };
    const messages = Array.isArray(body.messages)
        ? body.messages.filter((entry) => isRecord(entry))
        : [];
    const promptText = typeof body.text === 'string'
        ? body.text
        : [...messages].reverse().flatMap((message) => {
            if (message.role !== 'user')
                return [];
            const text = extractMessageText(message.content);
            return text ? [text] : [];
        })[0];
    if (typeof promptText !== 'string' || promptText.trim() === '') {
        return { ok: false, error: 'text_required' };
    }
    const forwardedProps = isRecord(body.forwardedProps) ? body.forwardedProps : {};
    const conceptBody = isRecord(body.concept) ? body.concept : undefined;
    const concept = conceptBody
        ? Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (typeof conceptBody.conceptId === 'string' ? { conceptId: conceptBody.conceptId } : {})), (typeof conceptBody.projectId === 'string' ? { projectId: conceptBody.projectId } : {})), (typeof conceptBody.parentConceptId === 'string' ? { parentConceptId: conceptBody.parentConceptId } : {})), (typeof conceptBody.retryOf === 'string' ? { retryOf: conceptBody.retryOf } : {})), (typeof conceptBody.dryRun === 'boolean' ? { dryRun: conceptBody.dryRun } : {})), (Array.isArray(conceptBody.strategies)
            ? {
                strategies: conceptBody.strategies.filter((entry) => typeof entry === 'string' && entry.trim().length > 0),
            }
            : {})) : undefined;
    const openFiles = normalizeOpenFiles(body.openFiles);
    return {
        ok: true,
        input: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (body.mode === 'chat' || body.mode === 'concept' ? { mode: body.mode } : {})), (typeof body.threadId === 'string' ? { threadId: body.threadId } : {})), (typeof body.runId === 'string' ? { runId: body.runId } : {})), (typeof body.parentRunId === 'string' ? { parentRunId: body.parentRunId } : {})), { state: (_a = body.state) !== null && _a !== void 0 ? _a : {}, messages, tools: Array.isArray(body.tools) ? body.tools : [], context: Array.isArray(body.context) ? body.context : [], forwardedProps,
            promptText }), (typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {})), (typeof body.workspace === 'string' ? { workspace: body.workspace } : {})), (openFiles ? { openFiles } : {})), (body.prefer === 'local' || body.prefer === 'cloud' || body.prefer === 'auto' ? { prefer: body.prefer } : {})), (isRecord(body.routingHints) ? { routingHints: body.routingHints } : {})), (typeof body.exposeToolPayloads === 'boolean' ? { exposeToolPayloads: body.exposeToolPayloads } : {})), (concept && Object.keys(concept).length > 0 ? { concept } : {})),
    };
}
function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}
function formatPayload(value) {
    if (typeof value === 'string')
        return value;
    if (value === undefined)
        return 'null';
    try {
        return JSON.stringify(value);
    }
    catch (_a) {
        return String(value);
    }
}
function getErrorMessage(error) {
    if (error instanceof Error)
        return error.message;
    if (isRecord(error) && typeof error.message === 'string')
        return error.message;
    return String(error);
}
function toInterrupts(error) {
    const record = isRecord(error) ? error : undefined;
    const candidate = Array.isArray(record === null || record === void 0 ? void 0 : record.interrupts)
        ? record.interrupts
        : isRecord(record === null || record === void 0 ? void 0 : record.outcome) && record.outcome.type === 'interrupt' && Array.isArray(record.outcome.interrupts)
            ? record.outcome.interrupts
            : null;
    if (!candidate || candidate.length === 0)
        return null;
    const interrupts = candidate.flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.reason !== 'string')
            return [];
        return [Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ id: entry.id, reason: entry.reason }, (typeof entry.message === 'string' ? { message: entry.message } : {})), (typeof entry.toolCallId === 'string' ? { toolCallId: entry.toolCallId } : {})), ('responseSchema' in entry ? { responseSchema: entry.responseSchema } : {})), (typeof entry.expiresAt === 'string' ? { expiresAt: entry.expiresAt } : {})), (isRecord(entry.metadata) ? { metadata: entry.metadata } : {}))];
    });
    return interrupts.length > 0 ? interrupts : null;
}
function createInitialState(request, threadId, runId) {
    return {
        threadId,
        runId,
        status: 'running',
        request: Object.assign(Object.assign({ text: request.promptText }, (request.workspace ? { workspace: request.workspace } : {})), (request.prefer ? { prefer: request.prefer } : {})),
        runtime: {},
        sharedState: request.state,
        messages: [],
        toolCalls: [],
    };
}
function mapConceptStatus(status) {
    if (status === 'done')
        return 'completed';
    if (status === 'failed')
        return 'failed';
    if (status === 'aborted')
        return 'interrupted';
    return 'running';
}
function recordLedgerEventKey(event) {
    if (typeof event.id === 'string')
        return event.id;
    if (typeof event.seq === 'number') {
        return `${event.run_id}:${event.type}:${String(event.seq)}`;
    }
    return null;
}
function formatConceptProgress(event) {
    var _a;
    if (event.type === 'dag.node.started' && typeof event.node_id === 'string') {
        return `${event.node_id} phase started`;
    }
    if (event.type === 'dag.node.completed' && typeof event.node_id === 'string') {
        return `${event.node_id} phase completed`;
    }
    if (event.type === 'approval.requested') {
        return event.reason ? `Approval required: ${event.reason}` : 'Approval required';
    }
    if (event.type === 'approval.granted')
        return 'Approval granted';
    if (event.type === 'approval.denied')
        return event.reason ? `Approval denied: ${event.reason}` : 'Approval denied';
    if (event.type === 'run.blocked')
        return event.reason ? `Run blocked: ${event.reason}` : 'Run blocked';
    if (event.type === 'run.failed')
        return event.error ? `Run failed: ${event.error}` : 'Run failed';
    if (event.type === 'run.cancelled')
        return event.reason ? `Run cancelled: ${event.reason}` : 'Run cancelled';
    if (event.type === 'concept.completed') {
        return event.status === 'done' ? 'Concept completed' : `Concept completed with status ${(_a = event.status) !== null && _a !== void 0 ? _a : 'unknown'}`;
    }
    return null;
}
export function toAgUiConceptInput(request, defaultWorkspace) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ goal: request.promptText }, (((_a = request.workspace) !== null && _a !== void 0 ? _a : defaultWorkspace) ? { workspaceId: (_b = request.workspace) !== null && _b !== void 0 ? _b : defaultWorkspace } : {})), (request.runId ? { runId: request.runId } : {})), (((_c = request.concept) === null || _c === void 0 ? void 0 : _c.conceptId) ? { conceptId: request.concept.conceptId } : {})), (((_d = request.concept) === null || _d === void 0 ? void 0 : _d.projectId) ? { projectId: request.concept.projectId } : {})), (((_e = request.concept) === null || _e === void 0 ? void 0 : _e.parentConceptId) ? { parentConceptId: request.concept.parentConceptId } : {})), (((_f = request.concept) === null || _f === void 0 ? void 0 : _f.retryOf) ? { retryOf: request.concept.retryOf } : {})), (typeof ((_g = request.concept) === null || _g === void 0 ? void 0 : _g.dryRun) === 'boolean' ? { dryRun: request.concept.dryRun } : {})), (((_j = (_h = request.concept) === null || _h === void 0 ? void 0 : _h.strategies) === null || _j === void 0 ? void 0 : _j.length) ? { strategies: request.concept.strategies } : {}));
}
export function createAgUiConceptProjector(record, request, opts) {
    var _a, _b, _c, _d;
    const clock = (_a = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _a !== void 0 ? _a : (() => Date.now());
    const threadId = (_b = request.threadId) !== null && _b !== void 0 ? _b : record.conceptId;
    const runId = (_d = (_c = request.runId) !== null && _c !== void 0 ? _c : record.runId) !== null && _d !== void 0 ? _d : randomUUID();
    const state = createInitialState(request, threadId, runId);
    state.status = mapConceptStatus(record.status);
    state.runtime = Object.assign(Object.assign({ runId: record.runId, conceptId: record.conceptId }, (record.currentPhase ? { currentPhase: record.currentPhase } : {})), { phases: [...record.phases], artifactIds: record.artifactRefs.map((ref) => ref.id) });
    let started = false;
    let terminal = false;
    const seen = new Set();
    const start = () => {
        if (started)
            return [];
        started = true;
        return [
            Object.assign(Object.assign({ type: 'RUN_STARTED', threadId,
                runId }, (request.parentRunId ? { parentRunId: request.parentRunId } : {})), { input: Object.assign(Object.assign(Object.assign({ mode: 'concept', threadId,
                    runId }, (request.parentRunId ? { parentRunId: request.parentRunId } : {})), { state: request.state, messages: request.messages, tools: request.tools, context: request.context, forwardedProps: request.forwardedProps }), (request.concept ? { concept: request.concept } : {})), timestamp: clock() }),
            {
                type: 'STATE_SNAPSHOT',
                snapshot: cloneState(state),
                timestamp: clock(),
            },
        ];
    };
    const emitTextMessage = (text) => {
        const messageId = randomUUID();
        const draftOp = state.draftText === undefined ? 'add' : 'replace';
        state.messages.push({ id: messageId, role: 'assistant', content: text });
        state.draftText = text;
        const message = state.messages[state.messages.length - 1];
        return [
            { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', timestamp: clock() },
            { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text, timestamp: clock() },
            { type: 'TEXT_MESSAGE_END', messageId, timestamp: clock() },
            {
                type: 'STATE_DELTA',
                delta: [
                    { op: 'add', path: '/messages/-', value: message },
                    { op: draftOp, path: '/draftText', value: text },
                ],
                timestamp: clock(),
            },
        ];
    };
    const ensureInterrupts = () => {
        if (!state.interrupts)
            state.interrupts = [];
        return state.interrupts;
    };
    const removeInterrupts = (approvalId) => {
        if (!state.interrupts || state.interrupts.length === 0)
            return [];
        if (!approvalId) {
            state.interrupts = [];
            return [{ op: 'replace', path: '/interrupts', value: [] }];
        }
        const nextInterrupts = state.interrupts.filter((entry) => entry.id !== approvalId);
        if (nextInterrupts.length === state.interrupts.length)
            return [];
        state.interrupts = nextInterrupts;
        return [{ op: 'replace', path: '/interrupts', value: nextInterrupts }];
    };
    const setStatus = (status, delta) => {
        if (state.status === status)
            return;
        state.status = status;
        delta.push({ op: 'replace', path: '/status', value: status });
    };
    const setCurrentPhase = (phase, delta) => {
        if (phase === undefined)
            return;
        if (state.runtime.currentPhase === phase)
            return;
        const op = state.runtime.currentPhase ? 'replace' : 'add';
        state.runtime.currentPhase = phase;
        delta.push({ op, path: '/runtime/currentPhase', value: phase });
    };
    const ensurePhase = (phase, delta) => {
        var _a;
        if (!phase)
            return;
        const phases = (_a = state.runtime.phases) !== null && _a !== void 0 ? _a : (state.runtime.phases = []);
        if (phases.includes(phase))
            return;
        phases.push(phase);
        delta.push({ op: 'add', path: '/runtime/phases/-', value: phase });
    };
    const ensureArtifact = (artifactId, delta) => {
        var _a;
        if (!artifactId)
            return;
        const artifactIds = (_a = state.runtime.artifactIds) !== null && _a !== void 0 ? _a : (state.runtime.artifactIds = []);
        if (artifactIds.includes(artifactId))
            return;
        artifactIds.push(artifactId);
        delta.push({ op: 'add', path: '/runtime/artifactIds/-', value: artifactId });
    };
    const emitTerminalEvent = (message) => {
        var _a, _b, _c, _d;
        if (state.status === 'failed') {
            return [{ type: 'RUN_ERROR', message: (_b = message !== null && message !== void 0 ? message : (_a = state.lastError) === null || _a === void 0 ? void 0 : _a.message) !== null && _b !== void 0 ? _b : 'run_failed', timestamp: clock() }];
        }
        if (state.status === 'interrupted') {
            return [{
                    type: 'RUN_FINISHED',
                    threadId: state.threadId,
                    runId: state.runId,
                    outcome: {
                        type: 'interrupt',
                        interrupts: state.interrupts && state.interrupts.length > 0
                            ? state.interrupts
                            : [Object.assign({ id: `interrupt-${state.runId}`, reason: 'run_interrupted' }, (message ? { message } : {}))],
                    },
                    timestamp: clock(),
                }];
        }
        return [{
                type: 'RUN_FINISHED',
                threadId: state.threadId,
                runId: state.runId,
                result: {
                    conceptId: state.runtime.conceptId,
                    status: 'done',
                    phases: (_c = state.runtime.phases) !== null && _c !== void 0 ? _c : [],
                    artifactIds: (_d = state.runtime.artifactIds) !== null && _d !== void 0 ? _d : [],
                },
                outcome: { type: 'success' },
                timestamp: clock(),
            }];
    };
    const apply = (event, emitMessages) => {
        var _a, _b, _c, _d, _e;
        const key = recordLedgerEventKey(event);
        if (key && seen.has(key))
            return [];
        if (key)
            seen.add(key);
        const delta = [];
        let terminalEvents = [];
        if (event.type === 'concept.received') {
            setCurrentPhase('plan', delta);
            setStatus('running', delta);
        }
        else if (event.type === 'concept.planned') {
            ensurePhase('plan', delta);
            setCurrentPhase('plan', delta);
            ensureArtifact(event.plan_id, delta);
        }
        else if (event.type === 'research.started') {
            setCurrentPhase('research', delta);
            setStatus('running', delta);
        }
        else if (event.type === 'research.completed') {
            ensurePhase('research', delta);
            ensureArtifact(event.research_id, delta);
        }
        else if (event.type === 'critique.started') {
            setCurrentPhase('critique', delta);
            setStatus('running', delta);
        }
        else if (event.type === 'critique.completed') {
            ensurePhase('critique', delta);
            ensureArtifact(event.critique_id, delta);
        }
        else if (event.type === 'postmortem.started') {
            setCurrentPhase('postmortem', delta);
            setStatus('running', delta);
        }
        else if (event.type === 'postmortem.completed') {
            ensurePhase('postmortem', delta);
            ensureArtifact(event.artifact_id, delta);
        }
        else if (event.type === 'memory.written') {
            ensurePhase('memory_persist', delta);
            setCurrentPhase('memory_persist', delta);
            if (Array.isArray(event.artifact_refs)) {
                for (const artifactId of event.artifact_refs.filter((entry) => typeof entry === 'string')) {
                    ensureArtifact(artifactId, delta);
                }
            }
        }
        else if (event.type === 'dag.node.started' && typeof event.node_id === 'string') {
            setCurrentPhase(event.node_id, delta);
            setStatus('running', delta);
        }
        else if (event.type === 'dag.node.completed' && typeof event.node_id === 'string') {
            ensurePhase(event.node_id, delta);
            if (Array.isArray(event.artifact_refs)) {
                for (const artifactId of event.artifact_refs.filter((entry) => typeof entry === 'string')) {
                    ensureArtifact(artifactId, delta);
                }
            }
        }
        else if (event.type === 'artifact.created') {
            ensureArtifact(event.artifact_id, delta);
        }
        else if (event.type === 'approval.requested') {
            const interrupts = ensureInterrupts();
            const previousLength = interrupts.length;
            const interruptId = (_a = event.approval_id) !== null && _a !== void 0 ? _a : `approval-${event.run_id}-${interrupts.length + 1}`;
            if (!interrupts.some((entry) => entry.id === interruptId)) {
                const interrupt = Object.assign(Object.assign({ id: interruptId, reason: 'approval_required' }, (event.reason ? { message: event.reason } : {})), (event.tool ? { metadata: { tool: event.tool } } : {}));
                interrupts.push(interrupt);
                delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
            }
            setStatus('interrupted', delta);
        }
        else if (event.type === 'approval.granted') {
            delta.push(...removeInterrupts(event.approval_id));
            setStatus('running', delta);
        }
        else if (event.type === 'approval.denied') {
            const interrupts = ensureInterrupts();
            const previousLength = interrupts.length;
            const interruptId = (_b = event.approval_id) !== null && _b !== void 0 ? _b : `approval-denied-${event.run_id}`;
            if (!interrupts.some((entry) => entry.id === interruptId)) {
                interrupts.push(Object.assign(Object.assign({ id: interruptId, reason: 'approval_denied' }, (event.reason ? { message: event.reason } : {})), (event.tool ? { metadata: { tool: event.tool } } : {})));
                delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
            }
            setStatus('interrupted', delta);
        }
        else if (event.type === 'run.blocked') {
            const interrupts = ensureInterrupts();
            const previousLength = interrupts.length;
            interrupts.push(Object.assign({ id: `run-blocked-${event.run_id}-${interrupts.length + 1}`, reason: 'run_blocked' }, (event.reason ? { message: event.reason } : {})));
            delta.push({ op: previousLength === 0 ? 'add' : 'replace', path: '/interrupts', value: [...interrupts] });
            setStatus('interrupted', delta);
        }
        else if (event.type === 'run.failed') {
            const hadLastError = state.lastError !== undefined;
            state.lastError = { message: (_c = event.error) !== null && _c !== void 0 ? _c : 'run_failed' };
            delta.push({ op: hadLastError ? 'replace' : 'add', path: '/lastError', value: state.lastError });
            setStatus('failed', delta);
            terminal = true;
            terminalEvents = emitTerminalEvent(event.error);
        }
        else if (event.type === 'run.cancelled') {
            setStatus('interrupted', delta);
            terminal = true;
            terminalEvents = emitTerminalEvent(event.reason);
        }
        else if (event.type === 'concept.completed') {
            if (event.status === 'done') {
                setStatus('completed', delta);
            }
            else if (event.status === 'aborted') {
                setStatus('interrupted', delta);
            }
            else if (event.status === 'failed') {
                const hadLastError = state.lastError !== undefined;
                state.lastError = { message: (_d = event.error) !== null && _d !== void 0 ? _d : 'concept_failed' };
                delta.push({ op: hadLastError ? 'replace' : 'add', path: '/lastError', value: state.lastError });
                setStatus('failed', delta);
            }
            terminal = true;
            terminalEvents = emitTerminalEvent((_e = event.reason) !== null && _e !== void 0 ? _e : event.error);
        }
        const out = [];
        if (emitMessages) {
            const progressText = formatConceptProgress(event);
            if (progressText)
                out.push(...emitTextMessage(progressText));
        }
        if (delta.length > 0)
            out.push({ type: 'STATE_DELTA', delta, timestamp: clock() });
        out.push(...terminalEvents);
        return out;
    };
    return {
        snapshot(events) {
            var _a;
            for (const event of events)
                apply(event, false);
            const out = start();
            if (terminal)
                out.push(...emitTerminalEvent((_a = state.lastError) === null || _a === void 0 ? void 0 : _a.message));
            return out;
        },
        project(event) {
            if (terminal)
                return [];
            const out = start();
            out.push(...apply(event, true));
            return out;
        },
        isTerminal() {
            return terminal;
        },
    };
}
export function createAgUiEventStream(source, request, opts) {
    return __asyncGenerator(this, arguments, function* createAgUiEventStream_1() {
        var _a, e_1, _b, _c;
        var _d, _e, _f, _g, _h;
        const clock = (_d = opts === null || opts === void 0 ? void 0 : opts.clock) !== null && _d !== void 0 ? _d : (() => Date.now());
        let state;
        let started = false;
        let terminal = false;
        let lastAssistantMessageId;
        let lastAssistantText;
        const start = (runtime) => {
            var _a, _b, _c, _d;
            if (started && state) {
                if (runtime) {
                    const delta = [];
                    if (runtime.sessionId && state.runtime.sessionId !== runtime.sessionId) {
                        const op = state.runtime.sessionId ? 'replace' : 'add';
                        state.runtime.sessionId = runtime.sessionId;
                        delta.push({ op, path: '/runtime/sessionId', value: runtime.sessionId });
                    }
                    if (runtime.runId && state.runtime.runId !== runtime.runId) {
                        const op = state.runtime.runId ? 'replace' : 'add';
                        state.runtime.runId = runtime.runId;
                        delta.push({ op, path: '/runtime/runId', value: runtime.runId });
                    }
                    if (runtime.taskId && state.runtime.taskId !== runtime.taskId) {
                        const op = state.runtime.taskId ? 'replace' : 'add';
                        state.runtime.taskId = runtime.taskId;
                        delta.push({ op, path: '/runtime/taskId', value: runtime.taskId });
                    }
                    return delta.length > 0 ? [{ type: 'STATE_DELTA', delta, timestamp: clock() }] : [];
                }
                return [];
            }
            const threadId = (_b = (_a = request.threadId) !== null && _a !== void 0 ? _a : runtime === null || runtime === void 0 ? void 0 : runtime.sessionId) !== null && _b !== void 0 ? _b : randomUUID();
            const runId = (_d = (_c = request.runId) !== null && _c !== void 0 ? _c : runtime === null || runtime === void 0 ? void 0 : runtime.runId) !== null && _d !== void 0 ? _d : randomUUID();
            state = createInitialState(request, threadId, runId);
            if (runtime)
                state.runtime = Object.assign({}, runtime);
            started = true;
            return [
                Object.assign(Object.assign({ type: 'RUN_STARTED', threadId,
                    runId }, (request.parentRunId ? { parentRunId: request.parentRunId } : {})), { input: Object.assign(Object.assign({ threadId,
                        runId }, (request.parentRunId ? { parentRunId: request.parentRunId } : {})), { state: request.state, messages: request.messages, tools: request.tools, context: request.context, forwardedProps: request.forwardedProps }), timestamp: clock() }),
                {
                    type: 'STATE_SNAPSHOT',
                    snapshot: cloneState(state),
                    timestamp: clock(),
                },
            ];
        };
        const emitTextMessage = (text) => {
            if (!state)
                return [];
            const messageId = randomUUID();
            const draftOp = state.draftText === undefined ? 'add' : 'replace';
            state.messages.push({ id: messageId, role: 'assistant', content: text });
            state.draftText = text;
            lastAssistantMessageId = messageId;
            lastAssistantText = text;
            const message = state.messages[state.messages.length - 1];
            return [
                { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', timestamp: clock() },
                { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text, timestamp: clock() },
                { type: 'TEXT_MESSAGE_END', messageId, timestamp: clock() },
                {
                    type: 'STATE_DELTA',
                    delta: [
                        { op: 'add', path: '/messages/-', value: message },
                        { op: draftOp, path: '/draftText', value: text },
                    ],
                    timestamp: clock(),
                },
            ];
        };
        try {
            try {
                for (var _j = true, source_1 = __asyncValues(source), source_1_1; source_1_1 = yield __await(source_1.next()), _a = source_1_1.done, !_a; _j = true) {
                    _c = source_1_1.value;
                    _j = false;
                    const streamEvent = _c;
                    if (streamEvent.type === 'run') {
                        for (const event of start({
                            sessionId: streamEvent.sessionId,
                            runId: streamEvent.runId,
                            taskId: streamEvent.taskId,
                        }))
                            yield yield __await(event);
                        continue;
                    }
                    for (const event of start())
                        yield yield __await(event);
                    if (!state)
                        continue;
                    if (streamEvent.type === 'token') {
                        for (const event of emitTextMessage(streamEvent.text))
                            yield yield __await(event);
                        continue;
                    }
                    if (streamEvent.type === 'tool') {
                        const toolCallId = (_e = streamEvent.toolCallId) !== null && _e !== void 0 ? _e : randomUUID();
                        const argsText = formatPayload(streamEvent.args);
                        state.toolCalls.push(Object.assign(Object.assign({ toolCallId, toolCallName: streamEvent.name }, (lastAssistantMessageId ? { parentMessageId: lastAssistantMessageId } : {})), { argsText, status: 'pending' }));
                        const toolCall = state.toolCalls[state.toolCalls.length - 1];
                        yield yield __await(Object.assign(Object.assign({ type: 'TOOL_CALL_START', toolCallId, toolCallName: streamEvent.name }, (lastAssistantMessageId ? { parentMessageId: lastAssistantMessageId } : {})), { timestamp: clock() }));
                        yield yield __await({ type: 'TOOL_CALL_ARGS', toolCallId, delta: argsText, timestamp: clock() });
                        yield yield __await({ type: 'TOOL_CALL_END', toolCallId, timestamp: clock() });
                        yield yield __await({
                            type: 'STATE_DELTA',
                            delta: [{ op: 'add', path: '/toolCalls/-', value: toolCall }],
                            timestamp: clock(),
                        });
                        continue;
                    }
                    if (streamEvent.type === 'tool_result') {
                        let toolIndex = -1;
                        if (streamEvent.toolCallId) {
                            toolIndex = state.toolCalls.findIndex((toolCall) => toolCall.toolCallId === streamEvent.toolCallId && toolCall.status === 'pending');
                        }
                        if (toolIndex === -1) {
                            for (let index = 0; index < state.toolCalls.length; index++) {
                                if (((_f = state.toolCalls[index]) === null || _f === void 0 ? void 0 : _f.toolCallName) === streamEvent.name && ((_g = state.toolCalls[index]) === null || _g === void 0 ? void 0 : _g.status) === 'pending') {
                                    toolIndex = index;
                                    break;
                                }
                            }
                        }
                        if (toolIndex === -1) {
                            state.toolCalls.push({
                                toolCallId: (_h = streamEvent.toolCallId) !== null && _h !== void 0 ? _h : randomUUID(),
                                toolCallName: streamEvent.name,
                                argsText: '{}',
                                status: 'pending',
                            });
                            toolIndex = state.toolCalls.length - 1;
                        }
                        const toolCall = state.toolCalls[toolIndex];
                        const content = formatPayload(streamEvent.result);
                        const messageId = randomUUID();
                        toolCall.status = 'completed';
                        toolCall.ok = streamEvent.ok;
                        toolCall.resultContent = content;
                        toolCall.resultMessageId = messageId;
                        state.messages.push({ id: messageId, role: 'tool', content, toolCallId: toolCall.toolCallId });
                        const toolMessage = state.messages[state.messages.length - 1];
                        yield yield __await({
                            type: 'TOOL_CALL_RESULT',
                            messageId,
                            toolCallId: toolCall.toolCallId,
                            content,
                            role: 'tool',
                            timestamp: clock(),
                        });
                        yield yield __await({
                            type: 'STATE_DELTA',
                            delta: [
                                { op: 'replace', path: `/toolCalls/${toolIndex}/status`, value: 'completed' },
                                { op: 'add', path: `/toolCalls/${toolIndex}/ok`, value: streamEvent.ok },
                                { op: 'add', path: `/toolCalls/${toolIndex}/resultContent`, value: content },
                                { op: 'add', path: `/toolCalls/${toolIndex}/resultMessageId`, value: messageId },
                                { op: 'add', path: '/messages/-', value: toolMessage },
                            ],
                            timestamp: clock(),
                        });
                        continue;
                    }
                    if (streamEvent.type === 'final') {
                        const delta = [];
                        const finalTextOp = state.finalText === undefined ? 'add' : 'replace';
                        if (streamEvent.text !== lastAssistantText) {
                            for (const event of emitTextMessage(streamEvent.text))
                                yield yield __await(event);
                        }
                        state.finalText = streamEvent.text;
                        state.draftText = streamEvent.text;
                        state.status = 'completed';
                        delta.push({ op: finalTextOp, path: '/finalText', value: streamEvent.text }, { op: 'replace', path: '/draftText', value: streamEvent.text }, { op: 'replace', path: '/status', value: 'completed' });
                        yield yield __await({ type: 'STATE_DELTA', delta, timestamp: clock() });
                        yield yield __await({
                            type: 'RUN_FINISHED',
                            threadId: state.threadId,
                            runId: state.runId,
                            result: Object.assign({ text: streamEvent.text }, (streamEvent.usage ? { usage: streamEvent.usage } : {})),
                            outcome: { type: 'success' },
                            timestamp: clock(),
                        });
                        terminal = true;
                    }
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_j && !_a && (_b = source_1.return)) yield __await(_b.call(source_1));
                }
                finally { if (e_1) throw e_1.error; }
            }
        }
        catch (error) {
            for (const event of start())
                yield yield __await(event);
            if (!state)
                return yield __await(void 0);
            const interrupts = toInterrupts(error);
            const message = getErrorMessage(error);
            state.lastError = Object.assign({ message }, (interrupts ? { code: 'interrupt' } : {}));
            state.status = interrupts ? 'interrupted' : 'failed';
            yield yield __await({
                type: 'STATE_DELTA',
                delta: [
                    { op: 'replace', path: '/status', value: state.status },
                    { op: 'add', path: '/lastError', value: state.lastError },
                ],
                timestamp: clock(),
            });
            if (interrupts) {
                yield yield __await({
                    type: 'RUN_FINISHED',
                    threadId: state.threadId,
                    runId: state.runId,
                    outcome: { type: 'interrupt', interrupts },
                    timestamp: clock(),
                });
            }
            else {
                yield yield __await(Object.assign(Object.assign({ type: 'RUN_ERROR', message }, (error instanceof Error && error.name ? { code: error.name } : {})), { timestamp: clock() }));
            }
            terminal = true;
        }
        if (!terminal) {
            for (const event of start())
                yield yield __await(event);
            if (!state)
                return yield __await(void 0);
            state.status = 'completed';
            yield yield __await({
                type: 'STATE_DELTA',
                delta: [{ op: 'replace', path: '/status', value: 'completed' }],
                timestamp: clock(),
            });
            yield yield __await({
                type: 'RUN_FINISHED',
                threadId: state.threadId,
                runId: state.runId,
                outcome: { type: 'success' },
                timestamp: clock(),
            });
        }
    });
}

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
    const openFiles = normalizeOpenFiles(body.openFiles);
    return {
        ok: true,
        input: Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (typeof body.threadId === 'string' ? { threadId: body.threadId } : {})), (typeof body.runId === 'string' ? { runId: body.runId } : {})), (typeof body.parentRunId === 'string' ? { parentRunId: body.parentRunId } : {})), { state: (_a = body.state) !== null && _a !== void 0 ? _a : {}, messages, tools: Array.isArray(body.tools) ? body.tools : [], context: Array.isArray(body.context) ? body.context : [], forwardedProps,
            promptText }), (typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {})), (typeof body.workspace === 'string' ? { workspace: body.workspace } : {})), (openFiles ? { openFiles } : {})), (body.prefer === 'local' || body.prefer === 'cloud' || body.prefer === 'auto' ? { prefer: body.prefer } : {})), (isRecord(body.routingHints) ? { routingHints: body.routingHints } : {})), (typeof body.exposeToolPayloads === 'boolean' ? { exposeToolPayloads: body.exposeToolPayloads } : {})),
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

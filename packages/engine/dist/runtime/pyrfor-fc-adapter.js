var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
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
// @vitest-environment node
import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
const DEFAULT_WRAPPER_PATH = '/Users/aleksandrgrebeshok/.openclaw/workspace/tools/freeclaude-run.sh';
export function runFreeClaude(opts) {
    var _a, _b;
    const wrapperPath = opts.wrapperPath || process.env.FREECLAUDE_RUN || DEFAULT_WRAPPER_PATH;
    const spawnFn = opts.spawnFn || nodeSpawn;
    const allEvents = [];
    const stderrLines = [];
    const emitter = new EventEmitter();
    let envelope = null;
    let exitCode = null;
    let completed = false;
    let childProcess = null;
    let abortReason;
    let timeoutHandle;
    // Tool use accumulator per content block index
    const toolAccumulators = new Map();
    const args = buildArgs(opts);
    const cwd = opts.workdir || process.cwd();
    const emitEvent = (event) => {
        allEvents.push(event);
        emitter.emit('event', event);
    };
    const finish = () => {
        if (completed)
            return;
        completed = true;
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
        if (!envelope) {
            const errorMsg = abortReason
                ? `Aborted: ${abortReason}`
                : stderrLines.length > 0
                    ? stderrLines.slice(-10).join('\n')
                    : 'No wrapper_result envelope received';
            envelope = {
                status: 'error',
                error: errorMsg,
                exitCode: exitCode !== null && exitCode !== void 0 ? exitCode : -1,
                filesTouched: [],
                commandsRun: [],
                raw: {},
            };
        }
        else if (abortReason) {
            envelope.status = 'error';
            envelope.error = abortReason;
        }
        emitter.emit('complete');
    };
    const abort = (reason) => {
        if (!childProcess || completed)
            return;
        abortReason = reason;
        childProcess.kill('SIGTERM');
        setTimeout(() => {
            if (childProcess && !completed) {
                childProcess.kill('SIGKILL');
            }
        }, 2000);
    };
    if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
            abort('Signal aborted');
        });
    }
    if (opts.timeoutSec) {
        timeoutHandle = setTimeout(() => {
            abort(`Timeout after ${opts.timeoutSec}s`);
        }, opts.timeoutSec * 1000);
    }
    childProcess = spawnFn(wrapperPath, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    (_a = childProcess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
        stdoutBuffer += chunk.toString('utf8');
        let newlineIndex;
        while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
            const line = stdoutBuffer.slice(0, newlineIndex);
            stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
            if (!line.trim())
                continue;
            try {
                const parsed = JSON.parse(line);
                // Handle wrapper_result specially - it's the envelope
                if (parsed.type === 'wrapper_result') {
                    envelope = parseEnvelope(parsed);
                }
                else {
                    const event = classifyEvent(parsed, toolAccumulators, emitter);
                    if (event) {
                        emitEvent(event);
                    }
                }
            }
            catch (err) {
                // Not valid JSON, ignore
            }
        }
    });
    (_b = childProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (chunk) => {
        const lines = chunk.toString('utf8').split('\n').filter(l => l.trim());
        for (const line of lines) {
            stderrLines.push(line);
            emitEvent({ type: 'stderr', line });
        }
    });
    childProcess.on('exit', (code) => {
        exitCode = code !== null && code !== void 0 ? code : -1;
        finish();
    });
    childProcess.on('error', (err) => {
        stderrLines.push(`Process error: ${err.message}`);
        emitEvent({ type: 'stderr', line: `Process error: ${err.message}` });
        exitCode = -1;
        finish();
    });
    return {
        events() {
            return __asyncGenerator(this, arguments, function* events_1() {
                const eventQueue = [];
                let resolveNext = null;
                const onEvent = (event) => {
                    eventQueue.push(event);
                    if (resolveNext) {
                        resolveNext();
                        resolveNext = null;
                    }
                };
                const onComplete = () => {
                    if (resolveNext) {
                        resolveNext();
                        resolveNext = null;
                    }
                };
                emitter.on('event', onEvent);
                emitter.on('complete', onComplete);
                try {
                    while (!completed || eventQueue.length > 0) {
                        if (eventQueue.length > 0) {
                            yield yield __await(eventQueue.shift());
                        }
                        else if (!completed) {
                            yield __await(new Promise((resolve) => {
                                resolveNext = resolve;
                            }));
                        }
                    }
                }
                finally {
                    emitter.off('event', onEvent);
                    emitter.off('complete', onComplete);
                }
            });
        },
        complete() {
            return __awaiter(this, void 0, void 0, function* () {
                if (!completed) {
                    yield new Promise((resolve) => {
                        emitter.once('complete', resolve);
                    });
                }
                return {
                    envelope: envelope,
                    events: allEvents,
                    exitCode: exitCode !== null && exitCode !== void 0 ? exitCode : -1,
                };
            });
        },
        abort,
    };
}
function buildArgs(opts) {
    const args = [];
    args.push('--output-format', 'stream-json');
    if (opts.model) {
        args.push('--model', opts.model);
    }
    if (opts.workdir) {
        args.push('--workdir', opts.workdir);
    }
    if (opts.timeoutSec !== undefined) {
        args.push('--timeout', String(opts.timeoutSec));
    }
    if (opts.maxTurns !== undefined) {
        args.push('--max-turns', String(opts.maxTurns));
    }
    if (opts.effort) {
        args.push('--effort', opts.effort);
    }
    if (opts.maxBudgetUsd !== undefined) {
        args.push('--max-budget-usd', String(opts.maxBudgetUsd));
    }
    if (opts.fallbackModel) {
        args.push('--fallback-model', opts.fallbackModel);
    }
    if (opts.allowedTools && opts.allowedTools.length > 0) {
        args.push('--allowed-tools', opts.allowedTools.join(','));
    }
    if (opts.disallowedTools && opts.disallowedTools.length > 0) {
        args.push('--disallowed-tools', opts.disallowedTools.join(','));
    }
    if (opts.tools && opts.tools.length > 0) {
        args.push('--tools', opts.tools.join(','));
    }
    if (opts.systemPrompt) {
        args.push('--system-prompt', opts.systemPrompt);
    }
    if (opts.appendSystemPrompt) {
        args.push('--append-system-prompt', opts.appendSystemPrompt);
    }
    if (opts.jsonSchema) {
        const schema = typeof opts.jsonSchema === 'string'
            ? opts.jsonSchema
            : JSON.stringify(opts.jsonSchema);
        args.push('--json-schema', schema);
    }
    if (opts.permissionMode) {
        args.push('--permission-mode', opts.permissionMode);
    }
    if (opts.bare === true) {
        args.push('--bare');
    }
    else if (opts.bare === false) {
        args.push('--no-bare');
    }
    if (opts.noMemory) {
        args.push('--no-memory');
    }
    if (opts.noPersist) {
        args.push('--no-persist');
    }
    if (opts.addDirs && opts.addDirs.length > 0) {
        for (const dir of opts.addDirs) {
            args.push('--add-dir', dir);
        }
    }
    if (opts.resume) {
        args.push('--resume', opts.resume);
    }
    if (opts.resumeLast) {
        args.push('--resume-last');
    }
    if (opts.forkSession) {
        args.push('--fork-session');
    }
    args.push('--');
    args.push(opts.prompt);
    return args;
}
function classifyEvent(parsed, toolAccumulators, emitter) {
    if (!parsed || typeof parsed !== 'object') {
        return { type: 'unknown', raw: parsed };
    }
    switch (parsed.type) {
        case 'wrapper_event':
            return { type: 'wrapper_event', name: parsed.name || '', raw: parsed };
        case 'stream_event': {
            const streamEvent = { type: 'stream_event', event: parsed.event || {}, raw: parsed };
            // Handle tool_use synthesis from stream events
            if (parsed.event) {
                const eventType = parsed.event.type;
                const index = parsed.event.index;
                if (eventType === 'content_block_start') {
                    const block = parsed.event.content_block;
                    if (block && block.type === 'tool_use') {
                        const acc = {
                            name: block.name,
                            input: block.input,
                            inputJson: '',
                        };
                        toolAccumulators.set(index, acc);
                        // If input is already present, emit immediately
                        if (block.input !== undefined) {
                            emitter.emit('event', {
                                type: 'tool_use',
                                name: block.name,
                                input: block.input,
                                raw: parsed,
                            });
                        }
                    }
                }
                else if (eventType === 'content_block_delta') {
                    const delta = parsed.event.delta;
                    if (delta && delta.type === 'input_json_delta') {
                        const acc = toolAccumulators.get(index);
                        if (acc) {
                            acc.inputJson = (acc.inputJson || '') + (delta.partial_json || '');
                        }
                    }
                }
                else if (eventType === 'content_block_stop') {
                    const acc = toolAccumulators.get(index);
                    if (acc && acc.inputJson && !acc.input) {
                        try {
                            acc.input = JSON.parse(acc.inputJson);
                            emitter.emit('event', {
                                type: 'tool_use',
                                name: acc.name || 'unknown',
                                input: acc.input,
                                raw: parsed,
                            });
                        }
                        catch (err) {
                            // Failed to parse accumulated JSON
                        }
                        toolAccumulators.delete(index);
                    }
                }
            }
            return streamEvent;
        }
        case 'assistant': {
            const message = parsed.message || {};
            // Extract tool_use blocks from assistant message
            if (message.content && Array.isArray(message.content)) {
                for (const block of message.content) {
                    if (block.type === 'tool_use') {
                        emitter.emit('event', {
                            type: 'tool_use',
                            name: block.name || 'unknown',
                            input: block.input,
                            raw: parsed,
                        });
                    }
                }
            }
            return { type: 'assistant', message, raw: parsed };
        }
        case 'result':
            return { type: 'result', result: parsed.result || {}, raw: parsed };
        case 'wrapper_result':
            // This will be captured separately as envelope
            return null;
        default:
            return { type: 'unknown', raw: parsed };
    }
}
function parseEnvelope(parsed) {
    var _a;
    return {
        status: parsed.status || 'unknown',
        output: parsed.output,
        error: parsed.error,
        workdir: parsed.workdir,
        model: parsed.model,
        requestedModel: parsed.requestedModel,
        durationMs: parsed.durationMs,
        sessionId: parsed.sessionId,
        costUsd: parsed.costUsd,
        usage: parsed.usage,
        stopReason: parsed.stopReason,
        filesTouched: parsed.filesTouched || [],
        commandsRun: parsed.commandsRun || [],
        exitCode: (_a = parsed.exitCode) !== null && _a !== void 0 ? _a : 0,
        maxTurns: parsed.maxTurns,
        effort: parsed.effort,
        maxBudgetUsd: parsed.maxBudgetUsd,
        fallbackModel: parsed.fallbackModel,
        allowedTools: parsed.allowedTools,
        disallowedTools: parsed.disallowedTools,
        tools: parsed.tools,
        rawResult: parsed.rawResult,
        raw: parsed,
    };
}

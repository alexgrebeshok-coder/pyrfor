export class FcEventReader {
    constructor(opts) {
        this.sessionStarted = false;
        this.textAccumulators = new Map();
        this.toolCalls = new Map();
        this.toolResultAccumulators = new Map();
        this.toolUseCounter = 0;
        this.now = (opts === null || opts === void 0 ? void 0 : opts.now) || (() => Date.now());
        this.include = opts === null || opts === void 0 ? void 0 : opts.include;
    }
    read(raw) {
        var _a, _b, _c, _d;
        const events = [];
        if (raw.type === 'stderr') {
            return [];
        }
        // SessionStart: wrapper_event start or first message_start
        if (raw.type === 'wrapper_event' && raw.name === 'start') {
            if (!this.sessionStarted) {
                this.sessionStarted = true;
                events.push(this.emit({
                    type: 'SessionStart',
                    sessionId: raw.raw.sessionId,
                    ts: this.now(),
                }));
            }
        }
        else if (raw.type === 'stream_event' && ((_a = raw.event) === null || _a === void 0 ? void 0 : _a.type) === 'message_start') {
            if (!this.sessionStarted) {
                this.sessionStarted = true;
                events.push(this.emit({
                    type: 'SessionStart',
                    model: (_b = raw.event.message) === null || _b === void 0 ? void 0 : _b.model,
                    ts: this.now(),
                }));
            }
        }
        // SessionEnd: result event
        if (raw.type === 'result') {
            const result = raw.result || ((_c = raw.raw) === null || _c === void 0 ? void 0 : _c.result) || {};
            const status = result.result && !result.error ? 'success' : 'error';
            events.push(this.emit({
                type: 'SessionEnd',
                sessionId: result.session_id || result.sessionId,
                status,
                costUsd: result.total_cost_usd || result.costUsd,
                usage: result.usage,
                stopReason: result.stop_reason || result.stopReason,
                ts: this.now(),
            }));
        }
        // Stream events: text accumulation and tool_result
        if (raw.type === 'stream_event' && raw.event) {
            const event = raw.event;
            const index = event.index;
            if (event.type === 'content_block_start') {
                const block = event.content_block;
                if ((block === null || block === void 0 ? void 0 : block.type) === 'text') {
                    this.textAccumulators.set(index, { blockIndex: index, text: '' });
                }
                else if ((block === null || block === void 0 ? void 0 : block.type) === 'tool_result') {
                    const toolUseId = block.tool_use_id || `tu-${this.toolUseCounter++}`;
                    this.toolResultAccumulators.set(toolUseId, { toolUseId, text: '' });
                }
            }
            else if (event.type === 'content_block_delta') {
                const delta = event.delta;
                if ((delta === null || delta === void 0 ? void 0 : delta.type) === 'text_delta') {
                    const acc = this.textAccumulators.get(index);
                    if (acc) {
                        acc.text += delta.text || '';
                    }
                }
                else if ((delta === null || delta === void 0 ? void 0 : delta.type) === 'tool_result_delta') {
                    // Look for active tool result accumulator by index
                    for (const acc of this.toolResultAccumulators.values()) {
                        if (delta.text) {
                            acc.text += delta.text;
                            break;
                        }
                    }
                }
            }
            else if (event.type === 'content_block_stop') {
                const acc = this.textAccumulators.get(index);
                if (acc && acc.text.trim()) {
                    events.push(this.emit({
                        type: 'Thinking',
                        text: acc.text,
                        ts: this.now(),
                    }));
                    this.textAccumulators.delete(index);
                }
            }
            else if (event.type === 'message_stop') {
                // Flush any pending text accumulators
                for (const [index, acc] of this.textAccumulators.entries()) {
                    if (acc.text.trim()) {
                        events.push(this.emit({
                            type: 'Thinking',
                            text: acc.text,
                            ts: this.now(),
                        }));
                    }
                }
                this.textAccumulators.clear();
                // Flush tool results
                for (const [toolUseId, acc] of this.toolResultAccumulators.entries()) {
                    const toolState = this.toolCalls.get(toolUseId);
                    const toolName = (toolState === null || toolState === void 0 ? void 0 : toolState.toolName) || 'unknown';
                    const toolCallEnd = {
                        type: 'ToolCallEnd',
                        toolName,
                        toolUseId,
                        output: acc.text || undefined,
                        isError: this.detectError(acc.text),
                        ts: this.now(),
                    };
                    events.push(this.emit(toolCallEnd));
                    // Detect compilation and runtime errors
                    events.push(...this.detectCompilationErrors(acc.text, toolName));
                    events.push(...this.detectRuntimeErrors(acc.text, toolName));
                    this.toolResultAccumulators.delete(toolUseId);
                }
            }
        }
        // Assistant message with text content blocks
        if (raw.type === 'assistant' && ((_d = raw.message) === null || _d === void 0 ? void 0 : _d.content)) {
            const content = raw.message.content;
            if (Array.isArray(content)) {
                for (const block of content) {
                    if (block.type === 'text' && block.text) {
                        events.push(this.emit({
                            type: 'Thinking',
                            text: block.text,
                            ts: this.now(),
                        }));
                    }
                }
            }
        }
        // ToolCallStart from tool_use events
        if (raw.type === 'tool_use') {
            const toolName = raw.name;
            const input = raw.input || {};
            const toolUseId = input.tool_use_id || `tu-${this.toolUseCounter++}`;
            this.toolCalls.set(toolUseId, { toolUseId, toolName, input });
            events.push(this.emit({
                type: 'ToolCallStart',
                toolName,
                toolUseId,
                input,
                ts: this.now(),
            }));
            // Derive file events
            events.push(...this.deriveFileEvents(toolName, input, toolUseId));
            // BashCommand
            if (toolName === 'Bash' || toolName === 'bash') {
                const command = input.command || input.cmd || '';
                events.push(this.emit({
                    type: 'BashCommand',
                    command,
                    toolUseId,
                    ts: this.now(),
                }));
                // TestRun detection
                if (this.isTestCommand(command)) {
                    events.push(this.emit({
                        type: 'TestRun',
                        command,
                        ts: this.now(),
                    }));
                }
                // FileDelete from rm commands
                events.push(...this.detectFileDeletes(command, toolUseId));
            }
        }
        // HookEvent from wrapper_event
        if (raw.type === 'wrapper_event') {
            const hookNames = /^(PreToolUse|PostToolUse|UserPromptSubmit|Stop|Notification|SubagentStop)$/;
            if (raw.name && raw.name !== 'start' && raw.name !== 'end' && hookNames.test(raw.name)) {
                events.push(this.emit({
                    type: 'HookEvent',
                    hookName: raw.name,
                    payload: raw.raw,
                    ts: this.now(),
                }));
            }
        }
        // Unknown
        if (raw.type === 'unknown') {
            events.push(this.emit({
                type: 'Unknown',
                raw: raw.raw,
                ts: this.now(),
            }));
        }
        return events;
    }
    flush() {
        const events = [];
        // Flush any pending text
        for (const acc of this.textAccumulators.values()) {
            if (acc.text.trim()) {
                events.push(this.emit({
                    type: 'Thinking',
                    text: acc.text,
                    ts: this.now(),
                }));
            }
        }
        this.textAccumulators.clear();
        // Flush tool results
        for (const [toolUseId, acc] of this.toolResultAccumulators.entries()) {
            const toolState = this.toolCalls.get(toolUseId);
            events.push(this.emit({
                type: 'ToolCallEnd',
                toolName: (toolState === null || toolState === void 0 ? void 0 : toolState.toolName) || 'unknown',
                toolUseId,
                output: acc.text || undefined,
                ts: this.now(),
            }));
        }
        this.toolResultAccumulators.clear();
        return events;
    }
    emit(event) {
        if (this.include && !this.include.has(event.type)) {
            return event;
        }
        return event;
    }
    deriveFileEvents(toolName, input, toolUseId) {
        const events = [];
        const path = input.file_path || input.path || input.filepath;
        if (toolName === 'Read' && path) {
            events.push(this.emit({
                type: 'FileRead',
                path,
                toolUseId,
                ts: this.now(),
            }));
        }
        else if (toolName === 'Write' && path) {
            events.push(this.emit({
                type: 'FileWrite',
                path,
                toolUseId,
                ts: this.now(),
            }));
        }
        else if ((toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') && path) {
            events.push(this.emit({
                type: 'FileEdit',
                path,
                toolUseId,
                ts: this.now(),
            }));
        }
        return events;
    }
    isTestCommand(command) {
        return /(^|\s)(npm\s+test|yarn\s+test|pnpm\s+test|vitest\b|jest\b|pytest\b|go\s+test\b|cargo\s+test\b)/.test(command);
    }
    detectFileDeletes(command, toolUseId) {
        const events = [];
        // Match rm commands: rm -rf foo.txt, rm a b c
        const rmMatch = /\brm\s+(?:[-\w]+\s+)*(.+)/.exec(command);
        if (rmMatch) {
            const args = rmMatch[1].trim().split(/\s+/);
            // Take the last non-flag argument as the file
            for (let i = args.length - 1; i >= 0; i--) {
                if (!args[i].startsWith('-')) {
                    events.push(this.emit({
                        type: 'FileDelete',
                        path: args[i],
                        toolUseId,
                        ts: this.now(),
                    }));
                    break;
                }
            }
        }
        return events;
    }
    detectError(output) {
        if (!output)
            return false;
        const lowerOutput = output.toLowerCase();
        return lowerOutput.includes('error') || lowerOutput.includes('failed') || lowerOutput.includes('exception');
    }
    detectCompilationErrors(output, toolName) {
        if (!output)
            return [];
        const patterns = [
            /error TS\d+[:\s].+/i,
            /error\[E\d+\][:\s].+/i,
            /SyntaxError[:\s].+/i,
            /^.*: error: .+/m,
        ];
        const events = [];
        for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
                const message = match[0].slice(0, 500);
                events.push(this.emit({
                    type: 'CompilationError',
                    message,
                    toolName,
                    ts: this.now(),
                }));
                break;
            }
        }
        return events;
    }
    detectRuntimeErrors(output, toolName) {
        if (!output)
            return [];
        const patterns = [
            /Traceback \(most recent call last\):[\s\S]{0,500}/,
            /Uncaught\s+(?:Type|Reference|Range)Error[\s\S]{0,500}/,
            /panic:[\s\S]{0,500}/,
            /thread '.*' panicked[\s\S]{0,500}/,
        ];
        const events = [];
        for (const pattern of patterns) {
            const match = output.match(pattern);
            if (match) {
                const message = match[0].slice(0, 500);
                events.push(this.emit({
                    type: 'RuntimeError',
                    message,
                    toolName,
                    ts: this.now(),
                }));
                break;
            }
        }
        return events;
    }
}
export function readAll(events, opts) {
    const reader = new FcEventReader(opts);
    const results = [];
    for (const event of events) {
        results.push(...reader.read(event));
    }
    results.push(...reader.flush());
    // Apply filter
    if (opts === null || opts === void 0 ? void 0 : opts.include) {
        return results.filter(e => opts.include.has(e.type));
    }
    return results;
}

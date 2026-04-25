import type { FCEvent } from './pyrfor-fc-adapter';

export type FcEvent =
  | { type: 'SessionStart'; sessionId?: string; model?: string; ts: number }
  | { type: 'SessionEnd'; sessionId?: string; status: 'success' | 'error' | 'aborted'; costUsd?: number; usage?: any; stopReason?: string; ts: number }
  | { type: 'Thinking'; text: string; ts: number }
  | { type: 'ToolCallStart'; toolName: string; toolUseId?: string; input: any; ts: number }
  | { type: 'ToolCallEnd'; toolName: string; toolUseId?: string; output?: any; isError?: boolean; ts: number }
  | { type: 'FileRead'; path: string; toolUseId?: string; ts: number }
  | { type: 'FileWrite'; path: string; toolUseId?: string; ts: number }
  | { type: 'FileEdit'; path: string; toolUseId?: string; ts: number }
  | { type: 'FileDelete'; path: string; toolUseId?: string; ts: number }
  | { type: 'BashCommand'; command: string; toolUseId?: string; ts: number }
  | { type: 'TestRun'; command: string; passed?: number; total?: number; ts: number }
  | { type: 'CompilationError'; message: string; toolName?: string; ts: number }
  | { type: 'RuntimeError'; message: string; toolName?: string; ts: number }
  | { type: 'HookEvent'; hookName: string; payload: any; ts: number }
  | { type: 'Unknown'; raw: any; ts: number };

export interface ReaderOptions {
  now?: () => number;
  include?: Set<FcEvent['type']>;
}

interface TextAccumulator {
  blockIndex: number;
  text: string;
}

interface ToolCallState {
  toolUseId: string;
  toolName: string;
  input: any;
}

interface ToolResultAccumulator {
  toolUseId: string;
  text: string;
}

export class FcEventReader {
  private now: () => number;
  private include?: Set<FcEvent['type']>;
  private sessionStarted = false;
  private textAccumulators = new Map<number, TextAccumulator>();
  private toolCalls = new Map<string, ToolCallState>();
  private toolResultAccumulators = new Map<string, ToolResultAccumulator>();
  private toolUseCounter = 0;

  constructor(opts?: ReaderOptions) {
    this.now = opts?.now || (() => Date.now());
    this.include = opts?.include;
  }

  read(raw: FCEvent): FcEvent[] {
    const events: FcEvent[] = [];

    if (raw.type === 'stderr') {
      return [];
    }

    // SessionStart: wrapper_event start or first message_start
    if (raw.type === 'wrapper_event' && raw.name === 'start') {
      if (!this.sessionStarted) {
        this.sessionStarted = true;
        events.push(this.emit({
          type: 'SessionStart',
          sessionId: (raw.raw as any).sessionId,
          ts: this.now(),
        }));
      }
    } else if (raw.type === 'stream_event' && raw.event?.type === 'message_start') {
      if (!this.sessionStarted) {
        this.sessionStarted = true;
        events.push(this.emit({
          type: 'SessionStart',
          model: raw.event.message?.model,
          ts: this.now(),
        }));
      }
    }

    // SessionEnd: result event
    if (raw.type === 'result') {
      const result = raw.result || raw.raw?.result || {};
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
        if (block?.type === 'text') {
          this.textAccumulators.set(index, { blockIndex: index, text: '' });
        } else if (block?.type === 'tool_result') {
          const toolUseId = block.tool_use_id || `tu-${this.toolUseCounter++}`;
          this.toolResultAccumulators.set(toolUseId, { toolUseId, text: '' });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta?.type === 'text_delta') {
          const acc = this.textAccumulators.get(index);
          if (acc) {
            acc.text += delta.text || '';
          }
        } else if (delta?.type === 'tool_result_delta') {
          // Look for active tool result accumulator by index
          for (const acc of this.toolResultAccumulators.values()) {
            if (delta.text) {
              acc.text += delta.text;
              break;
            }
          }
        }
      } else if (event.type === 'content_block_stop') {
        const acc = this.textAccumulators.get(index);
        if (acc && acc.text.trim()) {
          events.push(this.emit({
            type: 'Thinking',
            text: acc.text,
            ts: this.now(),
          }));
          this.textAccumulators.delete(index);
        }
      } else if (event.type === 'message_stop') {
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
          const toolName = toolState?.toolName || 'unknown';
          
          const toolCallEnd: FcEvent = {
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
    if (raw.type === 'assistant' && raw.message?.content) {
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

  flush(): FcEvent[] {
    const events: FcEvent[] = [];
    
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
        toolName: toolState?.toolName || 'unknown',
        toolUseId,
        output: acc.text || undefined,
        ts: this.now(),
      }));
    }
    this.toolResultAccumulators.clear();

    return events;
  }

  private emit(event: FcEvent): FcEvent {
    if (this.include && !this.include.has(event.type)) {
      return event;
    }
    return event;
  }

  private deriveFileEvents(toolName: string, input: any, toolUseId: string): FcEvent[] {
    const events: FcEvent[] = [];
    const path = input.file_path || input.path || input.filepath;

    if (toolName === 'Read' && path) {
      events.push(this.emit({
        type: 'FileRead',
        path,
        toolUseId,
        ts: this.now(),
      }));
    } else if (toolName === 'Write' && path) {
      events.push(this.emit({
        type: 'FileWrite',
        path,
        toolUseId,
        ts: this.now(),
      }));
    } else if ((toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'NotebookEdit') && path) {
      events.push(this.emit({
        type: 'FileEdit',
        path,
        toolUseId,
        ts: this.now(),
      }));
    }

    return events;
  }

  private isTestCommand(command: string): boolean {
    return /(^|\s)(npm\s+test|yarn\s+test|pnpm\s+test|vitest\b|jest\b|pytest\b|go\s+test\b|cargo\s+test\b)/.test(command);
  }

  private detectFileDeletes(command: string, toolUseId: string): FcEvent[] {
    const events: FcEvent[] = [];
    
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

  private detectError(output: string): boolean {
    if (!output) return false;
    const lowerOutput = output.toLowerCase();
    return lowerOutput.includes('error') || lowerOutput.includes('failed') || lowerOutput.includes('exception');
  }

  private detectCompilationErrors(output: string, toolName: string): FcEvent[] {
    if (!output) return [];
    
    const patterns = [
      /error TS\d+[:\s].+/i,
      /error\[E\d+\][:\s].+/i,
      /SyntaxError[:\s].+/i,
      /^.*: error: .+/m,
    ];

    const events: FcEvent[] = [];
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

  private detectRuntimeErrors(output: string, toolName: string): FcEvent[] {
    if (!output) return [];
    
    const patterns = [
      /Traceback \(most recent call last\):[\s\S]{0,500}/,
      /Uncaught\s+(?:Type|Reference|Range)Error[\s\S]{0,500}/,
      /panic:[\s\S]{0,500}/,
      /thread '.*' panicked[\s\S]{0,500}/,
    ];

    const events: FcEvent[] = [];
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

export function readAll(events: FCEvent[], opts?: ReaderOptions): FcEvent[] {
  const reader = new FcEventReader(opts);
  const results: FcEvent[] = [];
  
  for (const event of events) {
    results.push(...reader.read(event));
  }
  
  results.push(...reader.flush());
  
  // Apply filter
  if (opts?.include) {
    return results.filter(e => opts.include!.has(e.type));
  }
  
  return results;
}

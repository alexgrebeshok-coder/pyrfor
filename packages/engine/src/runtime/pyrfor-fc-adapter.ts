// @vitest-environment node
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface FCRunOptions {
  prompt: string;
  workdir?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'max';
  maxTurns?: number;
  maxBudgetUsd?: number;
  fallbackModel?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  systemPrompt?: string;
  appendSystemPrompt?: string;
  jsonSchema?: object | string;
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan';
  bare?: boolean;
  noMemory?: boolean;
  noPersist?: boolean;
  addDirs?: string[];
  resume?: string;
  resumeLast?: boolean;
  forkSession?: boolean;
  timeoutSec?: number;
  wrapperPath?: string;
  spawnFn?: typeof nodeSpawn;
  signal?: AbortSignal;
}

export type FCEvent =
  | { type: 'wrapper_event'; name: string; raw: any }
  | { type: 'stream_event'; event: any; raw: any }
  | { type: 'assistant'; message: any; raw: any }
  | { type: 'tool_use'; name: string; input: any; raw: any }
  | { type: 'result'; result: any; raw: any }
  | { type: 'stderr'; line: string }
  | { type: 'unknown'; raw: any };

export interface FCEnvelope {
  status: 'success' | 'error' | string;
  output?: string;
  error?: string | null;
  workdir?: string;
  model?: string;
  requestedModel?: string;
  durationMs?: number;
  sessionId?: string | null;
  costUsd?: number | null;
  usage?: any;
  stopReason?: string | null;
  filesTouched: string[];
  commandsRun: string[];
  exitCode: number;
  maxTurns?: number | null;
  effort?: string | null;
  maxBudgetUsd?: number | null;
  fallbackModel?: string | null;
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: string[];
  rawResult?: any;
  raw: any;
}

export interface FCRunResult {
  envelope: FCEnvelope;
  events: FCEvent[];
  exitCode: number;
}

export interface FCHandle {
  events(): AsyncIterable<FCEvent>;
  complete(): Promise<FCRunResult>;
  abort(reason?: string): void;
}

interface ToolUseAccumulator {
  name?: string;
  input?: any;
  inputJson?: string;
}

const DEFAULT_WRAPPER_PATH = '/Users/aleksandrgrebeshok/.openclaw/workspace/tools/freeclaude-run.sh';

export function runFreeClaude(opts: FCRunOptions): FCHandle {
  const wrapperPath = opts.wrapperPath || process.env.FREECLAUDE_RUN || DEFAULT_WRAPPER_PATH;
  const spawnFn = opts.spawnFn || nodeSpawn;

  const allEvents: FCEvent[] = [];
  const stderrLines: string[] = [];
  const emitter = new EventEmitter();
  let envelope: FCEnvelope | null = null;
  let exitCode: number | null = null;
  let completed = false;
  let childProcess: ChildProcess | null = null;
  let abortReason: string | undefined;
  let timeoutHandle: NodeJS.Timeout | undefined;

  // Tool use accumulator per content block index
  const toolAccumulators: Map<number, ToolUseAccumulator> = new Map();

  const args = buildArgs(opts);
  const cwd = opts.workdir || process.cwd();

  const emitEvent = (event: FCEvent) => {
    allEvents.push(event);
    emitter.emit('event', event);
  };

  const finish = () => {
    if (completed) return;
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
        exitCode: exitCode ?? -1,
        filesTouched: [],
        commandsRun: [],
        raw: {},
      };
    } else if (abortReason) {
      envelope.status = 'error';
      envelope.error = abortReason;
    }

    emitter.emit('complete');
  };

  const abort = (reason?: string) => {
    if (!childProcess || completed) return;
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

  childProcess.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');

    let newlineIndex: number;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (!line.trim()) continue;

      try {
        const parsed = JSON.parse(line);
        
        // Handle wrapper_result specially - it's the envelope
        if (parsed.type === 'wrapper_result') {
          envelope = parseEnvelope(parsed);
        } else {
          const event = classifyEvent(parsed, toolAccumulators, emitter);
          if (event) {
            emitEvent(event);
          }
        }
      } catch (err) {
        // Not valid JSON, ignore
      }
    }
  });

  childProcess.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      stderrLines.push(line);
      emitEvent({ type: 'stderr', line });
    }
  });

  childProcess.on('exit', (code) => {
    exitCode = code ?? -1;
    finish();
  });

  childProcess.on('error', (err) => {
    stderrLines.push(`Process error: ${err.message}`);
    emitEvent({ type: 'stderr', line: `Process error: ${err.message}` });
    exitCode = -1;
    finish();
  });

  return {
    async *events() {
      const eventQueue: FCEvent[] = [];
      let resolveNext: (() => void) | null = null;

      const onEvent = (event: FCEvent) => {
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
            yield eventQueue.shift()!;
          } else if (!completed) {
            await new Promise<void>((resolve) => {
              resolveNext = resolve;
            });
          }
        }
      } finally {
        emitter.off('event', onEvent);
        emitter.off('complete', onComplete);
      }
    },

    async complete(): Promise<FCRunResult> {
      if (!completed) {
        await new Promise<void>((resolve) => {
          emitter.once('complete', resolve);
        });
      }

      return {
        envelope: envelope!,
        events: allEvents,
        exitCode: exitCode ?? -1,
      };
    },

    abort,
  };
}

function buildArgs(opts: FCRunOptions): string[] {
  const args: string[] = [];

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
  } else if (opts.bare === false) {
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

function classifyEvent(
  parsed: any,
  toolAccumulators: Map<number, ToolUseAccumulator>,
  emitter: EventEmitter
): FCEvent | null {
  if (!parsed || typeof parsed !== 'object') {
    return { type: 'unknown', raw: parsed };
  }

  switch (parsed.type) {
    case 'wrapper_event':
      return { type: 'wrapper_event', name: parsed.name || '', raw: parsed };

    case 'stream_event': {
      const streamEvent: FCEvent = { type: 'stream_event', event: parsed.event || {}, raw: parsed };

      // Handle tool_use synthesis from stream events
      if (parsed.event) {
        const eventType = parsed.event.type;
        const index = parsed.event.index;

        if (eventType === 'content_block_start') {
          const block = parsed.event.content_block;
          if (block && block.type === 'tool_use') {
            const acc: ToolUseAccumulator = {
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
              } as FCEvent);
            }
          }
        } else if (eventType === 'content_block_delta') {
          const delta = parsed.event.delta;
          if (delta && delta.type === 'input_json_delta') {
            const acc = toolAccumulators.get(index);
            if (acc) {
              acc.inputJson = (acc.inputJson || '') + (delta.partial_json || '');
            }
          }
        } else if (eventType === 'content_block_stop') {
          const acc = toolAccumulators.get(index);
          if (acc && acc.inputJson && !acc.input) {
            try {
              acc.input = JSON.parse(acc.inputJson);
              emitter.emit('event', {
                type: 'tool_use',
                name: acc.name || 'unknown',
                input: acc.input,
                raw: parsed,
              } as FCEvent);
            } catch (err) {
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
            } as FCEvent);
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

function parseEnvelope(parsed: any): FCEnvelope {
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
    exitCode: parsed.exitCode ?? 0,
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

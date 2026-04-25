// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { runFreeClaude, type FCRunOptions, type FCEvent } from './pyrfor-fc-adapter.js';

// ── Mock ChildProcess factory ─────────────────────────────────────────────────

interface MockChildProcessOptions {
  stdoutChunks?: string[];
  stderrChunks?: string[];
  exitCode?: number;
  exitDelay?: number;
  errorOnSpawn?: Error;
}

function createMockChildProcess(opts: MockChildProcessOptions = {}): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdout = new EventEmitter() as Readable;
  const stderr = new EventEmitter() as Readable;

  (proc as any).stdout = stdout;
  (proc as any).stderr = stderr;
  (proc as any).stdin = new Writable();

  proc.kill = vi.fn((signal?: string) => {
    setTimeout(() => {
      proc.emit('exit', opts.exitCode ?? (signal === 'SIGKILL' ? 137 : 143), signal);
    }, 10);
    return true;
  });

  if (opts.errorOnSpawn) {
    setTimeout(() => proc.emit('error', opts.errorOnSpawn), 10);
  } else {
    // Emit stdout chunks
    if (opts.stdoutChunks) {
      setTimeout(() => {
        for (const chunk of opts.stdoutChunks!) {
          stdout.emit('data', Buffer.from(chunk));
        }
      }, 10);
    }

    // Emit stderr chunks
    if (opts.stderrChunks) {
      setTimeout(() => {
        for (const chunk of opts.stderrChunks!) {
          stderr.emit('data', Buffer.from(chunk));
        }
      }, 10);
    }

    // Emit exit
    setTimeout(() => {
      proc.emit('exit', opts.exitCode ?? 0);
    }, opts.exitDelay ?? 50);
  }

  return proc;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function collectEvents(handle: ReturnType<typeof runFreeClaude>): Promise<FCEvent[]> {
  const events: FCEvent[] = [];
  for await (const event of handle.events()) {
    events.push(event);
  }
  return events;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('pyrfor-fc-adapter', () => {
  let capturedArgs: string[] = [];
  let capturedCwd: string | undefined;

  const mockSpawn = vi.fn((cmd: string, args: string[], options: any) => {
    capturedArgs = args;
    capturedCwd = options?.cwd;
    return createMockChildProcess();
  });

  beforeEach(() => {
    capturedArgs = [];
    capturedCwd = undefined;
    mockSpawn.mockClear();
  });

  // ── 1. CLI args construction ──────────────────────────────────────────────────

  it('constructs CLI args correctly with all options', async () => {
    const opts: FCRunOptions = {
      prompt: 'test prompt',
      model: 'claude-3-opus',
      workdir: '/test/dir',
      maxTurns: 5,
      effort: 'high',
      maxBudgetUsd: 1.5,
      fallbackModel: 'claude-3-sonnet',
      allowedTools: ['bash', 'edit'],
      disallowedTools: ['web'],
      tools: ['custom-tool'],
      systemPrompt: 'You are helpful',
      appendSystemPrompt: 'Be concise',
      jsonSchema: { type: 'object' },
      permissionMode: 'acceptEdits',
      bare: true,
      noMemory: true,
      noPersist: true,
      addDirs: ['/dir1', '/dir2'],
      resume: 'session-123',
      forkSession: true,
      timeoutSec: 300,
      spawnFn: mockSpawn as any,
    };

    const handle = runFreeClaude(opts);
    await handle.complete();

    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(capturedArgs).toContain('--output-format');
    expect(capturedArgs).toContain('stream-json');
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('claude-3-opus');
    expect(capturedArgs).toContain('--workdir');
    expect(capturedArgs).toContain('/test/dir');
    expect(capturedArgs).toContain('--max-turns');
    expect(capturedArgs).toContain('5');
    expect(capturedArgs).toContain('--effort');
    expect(capturedArgs).toContain('high');
    expect(capturedArgs).toContain('--max-budget-usd');
    expect(capturedArgs).toContain('1.5');
    expect(capturedArgs).toContain('--fallback-model');
    expect(capturedArgs).toContain('claude-3-sonnet');
    expect(capturedArgs).toContain('--allowed-tools');
    expect(capturedArgs).toContain('bash,edit');
    expect(capturedArgs).toContain('--disallowed-tools');
    expect(capturedArgs).toContain('web');
    expect(capturedArgs).toContain('--tools');
    expect(capturedArgs).toContain('custom-tool');
    expect(capturedArgs).toContain('--system-prompt');
    expect(capturedArgs).toContain('You are helpful');
    expect(capturedArgs).toContain('--append-system-prompt');
    expect(capturedArgs).toContain('Be concise');
    expect(capturedArgs).toContain('--json-schema');
    expect(capturedArgs).toContain('{"type":"object"}');
    expect(capturedArgs).toContain('--permission-mode');
    expect(capturedArgs).toContain('acceptEdits');
    expect(capturedArgs).toContain('--bare');
    expect(capturedArgs).toContain('--no-memory');
    expect(capturedArgs).toContain('--no-persist');
    expect(capturedArgs).toContain('--add-dir');
    expect(capturedArgs).toContain('/dir1');
    expect(capturedArgs).toContain('/dir2');
    expect(capturedArgs).toContain('--resume');
    expect(capturedArgs).toContain('session-123');
    expect(capturedArgs).toContain('--fork-session');
    expect(capturedArgs).toContain('--timeout');
    expect(capturedArgs).toContain('300');
    expect(capturedArgs).toContain('--');
    expect(capturedArgs[capturedArgs.length - 1]).toBe('test prompt');
    expect(capturedCwd).toBe('/test/dir');
  });

  it('handles resumeLast flag', async () => {
    const opts: FCRunOptions = {
      prompt: 'resume test',
      resumeLast: true,
      spawnFn: mockSpawn as any,
    };

    const handle = runFreeClaude(opts);
    await handle.complete();

    expect(capturedArgs).toContain('--resume-last');
  });

  it('handles bare: false with --no-bare', async () => {
    const opts: FCRunOptions = {
      prompt: 'test',
      bare: false,
      spawnFn: mockSpawn as any,
    };

    const handle = runFreeClaude(opts);
    await handle.complete();

    expect(capturedArgs).toContain('--no-bare');
    expect(capturedArgs).not.toContain('--bare');
  });

  it('prompt with leading dashes is passed after -- separator', async () => {
    const opts: FCRunOptions = {
      prompt: '--something important',
      spawnFn: mockSpawn as any,
    };

    const handle = runFreeClaude(opts);
    await handle.complete();

    expect(capturedArgs).toContain('--');
    const dashIndex = capturedArgs.indexOf('--');
    expect(dashIndex).toBeGreaterThan(-1);
    expect(capturedArgs[dashIndex + 1]).toBe('--something important');
  });

  // ── 2. Event streaming ────────────────────────────────────────────────────────

  it('parses NDJSON and emits events in order', async () => {
    const ndjsonLines = [
      '{"type":"wrapper_event","name":"start","timestamp":"2024-01-01T00:00:00Z"}',
      '{"type":"stream_event","event":{"type":"message_start","message":{"role":"assistant"}}}',
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}]}}',
      '{"type":"result","result":{"output":"Done"}}',
      '{"type":"wrapper_result","status":"success","filesTouched":["a.ts"],"commandsRun":["ls"],"exitCode":0}',
    ];

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ndjsonLines.map(l => l + '\n'),
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);
    const result = await handle.complete();

    expect(events).toHaveLength(4); // wrapper_event, stream_event, assistant, result (no wrapper_result as event)
    expect(events[0].type).toBe('wrapper_event');
    expect(events[1].type).toBe('stream_event');
    expect(events[2].type).toBe('assistant');
    expect(events[3].type).toBe('result');

    expect(result.envelope.status).toBe('success');
    expect(result.envelope.filesTouched).toEqual(['a.ts']);
    expect(result.envelope.commandsRun).toEqual(['ls']);
    expect(result.exitCode).toBe(0);
  });

  it('handles partial-line buffering across chunks', async () => {
    const line1 = '{"type":"wrapper_event","name":"start"}';
    const line2 = '{"type":"wrapper_event","name":"end"}';

    // Split lines across chunks mid-JSON
    const chunks = [
      line1.slice(0, 20) + '\n',
      line2.slice(0, 15),
      line2.slice(15) + '\n',
    ];

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: chunks,
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);

    // Should parse partial chunks correctly
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  // ── 3. tool_use synthesis ─────────────────────────────────────────────────────

  it('synthesizes tool_use from content_block_start with immediate input', async () => {
    const ndjsonLines = [
      '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool1","name":"bash","input":{"command":"ls"}}}}',
      '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}',
      '{"type":"wrapper_result","status":"success","filesTouched":[],"commandsRun":[],"exitCode":0}',
    ];

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ndjsonLines.map(l => l + '\n'),
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);

    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]).toMatchObject({
      type: 'tool_use',
      name: 'bash',
      input: { command: 'ls' },
    });
  });

  it('synthesizes tool_use from accumulated input_json_delta', async () => {
    const ndjsonLines = [
      '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool1","name":"edit"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"/"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"test.ts\\"}"}}}',
      '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}',
      '{"type":"wrapper_result","status":"success","filesTouched":[],"commandsRun":[],"exitCode":0}',
    ];

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ndjsonLines.map(l => l + '\n'),
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);

    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]).toMatchObject({
      type: 'tool_use',
      name: 'edit',
      input: { path: '/test.ts' },
    });
  });

  it('emits tool_use from assistant messages with tool_use blocks', async () => {
    const ndjsonLines = [
      '{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"bash","input":{"command":"pwd"}},{"type":"text","text":"Running command"}]}}',
      '{"type":"wrapper_result","status":"success","filesTouched":[],"commandsRun":[],"exitCode":0}',
    ];

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ndjsonLines.map(l => l + '\n'),
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);

    const toolUseEvents = events.filter(e => e.type === 'tool_use');
    expect(toolUseEvents).toHaveLength(1);
    expect(toolUseEvents[0]).toMatchObject({
      type: 'tool_use',
      name: 'bash',
      input: { command: 'pwd' },
    });
  });

  // ── 4. Envelope extraction ────────────────────────────────────────────────────

  it('extracts envelope from wrapper_result line', async () => {
    const envelope = {
      type: 'wrapper_result',
      status: 'success',
      output: 'Task completed',
      model: 'claude-3-opus',
      sessionId: 'sess-123',
      costUsd: 0.05,
      usage: { input_tokens: 100, output_tokens: 50 },
      filesTouched: ['file1.ts', 'file2.ts'],
      commandsRun: ['npm test'],
      exitCode: 0,
      durationMs: 5000,
      stopReason: 'end_turn',
    };

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: [JSON.stringify(envelope) + '\n'],
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const result = await handle.complete();

    expect(result.envelope.status).toBe('success');
    expect(result.envelope.output).toBe('Task completed');
    expect(result.envelope.model).toBe('claude-3-opus');
    expect(result.envelope.sessionId).toBe('sess-123');
    expect(result.envelope.costUsd).toBe(0.05);
    expect(result.envelope.filesTouched).toEqual(['file1.ts', 'file2.ts']);
    expect(result.envelope.commandsRun).toEqual(['npm test']);
    expect(result.envelope.durationMs).toBe(5000);
    expect(result.envelope.stopReason).toBe('end_turn');
  });

  // ── 5. abort() ────────────────────────────────────────────────────────────────

  it('abort() sends SIGTERM and results in error envelope', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        exitCode: 143,
        exitDelay: 500,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    // Abort after a short delay
    setTimeout(() => handle.abort('User requested'), 20);

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('User requested');
  });

  // ── 6. timeout ────────────────────────────────────────────────────────────────

  it('timeout triggers abort after timeoutSec', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        exitCode: 143,
        exitDelay: 500,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      timeoutSec: 0.05, // 50ms
      spawnFn: mockSpawnLocal as any,
    });

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('Timeout');
  });

  // ── 7. Missing wrapper_result → synthesized error ────────────────────────────

  it('synthesizes error envelope when no wrapper_result is present', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ['{"type":"wrapper_event","name":"start"}\n'],
        stderrChunks: ['Error: Something went wrong\n', 'Stack trace here\n'],
        exitCode: 1,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('Something went wrong');
    expect(result.envelope.exitCode).toBe(1);
    expect(result.exitCode).toBe(1);
  });

  // ── 8. stderr events ──────────────────────────────────────────────────────────

  it('emits stderr lines as stderr events', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: ['{"type":"wrapper_result","status":"success","filesTouched":[],"commandsRun":[],"exitCode":0}\n'],
        stderrChunks: ['Warning: deprecated API\n', 'Info: connecting...\n'],
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);
    const stderrEvents = events.filter(e => e.type === 'stderr');

    expect(stderrEvents).toHaveLength(2);
    expect(stderrEvents[0]).toMatchObject({
      type: 'stderr',
      line: 'Warning: deprecated API',
    });
    expect(stderrEvents[1]).toMatchObject({
      type: 'stderr',
      line: 'Info: connecting...',
    });
  });

  // ── 9. Signal cancellation ────────────────────────────────────────────────────

  it('honors AbortSignal and calls abort()', async () => {
    const controller = new AbortController();

    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        exitCode: 143,
        exitDelay: 500,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      signal: controller.signal,
      spawnFn: mockSpawnLocal as any,
    });

    setTimeout(() => controller.abort(), 20);

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('Signal aborted');
  });

  // ── 10. Fire-and-collect mode ─────────────────────────────────────────────────

  it('supports fire-and-collect mode (complete without streaming)', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: [
          '{"type":"wrapper_event","name":"start"}\n',
          '{"type":"wrapper_result","status":"success","filesTouched":["test.ts"],"commandsRun":[],"exitCode":0}\n',
        ],
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    // Call complete() without consuming events()
    const result = await handle.complete();

    expect(result.envelope.status).toBe('success');
    expect(result.events).toHaveLength(1); // wrapper_event captured
  });

  // ── 11. Unknown event types ───────────────────────────────────────────────────

  it('classifies unknown JSON as unknown event', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: [
          '{"type":"custom_event","data":"something"}\n',
          '{"type":"wrapper_result","status":"success","filesTouched":[],"commandsRun":[],"exitCode":0}\n',
        ],
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const events = await collectEvents(handle);

    const unknownEvents = events.filter(e => e.type === 'unknown');
    expect(unknownEvents).toHaveLength(1);
    expect(unknownEvents[0].raw).toMatchObject({
      type: 'custom_event',
      data: 'something',
    });
  });

  // ── 12. Process error ─────────────────────────────────────────────────────────

  it('handles process spawn errors', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        errorOnSpawn: new Error('ENOENT: command not found'),
        exitCode: -1,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('ENOENT');
    expect(result.exitCode).toBe(-1);
  });

  // ── 13. Empty output ──────────────────────────────────────────────────────────

  it('handles empty stdout gracefully', async () => {
    const mockSpawnLocal = vi.fn(() => {
      return createMockChildProcess({
        stdoutChunks: [],
        exitCode: 0,
      });
    });

    const handle = runFreeClaude({
      prompt: 'test',
      spawnFn: mockSpawnLocal as any,
    });

    const result = await handle.complete();

    expect(result.envelope.status).toBe('error');
    expect(result.envelope.error).toContain('No wrapper_result');
  });
});

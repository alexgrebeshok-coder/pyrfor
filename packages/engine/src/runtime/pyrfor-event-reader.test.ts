import { describe, it, expect } from 'vitest';
import { FcEventReader, readAll, type FcEvent } from './pyrfor-event-reader';
import type { FCEvent } from './pyrfor-fc-adapter';

describe('FcEventReader', () => {
  const mockNow = () => 1234567890;

  it('returns no events for empty input after flush', () => {
    const reader = new FcEventReader({ now: mockNow });
    const events = reader.flush();
    expect(events).toEqual([]);
  });

  it('emits SessionStart from wrapper_event start', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'wrapper_event',
      name: 'start',
      raw: { sessionId: 'sess-123' },
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'SessionStart',
      sessionId: 'sess-123',
      ts: 1234567890,
    });
  });

  it('emits SessionStart from message_start when no wrapper start', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { model: 'claude-3-opus' },
      },
      raw: {},
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'SessionStart',
      model: 'claude-3-opus',
      ts: 1234567890,
    });
  });

  it('emits SessionEnd from result with cost/usage/stopReason', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'result',
      result: {
        result: 'ok',
        total_cost_usd: 0.123,
        usage: { input_tokens: 100 },
        stop_reason: 'end_turn',
        session_id: 'sess-456',
      },
      raw: {},
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'SessionEnd',
      sessionId: 'sess-456',
      status: 'success',
      costUsd: 0.123,
      usage: { input_tokens: 100 },
      stopReason: 'end_turn',
      ts: 1234567890,
    });
  });

  it('accumulates text_delta across multiple chunks and emits Thinking on content_block_stop', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const start: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      raw: {},
    };
    const delta1: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
      raw: {},
    };
    const delta2: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world!' } },
      raw: {},
    };
    const stop: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_stop', index: 0 },
      raw: {},
    };

    expect(reader.read(start)).toHaveLength(0);
    expect(reader.read(delta1)).toHaveLength(0);
    expect(reader.read(delta2)).toHaveLength(0);
    
    const events = reader.read(stop);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'Thinking',
      text: 'Hello world!',
      ts: 1234567890,
    });
  });

  it('emits Thinking from assistant message with text content block', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Thinking about the problem...' },
        ],
      },
      raw: {},
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'Thinking',
      text: 'Thinking about the problem...',
      ts: 1234567890,
    });
  });

  it('emits ToolCallStart and BashCommand for Bash tool_use', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'ls -la', tool_use_id: 'tu-bash-1' },
      raw: {},
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'ToolCallStart',
      toolName: 'Bash',
      toolUseId: 'tu-bash-1',
      input: { command: 'ls -la', tool_use_id: 'tu-bash-1' },
      ts: 1234567890,
    });
    expect(events[1]).toMatchObject({
      type: 'BashCommand',
      command: 'ls -la',
      toolUseId: 'tu-bash-1',
      ts: 1234567890,
    });
  });

  it('emits TestRun for vitest command', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'vitest run', tool_use_id: 'tu-test-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const testRun = events.find(e => e.type === 'TestRun');
    expect(testRun).toBeDefined();
    expect(testRun).toMatchObject({
      type: 'TestRun',
      command: 'vitest run',
      ts: 1234567890,
    });
  });

  it('emits FileEdit for Edit tool_use', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Edit',
      input: { path: '/src/app.ts', tool_use_id: 'tu-edit-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileEdit = events.find(e => e.type === 'FileEdit');
    expect(fileEdit).toBeDefined();
    expect(fileEdit).toMatchObject({
      type: 'FileEdit',
      path: '/src/app.ts',
      toolUseId: 'tu-edit-1',
      ts: 1234567890,
    });
  });

  it('emits FileRead for Read tool_use', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Read',
      input: { file_path: '/src/config.json', tool_use_id: 'tu-read-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileRead = events.find(e => e.type === 'FileRead');
    expect(fileRead).toBeDefined();
    expect(fileRead).toMatchObject({
      type: 'FileRead',
      path: '/src/config.json',
      toolUseId: 'tu-read-1',
      ts: 1234567890,
    });
  });

  it('emits FileWrite for Write tool_use', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Write',
      input: { path: '/output/result.txt', tool_use_id: 'tu-write-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileWrite = events.find(e => e.type === 'FileWrite');
    expect(fileWrite).toBeDefined();
    expect(fileWrite).toMatchObject({
      type: 'FileWrite',
      path: '/output/result.txt',
      toolUseId: 'tu-write-1',
      ts: 1234567890,
    });
  });

  it('emits FileDelete for rm -rf command', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'rm -rf foo.txt', tool_use_id: 'tu-rm-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileDelete = events.find(e => e.type === 'FileDelete');
    expect(fileDelete).toBeDefined();
    expect(fileDelete).toMatchObject({
      type: 'FileDelete',
      path: 'foo.txt',
      toolUseId: 'tu-rm-1',
      ts: 1234567890,
    });
  });

  it('emits FileDelete for rm with multiple files (last arg)', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'rm a b c', tool_use_id: 'tu-rm-2' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileDelete = events.find(e => e.type === 'FileDelete');
    expect(fileDelete).toBeDefined();
    expect(fileDelete).toMatchObject({
      type: 'FileDelete',
      path: 'c',
      toolUseId: 'tu-rm-2',
      ts: 1234567890,
    });
  });

  it('emits ToolCallEnd with output from tool_result block via message_stop', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    // First register the tool call
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'echo hello', tool_use_id: 'tu-echo-1' },
      raw: {},
    };
    reader.read(toolUse);
    
    // Then simulate tool_result stream
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-echo-1' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: 'hello\n' },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const toolCallEnd = events.find(e => e.type === 'ToolCallEnd');
    expect(toolCallEnd).toBeDefined();
    expect(toolCallEnd).toMatchObject({
      type: 'ToolCallEnd',
      toolName: 'Bash',
      toolUseId: 'tu-echo-1',
      output: 'hello\n',
      ts: 1234567890,
    });
  });

  it('emits CompilationError for TypeScript error in output', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'tsc', tool_use_id: 'tu-tsc-1' },
      raw: {},
    };
    reader.read(toolUse);
    
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-tsc-1' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: 'error TS2345: Argument of type "string" is not assignable to parameter of type "number".' },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const compilationError = events.find(e => e.type === 'CompilationError');
    expect(compilationError).toBeDefined();
    expect(compilationError).toMatchObject({
      type: 'CompilationError',
      toolName: 'Bash',
      ts: 1234567890,
    });
    expect((compilationError as any).message).toContain('error TS2345');
  });

  it('emits RuntimeError for Python traceback', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'python script.py', tool_use_id: 'tu-py-1' },
      raw: {},
    };
    reader.read(toolUse);
    
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-py-1' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: 'Traceback (most recent call last):\n  File "script.py", line 5\n    x = 1/0\nZeroDivisionError: division by zero' },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const runtimeError = events.find(e => e.type === 'RuntimeError');
    expect(runtimeError).toBeDefined();
    expect(runtimeError).toMatchObject({
      type: 'RuntimeError',
      toolName: 'Bash',
      ts: 1234567890,
    });
    expect((runtimeError as any).message).toContain('Traceback');
  });

  it('emits HookEvent for PreToolUse wrapper_event', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'wrapper_event',
      name: 'PreToolUse',
      raw: { toolName: 'Bash', timestamp: 12345 },
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'HookEvent',
      hookName: 'PreToolUse',
      payload: { toolName: 'Bash', timestamp: 12345 },
      ts: 1234567890,
    });
  });

  it('filters events when include set is provided', () => {
    const include = new Set<FcEvent['type']>(['BashCommand']);
    const events: FCEvent[] = [
      { type: 'tool_use', name: 'Bash', input: { command: 'ls', tool_use_id: 'tu-1' }, raw: {} },
      { type: 'tool_use', name: 'Read', input: { path: '/file.txt', tool_use_id: 'tu-2' }, raw: {} },
    ];
    
    const result = readAll(events, { now: mockNow, include });
    
    expect(result.every(e => e.type === 'BashCommand')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles unknown event type', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'unknown',
      raw: { foo: 'bar' },
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'Unknown',
      raw: { foo: 'bar' },
      ts: 1234567890,
    });
  });

  it('skips stderr events', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'stderr',
      line: 'Some error message',
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(0);
  });

  it('detects npm test as TestRun', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'npm test', tool_use_id: 'tu-npm-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const testRun = events.find(e => e.type === 'TestRun');
    expect(testRun).toBeDefined();
    expect(testRun).toMatchObject({
      type: 'TestRun',
      command: 'npm test',
    });
  });

  it('detects jest as TestRun', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'jest --coverage', tool_use_id: 'tu-jest-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const testRun = events.find(e => e.type === 'TestRun');
    expect(testRun).toBeDefined();
  });

  it('handles NotebookEdit as FileEdit', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'NotebookEdit',
      input: { path: '/notebook.ipynb', tool_use_id: 'tu-nb-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const fileEdit = events.find(e => e.type === 'FileEdit');
    expect(fileEdit).toBeDefined();
    expect(fileEdit).toMatchObject({
      type: 'FileEdit',
      path: '/notebook.ipynb',
      toolUseId: 'tu-nb-1',
    });
  });

  it('truncates CompilationError message to 500 chars', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'tsc', tool_use_id: 'tu-tsc-2' },
      raw: {},
    };
    reader.read(toolUse);
    
    const longError = 'error TS2345: ' + 'x'.repeat(1000);
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-tsc-2' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: longError },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const compilationError = events.find(e => e.type === 'CompilationError');
    expect(compilationError).toBeDefined();
    expect((compilationError as any).message.length).toBeLessThanOrEqual(500);
  });

  it('readAll convenience function processes array of events', () => {
    const events: FCEvent[] = [
      { type: 'wrapper_event', name: 'start', raw: { sessionId: 'sess-x' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'echo hi', tool_use_id: 'tu-x' }, raw: {} },
      { type: 'result', result: { result: 'ok' }, raw: {} },
    ];
    
    const result = readAll(events, { now: mockNow });
    
    expect(result.length).toBeGreaterThan(0);
    expect(result.some(e => e.type === 'SessionStart')).toBe(true);
    expect(result.some(e => e.type === 'BashCommand')).toBe(true);
    expect(result.some(e => e.type === 'SessionEnd')).toBe(true);
  });

  it('does not emit duplicate SessionStart', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const start1: FCEvent = {
      type: 'wrapper_event',
      name: 'start',
      raw: { sessionId: 'sess-1' },
    };
    const start2: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_start', message: { model: 'claude' } },
      raw: {},
    };
    
    const events1 = reader.read(start1);
    const events2 = reader.read(start2);
    
    expect(events1.filter(e => e.type === 'SessionStart')).toHaveLength(1);
    expect(events2.filter(e => e.type === 'SessionStart')).toHaveLength(0);
  });

  it('flushes pending text on flush()', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const start: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      raw: {},
    };
    const delta: FCEvent = {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Pending text' } },
      raw: {},
    };
    
    reader.read(start);
    reader.read(delta);
    
    const flushed = reader.flush();
    expect(flushed.some(e => e.type === 'Thinking' && (e as any).text === 'Pending text')).toBe(true);
  });

  it('handles PostToolUse hook event', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'wrapper_event',
      name: 'PostToolUse',
      raw: { result: 'success' },
    };
    const events = reader.read(raw);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'HookEvent',
      hookName: 'PostToolUse',
    });
  });

  it('handles Rust compilation error format', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'cargo build', tool_use_id: 'tu-cargo-1' },
      raw: {},
    };
    reader.read(toolUse);
    
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-cargo-1' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: 'error[E0277]: the trait bound `i32: std::fmt::Display` is not satisfied' },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const compilationError = events.find(e => e.type === 'CompilationError');
    expect(compilationError).toBeDefined();
  });

  it('handles Uncaught TypeError as RuntimeError', () => {
    const reader = new FcEventReader({ now: mockNow });
    
    const toolUse: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'node app.js', tool_use_id: 'tu-node-1' },
      raw: {},
    };
    reader.read(toolUse);
    
    const resultStart: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_result', tool_use_id: 'tu-node-1' },
      },
      raw: {},
    };
    const resultDelta: FCEvent = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'tool_result_delta', text: 'Uncaught TypeError: Cannot read property "foo" of undefined' },
      },
      raw: {},
    };
    const messageStop: FCEvent = {
      type: 'stream_event',
      event: { type: 'message_stop' },
      raw: {},
    };

    reader.read(resultStart);
    reader.read(resultDelta);
    const events = reader.read(messageStop);
    
    const runtimeError = events.find(e => e.type === 'RuntimeError');
    expect(runtimeError).toBeDefined();
  });

  it('handles go test as TestRun', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Bash',
      input: { command: 'go test ./...', tool_use_id: 'tu-go-1' },
      raw: {},
    };
    const events = reader.read(raw);
    const testRun = events.find(e => e.type === 'TestRun');
    expect(testRun).toBeDefined();
  });

  it('assigns auto-generated tool_use_id when not provided', () => {
    const reader = new FcEventReader({ now: mockNow });
    const raw: FCEvent = {
      type: 'tool_use',
      name: 'Read',
      input: { path: '/file.txt' },
      raw: {},
    };
    const events = reader.read(raw);
    const toolCallStart = events.find(e => e.type === 'ToolCallStart');
    expect(toolCallStart).toBeDefined();
    expect((toolCallStart as any).toolUseId).toMatch(/^tu-\d+$/);
  });
});

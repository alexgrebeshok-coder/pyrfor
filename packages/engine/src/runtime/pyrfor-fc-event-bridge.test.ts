import { describe, it, expect } from 'vitest';
import { fcEventToAcp, fcEventsToAcp, FcAcpBridge } from './pyrfor-fc-event-bridge';
import type { FcEvent } from './pyrfor-event-reader';
import type { AcpEvent } from './acp-client';

const SID = 'test-session';
const opts = { sessionId: SID, now: () => 1000 };

// ─── pure mapping tests ───────────────────────────────────────────────────────

describe('fcEventToAcp — pure mapping', () => {
  it('1. Thinking → 1 agent_message_chunk with text', () => {
    const fc: FcEvent = { type: 'Thinking', text: 'I am reasoning...', ts: 1000 };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject<Partial<AcpEvent>>({
      sessionId: SID,
      type: 'agent_message_chunk',
      ts: 1000,
    });
    expect((out[0].data as any).text).toBe('I am reasoning...');
  });

  it('2. ToolCallStart Bash → 1 tool_call with kind execute', () => {
    const fc: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Bash',
      toolUseId: 'tu-bash-1',
      input: { command: 'npm test' },
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sessionId: SID,
      type: 'tool_call',
    });
    const d = out[0].data as any;
    expect(d.kind).toBe('execute');
    expect(d.name).toBe('Bash');
    expect(d.id).toBe('tu-bash-1');
  });

  it('3. ToolCallStart Edit → 1 tool_call with kind edit', () => {
    const fc: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Edit',
      toolUseId: 'tu-edit-1',
      input: { file_path: 'src/foo.ts', old_string: 'x', new_string: 'y' },
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect((out[0].data as any).kind).toBe('edit');
  });

  it('4. ToolCallStart Read → 1 tool_call with kind read', () => {
    const fc: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Read',
      toolUseId: 'tu-read-1',
      input: { file_path: 'src/foo.ts' },
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect((out[0].data as any).kind).toBe('read');
  });

  it('5. ToolCallEnd → 1 tool_call_update with output and isError', () => {
    const fc: FcEvent = {
      type: 'ToolCallEnd',
      toolName: 'Bash',
      toolUseId: 'tu-1',
      output: 'stdout here',
      isError: false,
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('tool_call_update');
    const d = out[0].data as any;
    expect(d.output).toBe('stdout here');
    expect(d.isError).toBe(false);
    expect(d.id).toBe('tu-1');
  });

  it('6. FileWrite → diff event with operation write', () => {
    const fc: FcEvent = {
      type: 'FileWrite',
      path: 'src/app.ts',
      toolUseId: 'tu-w-1',
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('diff');
    expect((out[0].data as any).operation).toBe('write');
    expect((out[0].data as any).path).toBe('src/app.ts');
  });

  it('7. FileDelete → diff event with operation delete', () => {
    const fc: FcEvent = {
      type: 'FileDelete',
      path: 'src/old.ts',
      toolUseId: 'tu-d-1',
      ts: 1000,
    };
    const out = fcEventToAcp(fc, opts);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('diff');
    expect((out[0].data as any).operation).toBe('delete');
  });

  it('8. SessionStart → empty array', () => {
    const fc: FcEvent = { type: 'SessionStart', ts: 1000 };
    expect(fcEventToAcp(fc, opts)).toHaveLength(0);
  });

  it('8b. SessionEnd → empty array', () => {
    const fc: FcEvent = { type: 'SessionEnd', status: 'success', ts: 1000 };
    expect(fcEventToAcp(fc, opts)).toHaveLength(0);
  });

  it('9. Unknown → empty array', () => {
    const fc: FcEvent = { type: 'Unknown', raw: { something: 'weird' }, ts: 1000 };
    expect(fcEventToAcp(fc, opts)).toHaveLength(0);
  });

  it('fcEventsToAcp bulk-translates multiple events', () => {
    const fcs: FcEvent[] = [
      { type: 'Thinking', text: 'hello', ts: 1000 },
      { type: 'FileDelete', path: 'foo.ts', ts: 1001 },
    ];
    const out = fcEventsToAcp(fcs, opts);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('agent_message_chunk');
    expect(out[1].type).toBe('diff');
  });
});

// ─── stateful FcAcpBridge dedup tests ────────────────────────────────────────

describe('FcAcpBridge — stateful dedup', () => {
  it('10. BashCommand is deduped when matching ToolCallStart id was seen', () => {
    const bridge = new FcAcpBridge({ sessionId: SID });

    const bashStart: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Bash',
      toolUseId: 'tu-bash-x',
      input: { command: 'ls' },
      ts: 1000,
    };
    const bashCmd: FcEvent = {
      type: 'BashCommand',
      command: 'ls',
      toolUseId: 'tu-bash-x',
      ts: 1001,
    };

    const out = bridge.translate([bashStart, bashCmd]);
    // Only 1 event: the tool_call from ToolCallStart; BashCommand is dropped.
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('tool_call');
  });

  it('11. BashCommand is NOT deduped when toolUseId was NOT seen', () => {
    const bridge = new FcAcpBridge({ sessionId: SID });

    const bashCmd: FcEvent = {
      type: 'BashCommand',
      command: 'echo hi',
      toolUseId: 'tu-unseen-99',
      ts: 1000,
    };

    const out = bridge.translate([bashCmd]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('terminal');
    expect((out[0].data as any).command).toBe('echo hi');
  });

  it('FileRead is always skipped (deduped) regardless of id', () => {
    const bridge = new FcAcpBridge({ sessionId: SID });

    const readStart: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Read',
      toolUseId: 'tu-read-1',
      input: { file_path: 'src/x.ts' },
      ts: 1000,
    };
    const fileRead: FcEvent = {
      type: 'FileRead',
      path: 'src/x.ts',
      toolUseId: 'tu-read-1',
      ts: 1001,
    };

    const out = bridge.translate([readStart, fileRead]);
    // Only the ToolCallStart tool_call is emitted; FileRead is always skipped.
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('tool_call');
    expect((out[0].data as any).kind).toBe('read');
  });

  it('FileWrite diff is always emitted even when toolUseId was seen', () => {
    const bridge = new FcAcpBridge({ sessionId: SID });

    const writeStart: FcEvent = {
      type: 'ToolCallStart',
      toolName: 'Write',
      toolUseId: 'tu-w-1',
      input: { file_path: 'src/y.ts' },
      ts: 1000,
    };
    const fileWrite: FcEvent = {
      type: 'FileWrite',
      path: 'src/y.ts',
      toolUseId: 'tu-w-1',
      ts: 1001,
    };

    const out = bridge.translate([writeStart, fileWrite]);
    // tool_call for Write + diff for FileWrite — diff is required for extractTouchedPaths
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('tool_call');
    expect(out[1].type).toBe('diff');
  });

  it('ring buffer does not dedupe a different tool id', () => {
    const bridge = new FcAcpBridge({ sessionId: SID });

    // Add tu-A to the ring
    bridge.translate([
      {
        type: 'ToolCallStart',
        toolName: 'Bash',
        toolUseId: 'tu-A',
        input: {},
        ts: 1000,
      } satisfies FcEvent,
    ]);

    // BashCommand with a different id should not be deduped
    const out = bridge.translate([
      {
        type: 'BashCommand',
        command: 'pwd',
        toolUseId: 'tu-B',
        ts: 1001,
      } satisfies FcEvent,
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('terminal');
  });
});

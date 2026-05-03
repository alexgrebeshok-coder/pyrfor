// @vitest-environment node
/**
 * Tests for packages/engine/src/runtime/acp-client.ts
 *
 * Uses a real child process (fake-acp-agent.mjs) to exercise the full
 * JSON-RPC-over-stdio transport without mocking internals.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAcpClient, AcpQueueOverflowError, AcpTimeoutError } from './acp-client';
import type { AcpClient, AcpSession, AcpEvent, AcpClientOptions } from './acp-client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT = join(__dirname, '__fixtures__/fake-acp-agent.mjs');

// Helper: build standard client options.
function makeOpts(overrides: Partial<AcpClientOptions> = {}): AcpClientOptions {
  return {
    command: 'node',
    args: [AGENT],
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
    ...overrides,
  };
}

// Helper: create + initialize a client, track it for afterEach cleanup.
async function spawnClient(
  register: (c: AcpClient) => void,
  overrides: Partial<AcpClientOptions> = {},
): Promise<AcpClient> {
  const client = createAcpClient(makeOpts(overrides));
  register(client);
  await client.initialize();
  return client;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('ACP Client', () => {
  let clients: AcpClient[] = [];

  function track(c: AcpClient): void {
    clients.push(c);
  }

  afterEach(async () => {
    // Best-effort cleanup so stray child processes don't pollute subsequent tests.
    await Promise.allSettled(clients.map((c) => c.shutdown()));
    clients = [];
  });

  // ── 1. spawn + initialize ─────────────────────────────────────────────────

  it('spawn + initialize succeeds', async () => {
    const client = createAcpClient(makeOpts());
    track(client);
    const info = await client.initialize();
    expect(info.protocolVersion).toBe('2026-03');
    expect(info.agentName).toBe('FakeAcpAgent');
    expect(client.isAlive()).toBe(true);
  });

  // ── 2. initialize timeout ─────────────────────────────────────────────────

  it('initialize timeout rejects and kills child', async () => {
    // Use a command that reads stdin forever but never writes stdout.
    const client = createAcpClient({
      command: 'node',
      args: ['-e', 'process.stdin.resume()'],
      startupTimeoutMs: 150,
      requestTimeoutMs: 5_000,
    });
    // Do NOT track — the client kills itself on timeout.
    await expect(client.initialize()).rejects.toBeInstanceOf(AcpTimeoutError);
    expect(client.isAlive()).toBe(false);
  });

  // ── 3. newSession returns session with id ─────────────────────────────────

  it('newSession returns an AcpSession with a string id', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    expect(typeof session.id).toBe('string');
    expect(session.id.length).toBeGreaterThan(0);
    expect(session.cwd).toBeTruthy();
  });

  // ── 4. prompt returns end_turn + collected events ─────────────────────────

  it('prompt returns stopReason=end_turn with 2 collected events', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const result = await session.prompt('hello');
    expect(result.stopReason).toBe('end_turn');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('plan');
    expect(result.events[1].type).toBe('tool_call');
    expect(result.events.every((e) => e.sessionId === session.id)).toBe(true);
  });

  it('preserves raw Worker Protocol frames from session/update worker_frame events', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const result = await session.prompt('WORKER_FRAME');

    expect(result.stopReason).toBe('end_turn');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'worker_frame',
      data: {
        protocol_version: 'wp.v2',
        type: 'heartbeat',
        frame_id: 'frame-1',
        run_id: 'run-1',
      },
    });
  });

  // ── 5. onEvent callback fires for every session/update ───────────────────

  it('onEvent callback fires for every update notification', async () => {
    const fired: AcpEvent[] = [];
    const client = await spawnClient(track, { onEvent: (e) => fired.push(e) });
    const session = await client.newSession();
    await session.prompt('hello');
    expect(fired).toHaveLength(2);
    expect(fired[0].type).toBe('plan');
    expect(fired[1].type).toBe('tool_call');
  });

  // ── 6. events() async iterator yields events ─────────────────────────────

  it('events() async iterator yields all session/update events', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const collected: AcpEvent[] = [];

    // Start iterating before the prompt so no events are missed.
    const iterDone = (async () => {
      for await (const e of session.events()) {
        collected.push(e);
      }
    })();

    await session.prompt('hello');   // emits 2 events
    await session.close();           // closes queue → iterator terminates
    await iterDone;

    expect(collected).toHaveLength(2);
    expect(collected[0].type).toBe('plan');
    expect(collected[1].type).toBe('tool_call');
  });

  // ── 7. inject sends additional session/prompt during active prompt ────────

  it('inject accumulates events into the active prompt collector', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();

    // Start a prompt that won't resolve until inject arrives.
    const promptPromise = session.prompt('INJECT_TEST');

    // Tiny wait so the initial prompt request is sent and the fake agent
    // emits its first 'plan' notification before we inject.
    await new Promise((r) => setTimeout(r, 60));

    await session.inject('injected text');

    const result = await promptPromise;
    expect(result.stopReason).toBe('end_turn');
    // Expect: plan (from initial) + agent_message_chunk (from inject).
    expect(result.events).toHaveLength(2);
    expect(result.events[0].type).toBe('plan');
    expect(result.events[1].type).toBe('agent_message_chunk');
    expect((result.events[1].data as { text: string }).text).toContain('injected text');
  });

  // ── 8. cancel resolves prompt with stopReason=cancelled ──────────────────

  it('cancel resolves the active prompt with stopReason=cancelled', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();

    const promptPromise = session.prompt('WAIT_TIMEOUT');

    // Let the request travel before cancelling.
    await new Promise((r) => setTimeout(r, 60));
    await session.cancel();

    const result = await promptPromise;
    expect(result.stopReason).toBe('cancelled');
  });

  // ── 9. request_permission — allow path ───────────────────────────────────

  it('request_permission allow: onPermissionRequest called, agent continues', async () => {
    const permCalls: unknown[] = [];
    const client = await spawnClient(track, {
      onPermissionRequest: (req) => {
        permCalls.push(req);
        return 'allow';
      },
    });
    const session = await client.newSession();
    const result = await session.prompt('NEED_PERMISSION');
    expect(result.stopReason).toBe('end_turn');
    expect(permCalls).toHaveLength(1);
    expect((permCalls[0] as { tool: string }).tool).toBe('execute');
    // Agent emits a tool_call event carrying the outcome.
    const tcEvent = result.events.find((e) => e.type === 'tool_call');
    expect(tcEvent).toBeDefined();
    expect((tcEvent!.data as { outcome: string }).outcome).toBe('allow');
  });

  // ── 10. request_permission — deny path ───────────────────────────────────

  it('request_permission deny: agent receives deny outcome', async () => {
    const client = await spawnClient(track, {
      onPermissionRequest: () => Promise.resolve('deny'),
    });
    const session = await client.newSession();
    const result = await session.prompt('NEED_PERMISSION');
    expect(result.stopReason).toBe('end_turn');
    const tcEvent = result.events.find((e) => e.type === 'tool_call');
    expect((tcEvent!.data as { outcome: string }).outcome).toBe('deny');
  });

  it('request_permission without a handler fails closed with deny', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const result = await session.prompt('NEED_PERMISSION');
    expect(result.stopReason).toBe('end_turn');
    const tcEvent = result.events.find((e) => e.type === 'tool_call');
    expect((tcEvent!.data as { outcome: string }).outcome).toBe('deny');
  });

  it('does not count prompt-only updates against the async iterator queue cap', async () => {
    const client = await spawnClient(track, { maxEventQueueSize: 1, maxPromptEvents: 10 });
    const session = await client.newSession();
    const result = await session.prompt('hello');
    expect(result.stopReason).toBe('end_turn');
    expect(result.events).toHaveLength(2);
  });

  it('rejects active prompts when ACP event collection exceeds the configured limit', async () => {
    const client = await spawnClient(track, { maxPromptEvents: 1 });
    const session = await client.newSession();
    await expect(session.prompt('hello')).rejects.toBeInstanceOf(AcpQueueOverflowError);
  });

  // ── 11. malformed line tolerated ─────────────────────────────────────────

  it('malformed JSON line is tolerated — client continues working', async () => {
    const warnings: string[] = [];
    const client = await spawnClient(track, {
      logger: (level, msg) => { if (level === 'warn') warnings.push(msg); },
    });

    // Inject a bad line directly into the stdout stream of the child.
    // We do this by sending a raw string that's not valid JSON; the agent
    // won't do this naturally, but we can simulate it by temporarily
    // monkey-patching the internal _processLine on the impl.
    // Simpler: just trigger it via the internal method we exposed via cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)._processLine('not json {{{');

    // Client should still be usable.
    const session = await client.newSession();
    const result = await session.prompt('hello');
    expect(result.stopReason).toBe('end_turn');
    expect(warnings.some((w) => w.includes('Malformed JSON'))).toBe(true);
  });

  // ── 12. request timeout → AcpTimeoutError ────────────────────────────────

  it('request timeout rejects with AcpTimeoutError', async () => {
    const client = await spawnClient(track, { requestTimeoutMs: 150 });
    const session = await client.newSession();
    await expect(session.prompt('WAIT_TIMEOUT')).rejects.toBeInstanceOf(AcpTimeoutError);
  });

  // ── 13. child exits unexpectedly → pending prompt rejects ────────────────

  it('unexpected child exit rejects all pending requests', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();

    const promptPromise = session.prompt('WAIT_TIMEOUT');
    await new Promise((r) => setTimeout(r, 60));

    // Kill the child externally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any)._child.kill('SIGKILL');

    await expect(promptPromise).rejects.toThrow(/exited unexpectedly/);
    expect(client.isAlive()).toBe(false);
  });

  // ── 14. shutdown closes all sessions and kills child ─────────────────────

  it('shutdown gracefully closes all sessions and kills child', async () => {
    const client = await spawnClient(track);
    const s1 = await client.newSession();
    const s2 = await client.newSession();

    // Start a prompt on s1 that would block; shutdown should cancel it.
    const prom = s1.prompt('WAIT_TIMEOUT');
    await new Promise((r) => setTimeout(r, 60));

    await client.shutdown();

    // shutdown() sends a graceful cancel, so the stalled prompt resolves with
    // stopReason='cancelled' (or rejects if the child dies first — both are fine).
    const settled = await prom.then((r) => r.stopReason).catch(() => 'error');
    expect(['cancelled', 'error']).toContain(settled);
    expect(client.isAlive()).toBe(false);
    // Sessions should be closed.
    await expect(s2.prompt('hello')).rejects.toThrow(/closed|not alive/i);
  });

  // ── 15. isAlive false after shutdown ─────────────────────────────────────

  it('isAlive returns false after shutdown()', async () => {
    const client = await spawnClient(track);
    expect(client.isAlive()).toBe(true);
    await client.shutdown();
    expect(client.isAlive()).toBe(false);
  });

  // ── 16. multiple concurrent sessions ─────────────────────────────────────

  it('multiple concurrent sessions run independently', async () => {
    const client = await spawnClient(track);
    const [s1, s2] = await Promise.all([client.newSession(), client.newSession()]);

    expect(s1.id).not.toBe(s2.id);

    const [r1, r2] = await Promise.all([s1.prompt('hello'), s2.prompt('world')]);

    expect(r1.stopReason).toBe('end_turn');
    expect(r2.stopReason).toBe('end_turn');
    // Each session sees only its own events.
    expect(r1.events.every((e) => e.sessionId === s1.id)).toBe(true);
    expect(r2.events.every((e) => e.sessionId === s2.id)).toBe(true);
  });

  // ── 17. env vars and cwd passed to child ─────────────────────────────────

  it('env vars and cwd are forwarded to the child process', async () => {
    const testCwd = dirname(AGENT); // __fixtures__ dir — guaranteed to exist
    const client = await spawnClient(track, {
      cwd: testCwd,
      env: { ACP_TEST_ENV: 'pyrfor-test-42' },
    });
    const session = await client.newSession({ cwd: testCwd });
    const result = await session.prompt('ECHO_ENV');
    expect(result.stopReason).toBe('end_turn');
    const envEvent = result.events[0];
    const data = envEvent.data as { cwd: string; testEnv: string };
    expect(data.cwd).toBe(testCwd);
    expect(data.testEnv).toBe('pyrfor-test-42');
  });

  // ── 18. prompt with embedded newlines preserved ───────────────────────────

  it('prompt text with embedded newlines is serialised and delivered intact', async () => {
    const fired: AcpEvent[] = [];
    const client = await spawnClient(track, { onEvent: (e) => fired.push(e) });
    const session = await client.newSession();

    const multiline = 'line1\nline2\nline3';
    const result = await session.prompt(multiline);
    // The fake agent echoes the text back in the plan event data.
    expect(result.stopReason).toBe('end_turn');
    const planEvent = result.events.find((e) => e.type === 'plan');
    expect((planEvent!.data as { content: string }).content).toContain('line1\nline2\nline3');
  });

  // ── 19. events() closes when session.close() is called ───────────────────

  it('events() async iterator terminates when session.close() is called', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const collected: AcpEvent[] = [];

    const iterDone = (async () => {
      for await (const e of session.events()) {
        collected.push(e);
      }
    })();

    await session.prompt('hello');
    await session.close(); // closes the queue
    await iterDone;        // should resolve, not hang
    expect(collected.length).toBeGreaterThanOrEqual(0);
  });

  // ── 20. events() terminates on shutdown ──────────────────────────────────

  it('events() async iterator terminates on client shutdown', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    const collected: AcpEvent[] = [];

    const iterDone = (async () => {
      for await (const e of session.events()) {
        collected.push(e);
      }
    })();

    await session.prompt('hello');
    await client.shutdown();
    await iterDone; // should not hang
    expect(collected.length).toBeGreaterThanOrEqual(2);
  });

  // ── 21. cancel on session with no active prompt succeeds ─────────────────

  it('cancel() on session with no active prompt resolves without error', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();
    // No active prompt — fake agent simply acknowledges.
    await expect(session.cancel()).resolves.toBeUndefined();
  });

  // ── 22. inject after prompt completion accumulates in onEvent ────────────

  it('inject events are visible via onEvent callback', async () => {
    const fired: AcpEvent[] = [];
    const client = await spawnClient(track, { onEvent: (e) => fired.push(e) });
    const session = await client.newSession();

    const promptPromise = session.prompt('INJECT_TEST');
    await new Promise((r) => setTimeout(r, 60));
    await session.inject('extra info');
    await promptPromise;

    expect(fired.some((e) => e.type === 'agent_message_chunk')).toBe(true);
    expect(fired.some((e) => (e.data as { text?: string }).text?.includes('extra info'))).toBe(true);
  });

  // ── 23. newSession passes cwd correctly ──────────────────────────────────

  it('newSession stores and exposes the cwd on the session object', async () => {
    const client = await spawnClient(track);
    const cwd = '/custom/work/dir';
    const session = await client.newSession({ cwd });
    expect(session.cwd).toBe(cwd);
  });

  // ── 24. second prompt() call while one is active throws ──────────────────

  it('calling prompt() twice concurrently on the same session throws', async () => {
    const client = await spawnClient(track);
    const session = await client.newSession();

    const p1 = session.prompt('WAIT_TIMEOUT');
    await expect(session.prompt('hello')).rejects.toThrow(/already active/);

    // Clean up the stalled prompt.
    await session.cancel();
    await p1.catch(() => {/* expected */});
  });
});

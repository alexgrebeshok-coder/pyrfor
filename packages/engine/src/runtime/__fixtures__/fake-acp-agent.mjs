/**
 * fake-acp-agent.mjs — Fake ACP server process for unit tests.
 *
 * Speaks JSON-RPC 2.0 over stdin/stdout.
 * Special prompt texts drive different test scenarios:
 *   'WAIT_TIMEOUT'      — never responds (tests request-timeout handling)
 *   'INJECT_TEST'       — emits 1 event then waits for a second session/prompt
 *                         (inject), emits another event, then resolves both
 *   'NEED_PERMISSION'   — issues a session/request_permission inbound request
 *                         before resolving the prompt
 *   'ECHO_ENV'          — emits a single event whose data contains the process
 *                         cwd and ACP_TEST_ENV env var (for env/cwd tests)
 *   'WORKER_FRAME'      — emits a raw Worker Protocol v2 frame as session/update
 *   anything else       — emits plan + tool_call notifications, responds end_turn
 */

import * as readline from 'node:readline';

let nextId = 1;

const rl = readline.createInterface({ input: process.stdin, terminal: false });

/** @type {Map<string, {activePromptId:number|null, waitForInject:boolean, permResolve:((o:string)=>void)|null}>} */
const sessions = new Map();

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function notify(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      activePromptId: null,
      waitForInject: false,
      permResolve: null,
    });
  }
  return sessions.get(sessionId);
}

rl.on('line', async (line) => {
  if (!line.trim()) return;

  let msg;
  try { msg = JSON.parse(line); }
  catch { return; }

  // Handle inbound responses (e.g. replies to our session/request_permission).
  if ('id' in msg && !('method' in msg)) {
    // Find session waiting for a permission response.
    for (const s of sessions.values()) {
      if (s.permResolve) {
        const outcome = msg.result?.outcome ?? 'deny';
        const cb = s.permResolve;
        s.permResolve = null;
        cb(outcome);
        return;
      }
    }
    return;
  }

  const { id, method, params } = msg;

  // ── initialize ─────────────────────────────────────────────────────────────
  if (method === 'initialize') {
    respond(id, {
      protocolVersion: '2026-03',
      agentName: 'FakeAcpAgent',
      // Extra fields for env/cwd test — caller may cast to any.
      _agentCwd: process.cwd(),
      _agentTestEnv: process.env.ACP_TEST_ENV ?? null,
    });

  // ── session/new ────────────────────────────────────────────────────────────
  } else if (method === 'session/new') {
    const sessionCounter = sessions.size + 1;
    const sessionId = `s${sessionCounter}`;
    getSession(sessionId);
    respond(id, { sessionId });

  // ── session/prompt ─────────────────────────────────────────────────────────
  } else if (method === 'session/prompt') {
    const { sessionId, text } = params;
    const session = getSession(sessionId);

    // --- inject path: second session/prompt while one is active ---
    if (session.activePromptId !== null && session.waitForInject) {
      session.waitForInject = false;
      const originalId = session.activePromptId;
      // Emit an inject event.
      notify('session/update', {
        sessionId,
        type: 'agent_message_chunk',
        data: { text: `inject:${text}` },
        ts: Date.now(),
      });
      // Respond to the inject request first, then to the original prompt.
      respond(id, { stopReason: 'end_turn', sessionId });
      session.activePromptId = null;
      respond(originalId, { stopReason: 'end_turn', sessionId });
      return;
    }

    // Fresh prompt — record it.
    session.activePromptId = id;

    // --- special: WAIT_TIMEOUT ---
    if (text === 'WAIT_TIMEOUT') {
      // Never respond — lets the client timeout test trigger.
      return;
    }

    // --- special: INJECT_TEST ---
    if (text === 'INJECT_TEST') {
      notify('session/update', {
        sessionId,
        type: 'plan',
        data: { content: 'Initial plan' },
        ts: Date.now(),
      });
      session.waitForInject = true;
      // Do NOT respond yet; we wait for the inject session/prompt.
      return;
    }

    // --- special: NEED_PERMISSION ---
    if (text === 'NEED_PERMISSION') {
      const permId = nextId++;
      // Await permission from client before continuing.
      const outcome = await new Promise((resolve) => {
        session.permResolve = resolve;
        send({
          jsonrpc: '2.0',
          id: permId,
          method: 'session/request_permission',
          params: {
            sessionId,
            tool: 'execute',
            args: { command: 'echo hello' },
            kind: 'execute',
          },
        });
      });
      notify('session/update', {
        sessionId,
        type: 'tool_call',
        data: { tool: 'execute', outcome },
        ts: Date.now(),
      });
      session.activePromptId = null;
      respond(id, { stopReason: 'end_turn', sessionId });
      return;
    }

    // --- special: ECHO_ENV ---
    if (text === 'ECHO_ENV') {
      notify('session/update', {
        sessionId,
        type: 'plan',
        data: { cwd: process.cwd(), testEnv: process.env.ACP_TEST_ENV ?? null },
        ts: Date.now(),
      });
      session.activePromptId = null;
      respond(id, { stopReason: 'end_turn', sessionId });
      return;
    }

    // --- special: WORKER_FRAME ---
    if (text === 'WORKER_FRAME') {
      notify('session/update', {
        sessionId,
        type: 'worker_frame',
        data: {
          protocol_version: 'wp.v2',
          type: 'heartbeat',
          frame_id: 'frame-1',
          task_id: 'task-1',
          run_id: 'run-1',
          seq: 1,
          status: 'working',
          message: 'still working',
        },
        ts: Date.now(),
      });
      session.activePromptId = null;
      respond(id, { stopReason: 'end_turn', sessionId });
      return;
    }

    // --- default: emit plan + tool_call, then end_turn ---
    notify('session/update', {
      sessionId,
      type: 'plan',
      data: { content: `Plan for: ${text}` },
      ts: Date.now(),
    });
    notify('session/update', {
      sessionId,
      type: 'tool_call',
      data: { tool: 'read', path: '/repo/src/index.ts' },
      ts: Date.now(),
    });
    session.activePromptId = null;
    respond(id, { stopReason: 'end_turn', sessionId });

  // ── session/cancel ─────────────────────────────────────────────────────────
  } else if (method === 'session/cancel') {
    const { sessionId } = params;
    const session = sessions.get(sessionId);
    if (session?.activePromptId !== null && session?.activePromptId !== undefined) {
      const origId = session.activePromptId;
      session.activePromptId = null;
      session.waitForInject = false;
      // Resolve the active prompt with cancelled, then acknowledge the cancel.
      respond(origId, { stopReason: 'cancelled', sessionId });
    }
    respond(id, { sessionId, cancelled: true });

  // ── unknown method ─────────────────────────────────────────────────────────
  } else {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
  }
});

// Keep the process alive.
process.stdin.resume();

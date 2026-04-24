/**
 * ACP Client — Agent-Client-Protocol (JSON-RPC 2.0 over child-process stdio)
 *
 * Implements the March 2026 ACP spec for Pyrfor to supervise external coding
 * agents (FreeClaude, Codex CLI, ClaudeCode, Gemini CLI, Cursor).
 *
 * Wire format: line-delimited JSON  (each message ends with '\n').
 * Transport: child-process stdin (client→agent) / stdout (agent→client).
 *
 * Back-pressure note: The per-session EventQueue is unbounded. Events pile up
 * in a plain array if the consumer iterates slowly. For production with
 * high-throughput agents, cap the queue at ~1 000 events and apply flow
 * control at the transport layer.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// ── Public types ──────────────────────────────────────────────────────────────

export type AcpEventType =
  | 'plan'
  | 'agent_message_chunk'
  | 'tool_call'
  | 'tool_call_update'
  | 'diff'
  | 'terminal'
  | 'thought'
  | 'permission_request';

export type AcpStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

export type AcpToolKind =
  | 'read'
  | 'edit'
  | 'delete'
  | 'move'
  | 'search'
  | 'execute'
  | 'think'
  | 'fetch'
  | 'other';

export interface AcpEvent {
  sessionId: string;
  type: AcpEventType;
  data: unknown;
  ts: number;
}

export interface AcpClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Default 10 000 ms */
  startupTimeoutMs?: number;
  /** Default 60 000 ms */
  requestTimeoutMs?: number;
  onEvent?: (e: AcpEvent) => void;
  onPermissionRequest?: (req: {
    sessionId: string;
    tool: string;
    args: unknown;
    kind: AcpToolKind;
  }) => Promise<'allow' | 'deny'> | 'allow' | 'deny';
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

export interface AcpSession {
  id: string;
  cwd: string;
  prompt(text: string): Promise<{ stopReason: AcpStopReason; events: AcpEvent[] }>;
  /** Send a mid-task injection; resolves when the agent acknowledges. */
  inject(text: string): Promise<void>;
  cancel(): Promise<void>;
  events(): AsyncIterable<AcpEvent>;
  close(): Promise<void>;
}

export interface AcpClient {
  initialize(): Promise<{ protocolVersion: string; agentName: string }>;
  newSession(opts?: { cwd?: string; meta?: Record<string, unknown> }): Promise<AcpSession>;
  isAlive(): boolean;
  shutdown(): Promise<void>;
}

// ── Error types ───────────────────────────────────────────────────────────────

export class AcpTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`ACP request "${method}" timed out after ${ms}ms`);
    this.name = 'AcpTimeoutError';
  }
}

// ── Internal: EventQueue ──────────────────────────────────────────────────────

class EventQueue {
  private readonly buf: AcpEvent[] = [];
  private waiter: (() => void) | null = null;
  private _done = false;

  push(event: AcpEvent): void {
    this.buf.push(event);
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  close(): void {
    if (this._done) return;
    this._done = true;
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  get done(): boolean {
    return this._done;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AcpEvent> {
    while (true) {
      while (this.buf.length > 0) {
        yield this.buf.shift()!;
      }
      if (this._done) return;
      await new Promise<void>((r) => {
        this.waiter = r;
      });
    }
  }
}

// ── Internal: JSON-RPC types ──────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isRpcResponse(m: unknown): m is RpcResponse {
  return typeof m === 'object' && m !== null && 'id' in m && !('method' in m);
}

function isRpcRequest(m: unknown): m is RpcRequest {
  return typeof m === 'object' && m !== null && 'id' in m && 'method' in m;
}

function isRpcNotification(m: unknown): m is RpcNotification {
  return typeof m === 'object' && m !== null && !('id' in m) && 'method' in m;
}

// ── Internal: pending outgoing request ───────────────────────────────────────

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(err: Error): void;
}

// ── Internal: active prompt tracker ──────────────────────────────────────────

interface ActivePrompt {
  requestId: number;
  collector: AcpEvent[];
  resolve(result: { stopReason: AcpStopReason; events: AcpEvent[] }): void;
  reject(err: Error): void;
}

// ── SessionImpl ───────────────────────────────────────────────────────────────

class SessionImpl implements AcpSession {
  readonly id: string;
  readonly cwd: string;
  private _closed = false;
  readonly _queue = new EventQueue();
  activePrompt: ActivePrompt | null = null;

  constructor(id: string, cwd: string, private readonly _c: AcpClientImpl) {
    this.id = id;
    this.cwd = cwd;
  }

  async prompt(text: string): Promise<{ stopReason: AcpStopReason; events: AcpEvent[] }> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    if (this.activePrompt) throw new Error(`A prompt is already active on session ${this.id}`);

    const requestId = this._c._nextId();
    const collector: AcpEvent[] = [];
    const timeoutMs = this._c.opts.requestTimeoutMs ?? 60_000;

    return new Promise<{ stopReason: AcpStopReason; events: AcpEvent[] }>((outerResolve, outerReject) => {
      const timer = setTimeout(() => {
        this._c._pending.delete(requestId);
        if (this.activePrompt?.requestId === requestId) {
          this.activePrompt = null;
        }
        outerReject(new AcpTimeoutError('session/prompt', timeoutMs));
        // Best-effort cancel so the agent cleans up its state.
        this._c._cancelSession(this.id).catch(() => {/* ignored */});
      }, timeoutMs);

      this.activePrompt = {
        requestId,
        collector,
        resolve: (result) => {
          clearTimeout(timer);
          outerResolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          outerReject(err);
        },
      };

      // Register in the shared pending map so _handleResponse can route back.
      this._c._pending.set(requestId, {
        method: 'session/prompt',
        resolve: (raw) => {
          const r = raw as { stopReason: AcpStopReason };
          const ap = this.activePrompt;
          this.activePrompt = null;
          ap?.resolve({ stopReason: r.stopReason, events: [...collector] });
        },
        reject: (err) => {
          const ap = this.activePrompt;
          this.activePrompt = null;
          ap?.reject(err);
        },
      });

      this._c._sendRaw({
        jsonrpc: '2.0',
        id: requestId,
        method: 'session/prompt',
        params: { sessionId: this.id, text },
      });
    });
  }

  async inject(text: string): Promise<void> {
    if (this._closed) throw new Error(`Session ${this.id} is closed`);
    // Events emitted by the agent for this inject are automatically routed
    // into activePrompt.collector (if a prompt is still running) via
    // _handleNotification, so the outer prompt() call collects them all.
    await this._c._sendRequest('session/prompt', { sessionId: this.id, text });
  }

  async cancel(): Promise<void> {
    await this._c._cancelSession(this.id);
  }

  events(): AsyncIterable<AcpEvent> {
    return this._queue;
  }

  async close(): Promise<void> {
    if (this._closed) return;
    this._closed = true;
    this._queue.close();
    this._c._sessions.delete(this.id);
  }

  /** Internal — called by client on unexpected exit or shutdown. */
  _forceClose(): void {
    if (this._closed) return;
    this._closed = true;
    this._queue.close();
  }
}

// ── AcpClientImpl ─────────────────────────────────────────────────────────────

class AcpClientImpl implements AcpClient {
  private _alive = true;
  private _idCounter = 0;
  private _lineBuf = '';
  private readonly _child: ChildProcess;

  readonly opts: AcpClientOptions;
  readonly _pending = new Map<number, Pending>();
  readonly _sessions = new Map<string, SessionImpl>();

  constructor(opts: AcpClientOptions) {
    this.opts = opts;

    this._child = spawn(opts.command, opts.args ?? [], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this._child.stdout!.on('data', (chunk: Buffer) => {
      this._lineBuf += chunk.toString('utf8');
      const lines = this._lineBuf.split('\n');
      this._lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) this._processLine(line);
      }
    });

    this._child.on('exit', (code, signal) => this._handleExit(code, signal));
    this._child.on('error', (err) => {
      this._log('error', 'ACP child process error', { error: err.message });
      this._handleExit(null, null);
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  _nextId(): number {
    return ++this._idCounter;
  }

  _log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
    this.opts.logger?.(level, msg, meta);
  }

  _sendRaw(msg: RpcRequest | RpcNotification | RpcResponse): void {
    if (!this._alive) return;
    try {
      this._child.stdin!.write(JSON.stringify(msg) + '\n');
    } catch (e) {
      this._log('error', 'Failed to write to ACP stdin', { error: String(e) });
    }
  }

  _sendRequest(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this._nextId();
    const ms = timeoutMs ?? this.opts.requestTimeoutMs ?? 60_000;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new AcpTimeoutError(method, ms));
      }, ms);

      this._pending.set(id, {
        method,
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject:  (err) => { clearTimeout(timer); reject(err); },
      });

      this._sendRaw({ jsonrpc: '2.0', id, method, params });
    });
  }

  _cancelSession(sessionId: string): Promise<unknown> {
    return this._sendRequest('session/cancel', { sessionId });
  }

  // ── line processing ────────────────────────────────────────────────────────

  private _processLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this._log('warn', `Malformed JSON from ACP agent: ${line.slice(0, 200)}`);
      return;
    }

    if (isRpcResponse(msg))          this._handleResponse(msg);
    else if (isRpcRequest(msg))      this._handleRequest(msg);
    else if (isRpcNotification(msg)) this._handleNotification(msg);
    else this._log('warn', 'Unrecognized JSON-RPC message shape', { msg });
  }

  private _handleResponse(msg: RpcResponse): void {
    const p = this._pending.get(msg.id);
    if (!p) {
      this._log('warn', `Response for unknown request id=${msg.id}`);
      return;
    }
    this._pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(`ACP [${p.method}] error ${msg.error.code}: ${msg.error.message}`));
    } else {
      p.resolve(msg.result);
    }
  }

  private _handleNotification(msg: RpcNotification): void {
    if (msg.method !== 'session/update') {
      this._log('warn', `Unknown notification method: ${msg.method}`);
      return;
    }
    const p = msg.params as { sessionId: string; type: AcpEventType; data: unknown; ts?: number };
    const event: AcpEvent = {
      sessionId: p.sessionId,
      type:      p.type,
      data:      p.data,
      ts:        p.ts ?? Date.now(),
    };

    this.opts.onEvent?.(event);

    const session = this._sessions.get(p.sessionId);
    if (session) {
      session._queue.push(event);
      session.activePrompt?.collector.push(event);
    }
  }

  private _handleRequest(msg: RpcRequest): void {
    if (msg.method === 'session/request_permission') {
      const p = msg.params as { sessionId: string; tool: string; args: unknown; kind: AcpToolKind };

      const reply = (outcome: 'allow' | 'deny') =>
        this._sendRaw({ jsonrpc: '2.0', id: msg.id, result: { outcome } });

      const handler = this.opts.onPermissionRequest;
      if (!handler) { reply('allow'); return; }

      Promise.resolve(handler({ sessionId: p.sessionId, tool: p.tool, args: p.args, kind: p.kind }))
        .then(reply)
        .catch(() => reply('deny'));
    } else {
      this._sendRaw({
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      });
    }
  }

  private _handleExit(code: number | null, signal: string | null): void {
    if (!this._alive) return;
    this._alive = false;
    this._log('error', 'ACP agent exited', { code, signal });

    const err = new Error(
      `ACP agent process exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    );

    // Reject all in-flight requests. For active prompt() calls the custom
    // reject handler (installed by prompt()) will clear activePrompt and
    // reject the outer promise; so _forceClose only needs to drain the queue.
    for (const [, p] of this._pending) p.reject(err);
    this._pending.clear();

    for (const [, s] of this._sessions) s._forceClose();
    this._sessions.clear();
  }

  // ── AcpClient public API ───────────────────────────────────────────────────

  async initialize(): Promise<{ protocolVersion: string; agentName: string }> {
    const ms = this.opts.startupTimeoutMs ?? 10_000;
    try {
      const result = await this._sendRequest('initialize', {}, ms);
      return result as { protocolVersion: string; agentName: string };
    } catch (err) {
      this._child.kill();
      this._alive = false;
      throw err;
    }
  }

  async newSession(opts?: { cwd?: string; meta?: Record<string, unknown> }): Promise<AcpSession> {
    const cwd = opts?.cwd ?? this.opts.cwd ?? process.cwd();
    const result = await this._sendRequest('session/new', { cwd, ...(opts?.meta ?? {}) });
    const r = result as { sessionId: string };
    const session = new SessionImpl(r.sessionId, cwd, this);
    this._sessions.set(r.sessionId, session);
    return session;
  }

  isAlive(): boolean {
    return this._alive;
  }

  async shutdown(): Promise<void> {
    if (!this._alive) return;

    // Gracefully cancel any sessions with an outstanding prompt.
    const cancels: Promise<unknown>[] = [];
    for (const [, s] of this._sessions) {
      if (s.activePrompt) cancels.push(s.cancel().catch(() => {/* ignore */}));
    }

    await Promise.race([
      Promise.allSettled(cancels),
      new Promise<void>((r) => setTimeout(r, 2_000)),
    ]);

    this._alive = false;
    this._child.kill();

    for (const [, s] of this._sessions) s._forceClose();
    this._sessions.clear();
  }
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createAcpClient(opts: AcpClientOptions): AcpClient {
  return new AcpClientImpl(opts);
}

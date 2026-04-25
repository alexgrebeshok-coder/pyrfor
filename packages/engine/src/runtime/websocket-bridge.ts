/**
 * websocket-bridge.ts
 *
 * Thin wrapper around the `ws` package providing:
 *   - createWsServer — WebSocketServer with registry, auth, heartbeat,
 *                      backpressure, broadcast, and graceful shutdown.
 *   - createWsClient — WebSocket client with auto-reconnect + exponential backoff.
 *
 * ws has no bundled types; local stub interfaces are declared below.
 * All timer/clock dependencies are injectable for deterministic tests.
 */

import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

// ─── Local ws type stubs ──────────────────────────────────────────────────────

interface RawWs {
  ping(data?: Buffer | string): void;
  send(data: string | Buffer, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string | Buffer): void;
  terminate(): void;
  on(event: 'message', listener: (data: Buffer, isBinary: boolean) => void): this;
  on(event: 'pong', listener: (data: Buffer) => void): this;
  on(event: 'ping', listener: (data: Buffer) => void): this;
  on(event: 'open', listener: () => void): this;
  on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: 'close', listener: (code: number, reason: Buffer) => void): this;
  once(event: 'open', listener: () => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  removeAllListeners(event?: string): this;
  readyState: number;
  bufferedAmount: number;
}

interface RawWss {
  on(event: 'connection', listener: (socket: RawWs, req: IncomingMessage) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  close(cb?: (err?: Error) => void): void;
  clients: Set<RawWs>;
  address(): { port: number; address: string; family: string } | string | null;
}

type WsServerCtor = new (opts: Record<string, unknown>) => RawWss;
type WsClientCtor = new (url: string, opts?: Record<string, unknown>) => RawWs;

const _require = createRequire(import.meta.url);
// ws v7 exports: default export is the WebSocket client ctor; ws.Server is the server ctor
const wsLib = _require('ws') as WsClientCtor & { Server: WsServerCtor };

// WebSocket readyState constants (same as the ws library)
const WS_OPEN = 1;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ConnEntry {
  id: string;
  connectedAt: number;
  remoteAddr: string;
  metadata: unknown;
  /** Timestamp of the last ping sent (server-side heartbeat). */
  lastPingAt: number;
}

export interface AuthResult {
  ok: boolean;
  metadata?: unknown;
  reason?: string;
}

export interface WsServerOptions {
  port: number;
  host?: string;
  onConnection?: (conn: ConnEntry) => void;
  onMessage?: (connId: string, data: Buffer) => void;
  /** Milliseconds between heartbeat pings. Connections that miss a pong are dropped. */
  heartbeatMs?: number;
  /** Called for every incoming connection. Return { ok: false } to reject with 4401. */
  authFn?: (req: IncomingMessage) => Promise<AuthResult>;
  /** Max bytes buffered per connection before send() refuses (default: 256 KiB). */
  bufferedAmountCap?: number;
  // Injectables
  clock?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface WsServerHandle {
  /** Send data to all open connections, optionally filtered. */
  broadcast(data: string | Buffer, filter?: (conn: ConnEntry) => boolean): void;
  /** Send data to a specific connection. Returns false if refused (not found / backpressure). */
  send(connId: string, data: string | Buffer): boolean;
  /** Close a specific connection gracefully. */
  close(connId: string): void;
  /** Gracefully close all connections then stop the server. */
  shutdown(): Promise<void>;
  /** Returns the actual bound port (useful when port:0 was given). */
  port(): number;
}

export interface WsClientOptions {
  url: string;
  headers?: Record<string, string>;
  autoReconnect?: boolean;
  backoffMs?: number;
  maxBackoffMs?: number;
  onOpen?: () => void;
  onMessage?: (data: Buffer) => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
  // Injectables
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}

export interface WsClientHandle {
  /** Send data. Returns false if not OPEN or backpressure cap hit. */
  send(data: string | Buffer): boolean;
  /** Close the connection and stop auto-reconnect. */
  close(): void;
  /** Returns the current WebSocket readyState (0–3). */
  readyState(): number;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

interface RegistryEntry {
  conn: ConnEntry;
  socket: RawWs;
  /** True after we sent a ping; cleared on pong. If still true at next tick, drop. */
  awaitingPong: boolean;
}

function makeId(): string {
  return Date.now().toString(36) + randomBytes(10).toString('hex');
}

// ─── createWsServer ───────────────────────────────────────────────────────────

export function createWsServer(opts: WsServerOptions): WsServerHandle {
  const {
    port,
    host,
    onConnection,
    onMessage,
    heartbeatMs,
    authFn,
    bufferedAmountCap = 256 * 1024,
    clock = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  } = opts;

  const registry = new Map<string, RegistryEntry>();

  const serverOpts: Record<string, unknown> = { port };
  if (host !== undefined) serverOpts['host'] = host;

  const wss = new wsLib.Server(serverOpts);

  wss.on('connection', (socket: RawWs, req: IncomingMessage) => {
    void handleConnection(socket, req);
  });

  async function handleConnection(socket: RawWs, req: IncomingMessage): Promise<void> {
    let metadata: unknown = null;

    if (authFn) {
      let result: AuthResult;
      try {
        result = await authFn(req);
      } catch {
        result = { ok: false, reason: 'auth-threw' };
      }
      if (!result.ok) {
        socket.close(4401, result.reason ?? 'Unauthorized');
        return;
      }
      metadata = result.metadata ?? null;
    }

    const connId = makeId();
    const remoteAddr =
      (req.socket as { remoteAddress?: string }).remoteAddress ?? '';

    const conn: ConnEntry = {
      id: connId,
      connectedAt: clock(),
      remoteAddr,
      metadata,
      lastPingAt: 0,
    };

    const entry: RegistryEntry = { conn, socket, awaitingPong: false };
    registry.set(connId, entry);
    onConnection?.(conn);

    socket.on('message', (data: Buffer) => {
      onMessage?.(conn.id, data);
    });

    socket.on('pong', () => {
      entry.awaitingPong = false;
      conn.lastPingAt = clock();
    });

    socket.on('close', () => {
      registry.delete(conn.id);
    });

    socket.on('error', () => {
      registry.delete(conn.id);
    });
  }

  // Heartbeat loop
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

  if (heartbeatMs !== undefined && heartbeatMs > 0) {
    const tick = (): void => {
      const now = clock();
      for (const [id, entry] of [...registry.entries()]) {
        const { conn, socket } = entry;

        if (socket.readyState !== WS_OPEN) {
          registry.delete(id);
          continue;
        }

        if (entry.awaitingPong) {
          // Missed pong from previous cycle — drop the connection
          socket.terminate();
          registry.delete(id);
          continue;
        }

        entry.awaitingPong = true;
        conn.lastPingAt = now;
        socket.ping();
      }
      heartbeatTimer = setTimer(tick, heartbeatMs);
    };

    heartbeatTimer = setTimer(tick, heartbeatMs);
  }

  // ─── Handle

  return {
    broadcast(data, filter) {
      for (const [, entry] of registry) {
        const { conn, socket } = entry;
        if (socket.readyState !== WS_OPEN) continue;
        if (filter !== undefined && !filter(conn)) continue;
        if (socket.bufferedAmount > bufferedAmountCap) continue;
        socket.send(data);
      }
    },

    send(connId, data) {
      const entry = registry.get(connId);
      if (entry === undefined) return false;
      const { socket } = entry;
      if (socket.readyState !== WS_OPEN) return false;
      if (socket.bufferedAmount > bufferedAmountCap) return false;
      socket.send(data);
      return true;
    },

    close(connId) {
      const entry = registry.get(connId);
      if (entry === undefined) return;
      registry.delete(connId);
      entry.socket.close(1000);
    },

    async shutdown() {
      if (heartbeatTimer !== null) {
        clearTimer(heartbeatTimer);
        heartbeatTimer = null;
      }

      const drainPromises = [...registry.values()].map(({ socket }) =>
        new Promise<void>((resolve) => {
          const done = (): void => resolve();
          socket.once('close', done);
          socket.close(1001, 'Server shutting down');
          // Force-terminate after 3 s if close frame not acknowledged
          setTimeout(() => {
            socket.terminate();
            resolve();
          }, 3000);
        }),
      );

      registry.clear();
      await Promise.all(drainPromises);

      await new Promise<void>((resolve, reject) => {
        wss.close((err) => {
          if (err !== undefined && err !== null) reject(err);
          else resolve();
        });
      });
    },

    port() {
      const addr = wss.address();
      if (addr !== null && typeof addr === 'object') return addr.port;
      return port;
    },
  };
}

// ─── createWsClient ───────────────────────────────────────────────────────────

export function createWsClient(opts: WsClientOptions): WsClientHandle {
  const {
    url,
    headers,
    autoReconnect = false,
    backoffMs = 100,
    maxBackoffMs = 30_000,
    onOpen,
    onMessage,
    onClose,
    onError,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
  } = opts;

  let socket: RawWs | null = null;
  let currentBackoff = backoffMs;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect(): void {
    if (stopped) return;

    const wsOpts: Record<string, unknown> = {};
    if (headers !== undefined) wsOpts['headers'] = headers;

    const ws = new wsLib(url, wsOpts);
    socket = ws;

    ws.on('open', () => {
      currentBackoff = backoffMs; // reset backoff on successful connect
      onOpen?.();
    });

    ws.on('message', (data: Buffer) => {
      onMessage?.(data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() ?? '';
      onClose?.(code, reasonStr);

      if (!stopped && autoReconnect) {
        const delay = currentBackoff;
        currentBackoff = Math.min(currentBackoff * 2, maxBackoffMs);
        reconnectTimer = setTimer(connect, delay);
      }
    });

    ws.on('error', (err: Error) => {
      onError?.(err);
    });
  }

  connect();

  return {
    send(data) {
      if (socket === null || socket.readyState !== WS_OPEN) return false;
      if (socket.bufferedAmount > 256 * 1024) return false;
      socket.send(data);
      return true;
    },

    close() {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimer(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket !== null) {
        socket.close(1000);
        socket = null;
      }
    },

    readyState() {
      if (socket === null) return 3; // CLOSED
      return socket.readyState;
    },
  };
}

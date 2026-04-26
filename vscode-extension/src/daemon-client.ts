import { EventEmitter } from 'events';
import WebSocket from 'ws';

export type DaemonState = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export interface DaemonClientOptions {
  reconnectMs?: number;
  maxRetries?: number;
}

export class DaemonClient extends EventEmitter {
  private _url: string;
  private _reconnectMs: number;
  private _maxRetries: number;
  private _ws: WebSocket | null = null;
  private _retries = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _intentionalClose = false;

  state: DaemonState = 'idle';

  constructor(url: string, opts: DaemonClientOptions = {}) {
    super();
    this._url = url;
    this._reconnectMs = opts.reconnectMs ?? 2000;
    this._maxRetries = opts.maxRetries ?? 10;
    // Prevent unhandled 'error' event crashes when no listener is registered.
    this.on('error', () => { /* intentional no-op default */ });
  }

  connect(): Promise<void> {
    this._intentionalClose = false;
    return new Promise((resolve, reject) => {
      if (this.state === 'open' || this.state === 'connecting') {
        resolve();
        return;
      }
      this._setState('connecting');
      const ws = new WebSocket(this._url);
      this._ws = ws;

      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const cleanup = () => {
        ws.removeAllListeners('open');
        ws.removeAllListeners('error');
      };

      ws.once('open', () => {
        cleanup();
        this._retries = 0;
        this._setState('open');
        this.emit('open');
        settle(resolve);
      });

      ws.once('error', (err: Error) => {
        cleanup();
        this._setState('error');
        settle(() => reject(err));
        // Emit after settling so callers can attach handlers first.
        setImmediate(() => this.emit('error', err));
      });

      ws.on('close', () => {
        if (this.state !== 'error') {
          this._setState('closed');
          this.emit('close');
        }
        this._scheduleReconnect();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const parsed: unknown = JSON.parse(data.toString());
          this.emit('message', parsed);
        } catch {
          this.emit('message', data.toString());
        }
      });
    });
  }

  disconnect(): void {
    this._intentionalClose = true;
    this._cancelReconnect();
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setState('closed');
  }

  send(msg: object): void {
    if (!this._ws || this.state !== 'open') {
      throw new Error(`Cannot send: daemon state is "${this.state}"`);
    }
    this._ws.send(JSON.stringify(msg));
  }

  private _setState(s: DaemonState): void {
    this.state = s;
    this.emit('stateChange', s);
  }

  private _scheduleReconnect(): void {
    if (this._intentionalClose) return;
    if (this._retries >= this._maxRetries) return;
    this._retries++;
    const delay = this._reconnectMs * Math.min(this._retries, 5);
    this._reconnectTimer = setTimeout(() => {
      this.connect().catch(() => { /* handled by error event */ });
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

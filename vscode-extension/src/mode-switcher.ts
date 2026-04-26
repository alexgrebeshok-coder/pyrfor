// ─── Types ───────────────────────────────────────────────────────────────────

export type EngineMode = 'pyrfor' | 'freeclaude';
export type RunMode = 'chat' | 'edit' | 'autonomous' | 'pm';

export interface ModeState {
  engine: EngineMode;
  run: RunMode;
  updatedAt: string;
}

/**
 * Minimal daemon-client surface needed by ModeSwitcher.
 * Adapted from the actual DaemonClient public API:
 *   - send(msg: object): void  (synchronous; matches DaemonClient.send)
 *   - on returns an unsubscribe fn (wrap DaemonClient with: on(e,cb) => { dc.on(e,cb); return ()=>dc.off(e,cb); })
 *   - isConnected maps to dc.state === 'open'
 */
export interface DaemonClientLike {
  send(msg: object): void;
  on(event: string, cb: (payload: unknown) => void): () => void;
  isConnected(): boolean;
}

export interface ModePersistence {
  get(key: string): Promise<unknown> | unknown;
  set(key: string, value: unknown): Promise<void> | void;
}

export interface ModeSwitcherOptions {
  daemon: DaemonClientLike;
  /** Baseline defaults applied before persistence is loaded. */
  initial?: Partial<ModeState>;
  /** Optional KV adapter to restore the last-used mode across restarts. */
  persistence?: ModePersistence;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function isValidEngineMode(s: unknown): s is EngineMode {
  return s === 'pyrfor' || s === 'freeclaude';
}

export function isValidRunMode(s: unknown): s is RunMode {
  return s === 'chat' || s === 'edit' || s === 'autonomous' || s === 'pm';
}

export function describeMode(state: ModeState): string {
  const engineLabel = state.engine === 'pyrfor' ? 'Pyrfor' : 'FreeClaude';
  return `${engineLabel} · ${state.run}`;
}

export function defaultModeState(): ModeState {
  return { engine: 'pyrfor', run: 'chat', updatedAt: new Date().toISOString() };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function isValidModeState(s: unknown): s is ModeState {
  return (
    typeof s === 'object' &&
    s !== null &&
    isValidEngineMode((s as Record<string, unknown>).engine) &&
    isValidRunMode((s as Record<string, unknown>).run) &&
    typeof (s as Record<string, unknown>).updatedAt === 'string'
  );
}

const PERSISTENCE_KEY = 'pyrfor.mode';

// ─── ModeSwitcher ─────────────────────────────────────────────────────────────

export class ModeSwitcher {
  private _state: ModeState;
  private readonly _listeners = new Set<(state: ModeState) => void>();
  private _subscriptions: Array<() => void> = [];
  /** State waiting to be sent to daemon once it reconnects. */
  private _pending: ModeState | null = null;
  /** Tracks what we last sent so we can ignore our own echo from daemon. */
  private _lastSent: { engine: EngineMode; run: RunMode } | null = null;

  constructor(private readonly _opts: ModeSwitcherOptions) {
    // Apply initial overrides on top of defaults; updatedAt is refreshed.
    this._state = {
      ...defaultModeState(),
      ...(_opts.initial ?? {}),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Load persisted mode (if any) and subscribe to daemon events.
   * Must be called once before using the switcher.
   */
  async init(): Promise<void> {
    // Restore persisted state (takes priority over constructor initial).
    if (this._opts.persistence) {
      const stored = await this._opts.persistence.get(PERSISTENCE_KEY);
      if (isValidModeState(stored)) {
        this._state = stored;
      }
    }

    // Subscribe to daemon-pushed mode changes.
    const unsubMode = this._opts.daemon.on('mode.changed', (payload: unknown) => {
      if (!isValidModeState(payload)) return;

      // Loop-prevention: skip our own echo from daemon.
      if (
        this._lastSent !== null &&
        payload.engine === this._lastSent.engine &&
        payload.run === this._lastSent.run
      ) {
        this._lastSent = null;
        return;
      }

      // No-op if daemon sent back what we already have.
      if (payload.engine === this._state.engine && payload.run === this._state.run) {
        return;
      }

      this._state = payload;
      this._emitChange();
    });
    this._subscriptions.push(unsubMode);

    // Drain queued update on reconnect.
    const unsubConnected = this._opts.daemon.on('connected', (_payload: unknown) => {
      if (!this._pending) return;
      const pending = this._pending;
      this._pending = null;
      try {
        this._lastSent = { engine: pending.engine, run: pending.run };
        this._opts.daemon.send({ type: 'mode.set', engine: pending.engine, run: pending.run });
      } catch {
        // Ignore send errors during reconnect drain.
      }
    });
    this._subscriptions.push(unsubConnected);
  }

  getState(): ModeState {
    return { ...this._state };
  }

  async switchEngine(engine: EngineMode): Promise<ModeState> {
    return this.setMode({ engine });
  }

  async switchRun(run: RunMode): Promise<ModeState> {
    return this.setMode({ run });
  }

  async setMode(partial: Partial<ModeState>): Promise<ModeState> {
    const newState: ModeState = {
      ...this._state,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    this._state = newState;

    if (this._opts.persistence) {
      await this._opts.persistence.set(PERSISTENCE_KEY, newState);
    }

    if (this._opts.daemon.isConnected()) {
      this._lastSent = { engine: newState.engine, run: newState.run };
      this._opts.daemon.send({ type: 'mode.set', engine: newState.engine, run: newState.run });
    } else {
      this._pending = newState;
    }

    this._emitChange();
    return { ...newState };
  }

  onChange(cb: (state: ModeState) => void): () => void {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  getQuickPickItems(): Array<{
    label: string;
    engine: EngineMode;
    run: RunMode;
    description: string;
  }> {
    const engines: EngineMode[] = ['pyrfor', 'freeclaude'];
    const runs: RunMode[] = ['chat', 'edit', 'autonomous', 'pm'];
    return engines.flatMap((engine) =>
      runs.map((run) => ({
        label: describeMode({ engine, run, updatedAt: '' }),
        engine,
        run,
        description: `Switch to ${engine === 'pyrfor' ? 'Pyrfor' : 'FreeClaude'} in ${run} mode`,
      }))
    );
  }

  dispose(): void {
    for (const unsub of this._subscriptions) unsub();
    this._subscriptions = [];
    this._listeners.clear();
  }

  private _emitChange(): void {
    const snapshot = { ...this._state };
    for (const cb of this._listeners) cb(snapshot);
  }
}

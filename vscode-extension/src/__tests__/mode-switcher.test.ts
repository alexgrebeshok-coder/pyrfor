import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ModeSwitcher,
  defaultModeState,
  isValidEngineMode,
  isValidRunMode,
  describeMode,
  type DaemonClientLike,
  type ModePersistence,
  type ModeState,
  type EngineMode,
  type RunMode,
} from '../mode-switcher';

// ─── Mock helpers ─────────────────────────────────────────────────────────────

type EventHandler = (payload: unknown) => void;

function createMockDaemon(connected = true): {
  daemon: DaemonClientLike & { send: ReturnType<typeof vi.fn>; isConnected: ReturnType<typeof vi.fn> };
  emit: (event: string, payload: unknown) => void;
} {
  const handlers: Record<string, EventHandler> = {};

  const daemon = {
    send: vi.fn(),
    isConnected: vi.fn().mockReturnValue(connected),
    on: vi.fn().mockImplementation((event: string, cb: EventHandler) => {
      handlers[event] = cb;
      return () => {
        delete handlers[event];
      };
    }),
  };

  return {
    daemon,
    emit: (event: string, payload: unknown) => handlers[event]?.(payload),
  };
}

function createMemoryPersistence(initial?: ModeState): ModePersistence & { store: Record<string, unknown> } {
  const store: Record<string, unknown> = initial ? { 'pyrfor.mode': initial } : {};
  return {
    store,
    get: vi.fn().mockImplementation((key: string) => store[key]),
    set: vi.fn().mockImplementation((key: string, value: unknown) => {
      store[key] = value;
    }),
  };
}

function makeValidState(overrides?: Partial<ModeState>): ModeState {
  return { engine: 'pyrfor', run: 'chat', updatedAt: '2024-01-01T00:00:00.000Z', ...overrides };
}

// ─── Pure helper tests ────────────────────────────────────────────────────────

describe('defaultModeState', () => {
  it('returns engine=pyrfor, run=chat', () => {
    const state = defaultModeState();
    expect(state.engine).toBe('pyrfor');
    expect(state.run).toBe('chat');
  });

  it('updatedAt is a valid ISO 8601 timestamp', () => {
    const state = defaultModeState();
    expect(new Date(state.updatedAt).toISOString()).toBe(state.updatedAt);
  });
});

describe('isValidEngineMode', () => {
  it('accepts pyrfor and freeclaude', () => {
    expect(isValidEngineMode('pyrfor')).toBe(true);
    expect(isValidEngineMode('freeclaude')).toBe(true);
  });

  it('rejects bad strings and non-strings', () => {
    expect(isValidEngineMode('openai')).toBe(false);
    expect(isValidEngineMode('')).toBe(false);
    expect(isValidEngineMode(null)).toBe(false);
    expect(isValidEngineMode(undefined)).toBe(false);
    expect(isValidEngineMode(42)).toBe(false);
    expect(isValidEngineMode({})).toBe(false);
  });
});

describe('isValidRunMode', () => {
  it('accepts all four run modes', () => {
    const valid: RunMode[] = ['chat', 'edit', 'autonomous', 'pm'];
    for (const m of valid) {
      expect(isValidRunMode(m)).toBe(true);
    }
  });

  it('rejects bad strings and non-strings', () => {
    expect(isValidRunMode('agent')).toBe(false);
    expect(isValidRunMode('')).toBe(false);
    expect(isValidRunMode(null)).toBe(false);
    expect(isValidRunMode(undefined)).toBe(false);
    expect(isValidRunMode(0)).toBe(false);
  });
});

describe('describeMode', () => {
  it('formats Pyrfor correctly', () => {
    expect(describeMode(makeValidState({ engine: 'pyrfor', run: 'autonomous' }))).toBe(
      'Pyrfor · autonomous'
    );
  });

  it('formats FreeClaude correctly', () => {
    expect(describeMode(makeValidState({ engine: 'freeclaude', run: 'chat' }))).toBe(
      'FreeClaude · chat'
    );
  });

  it('covers all run modes with pyrfor label', () => {
    const runs: RunMode[] = ['chat', 'edit', 'autonomous', 'pm'];
    for (const run of runs) {
      expect(describeMode(makeValidState({ engine: 'pyrfor', run }))).toBe(`Pyrfor · ${run}`);
    }
  });
});

// ─── ModeSwitcher tests ───────────────────────────────────────────────────────

describe('ModeSwitcher', () => {
  let mockDaemon: ReturnType<typeof createMockDaemon>;

  beforeEach(() => {
    mockDaemon = createMockDaemon(true);
  });

  // ── init ────────────────────────────────────────────────────────────────────

  describe('init()', () => {
    it('with no persistence → state is default (pyrfor/chat)', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const state = sw.getState();
      expect(state.engine).toBe('pyrfor');
      expect(state.run).toBe('chat');
    });

    it('with persistence containing valid state → state restored', async () => {
      const persisted = makeValidState({ engine: 'freeclaude', run: 'edit' });
      const persistence = createMemoryPersistence(persisted);
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon, persistence });
      await sw.init();
      const state = sw.getState();
      expect(state.engine).toBe('freeclaude');
      expect(state.run).toBe('edit');
    });

    it('with persistence containing invalid state → falls back to default', async () => {
      const persistence = createMemoryPersistence();
      (persistence.get as ReturnType<typeof vi.fn>).mockReturnValue({ bad: true });
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon, persistence });
      await sw.init();
      expect(sw.getState().engine).toBe('pyrfor');
    });
  });

  // ── switchEngine ────────────────────────────────────────────────────────────

  describe('switchEngine()', () => {
    it('sends mode.set with new engine to daemon', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      await sw.switchEngine('freeclaude');
      expect(mockDaemon.daemon.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mode.set', engine: 'freeclaude' })
      );
    });

    it('updates state', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const result = await sw.switchEngine('freeclaude');
      expect(result.engine).toBe('freeclaude');
      expect(sw.getState().engine).toBe('freeclaude');
    });

    it('emits onChange', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);
      await sw.switchEngine('freeclaude');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ engine: 'freeclaude' }));
    });
  });

  // ── switchRun ───────────────────────────────────────────────────────────────

  describe('switchRun()', () => {
    it('sends mode.set with new run to daemon', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      await sw.switchRun('autonomous');
      expect(mockDaemon.daemon.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mode.set', run: 'autonomous' })
      );
    });

    it('updates state and emits onChange', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);
      const result = await sw.switchRun('pm');
      expect(result.run).toBe('pm');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ run: 'pm' }));
    });
  });

  // ── setMode ─────────────────────────────────────────────────────────────────

  describe('setMode()', () => {
    it('partial { engine } only changes engine, keeps run', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon, initial: { run: 'autonomous' } });
      await sw.init();
      await sw.setMode({ engine: 'freeclaude' });
      const state = sw.getState();
      expect(state.engine).toBe('freeclaude');
      expect(state.run).toBe('autonomous');
    });

    it('partial { run } only changes run, keeps engine', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon, initial: { engine: 'freeclaude' } });
      await sw.init();
      await sw.setMode({ run: 'edit' });
      const state = sw.getState();
      expect(state.engine).toBe('freeclaude');
      expect(state.run).toBe('edit');
    });
  });

  // ── daemon mode.changed ─────────────────────────────────────────────────────

  describe('daemon emits mode.changed', () => {
    it('with different state → local state updates + onChange fires; daemon.send NOT called', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);

      const incomingState = makeValidState({ engine: 'freeclaude', run: 'autonomous' });
      mockDaemon.emit('mode.changed', incomingState);

      expect(sw.getState().engine).toBe('freeclaude');
      expect(sw.getState().run).toBe('autonomous');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ engine: 'freeclaude', run: 'autonomous' }));
      expect(mockDaemon.daemon.send).not.toHaveBeenCalled();
    });

    it('that matches current state → no spurious onChange (no-op)', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);

      const currentState = sw.getState();
      mockDaemon.emit('mode.changed', { ...currentState });

      expect(cb).not.toHaveBeenCalled();
    });

    it('malformed payload is ignored, state unchanged, onChange not fired', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const stateBefore = sw.getState();
      const cb = vi.fn();
      sw.onChange(cb);

      mockDaemon.emit('mode.changed', { bad: 'data' });
      mockDaemon.emit('mode.changed', null);
      mockDaemon.emit('mode.changed', 'string payload');
      mockDaemon.emit('mode.changed', { engine: 'bad-engine', run: 'chat', updatedAt: '2024-01-01T00:00:00.000Z' });

      expect(sw.getState()).toEqual(stateBefore);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ── disconnected + pending queue ────────────────────────────────────────────

  describe('disconnected daemon', () => {
    it('switch → persisted + emitted locally; NOT sent to daemon; drained on connected', async () => {
      const persistence = createMemoryPersistence();
      const { daemon, emit } = createMockDaemon(false); // disconnected
      const sw = new ModeSwitcher({ daemon, persistence });
      await sw.init();

      const cb = vi.fn();
      sw.onChange(cb);
      await sw.switchEngine('freeclaude');

      // Not sent to daemon immediately
      expect(daemon.send).not.toHaveBeenCalled();
      // But locally emitted
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ engine: 'freeclaude' }));
      // And persisted
      expect(persistence.set).toHaveBeenCalledWith(
        'pyrfor.mode',
        expect.objectContaining({ engine: 'freeclaude' })
      );

      // Simulate reconnect — pending should drain
      emit('connected', null);
      expect(daemon.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mode.set', engine: 'freeclaude' })
      );
    });

    it('second switch before reconnect replaces pending (only latest drained)', async () => {
      const { daemon, emit } = createMockDaemon(false);
      const sw = new ModeSwitcher({ daemon });
      await sw.init();

      await sw.switchEngine('freeclaude');
      await sw.switchRun('pm');

      emit('connected', null);

      // Only one send call, for the last pending state
      expect(daemon.send).toHaveBeenCalledTimes(1);
      expect(daemon.send).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'mode.set', engine: 'freeclaude', run: 'pm' })
      );
    });
  });

  // ── getQuickPickItems ───────────────────────────────────────────────────────

  describe('getQuickPickItems()', () => {
    it('returns 8 entries (2 engines × 4 run modes)', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const items = sw.getQuickPickItems();
      expect(items).toHaveLength(8);
    });

    it('all entries have engine, run, label, description', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      for (const item of sw.getQuickPickItems()) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.description.length).toBeGreaterThan(0);
        expect(isValidEngineMode(item.engine)).toBe(true);
        expect(isValidRunMode(item.run)).toBe(true);
      }
    });

    it('returns stable labels in engine-first order', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const labels = sw.getQuickPickItems().map((i) => i.label);
      expect(labels).toEqual([
        'Pyrfor · chat',
        'Pyrfor · edit',
        'Pyrfor · autonomous',
        'Pyrfor · pm',
        'FreeClaude · chat',
        'FreeClaude · edit',
        'FreeClaude · autonomous',
        'FreeClaude · pm',
      ]);
    });

    it('covers every (engine, run) combination exactly once', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const items = sw.getQuickPickItems();
      const engines = new Set<EngineMode>(['pyrfor', 'freeclaude']);
      const runs = new Set<RunMode>(['chat', 'edit', 'autonomous', 'pm']);
      for (const engine of engines) {
        for (const run of runs) {
          expect(items.some((i) => i.engine === engine && i.run === run)).toBe(true);
        }
      }
    });
  });

  // ── onChange / dispose ──────────────────────────────────────────────────────

  describe('onChange unsubscribe', () => {
    it('returned fn removes the specific listener', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      const unsub = sw.onChange(cb);
      unsub();
      await sw.switchEngine('freeclaude');
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('unsubscribes from daemon events; subsequent emits do not fire callbacks', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);

      sw.dispose();

      // Emitting after dispose should not reach any listener
      mockDaemon.emit('mode.changed', makeValidState({ engine: 'freeclaude', run: 'pm' }));
      expect(cb).not.toHaveBeenCalled();
      expect(sw.getState().engine).toBe('pyrfor'); // state unchanged
    });

    it('clears onChange listeners', async () => {
      const sw = new ModeSwitcher({ daemon: mockDaemon.daemon });
      await sw.init();
      const cb = vi.fn();
      sw.onChange(cb);
      sw.dispose();
      // Directly calling getState still works; no throws
      expect(() => sw.getState()).not.toThrow();
    });
  });
});

// @vitest-environment node
/**
 * slash-commands.test.ts — unit tests for SlashCommandRegistry and helpers.
 */

import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { rm } from 'node:fs/promises';

import {
  tokenize,
  parseArgs,
  SlashCommandRegistry,
  createDefaultRegistry,
  type SlashCommand,
  type SlashContext,
  type ParsedArgs,
} from './slash-commands';
import { EventLedger } from './event-ledger';

// ====== Helpers ==============================================================

function tmpLedgerPath(): string {
  const hex = randomBytes(8).toString('hex');
  return path.join(os.tmpdir(), `slash-cmd-test-${hex}`, 'ledger.jsonl');
}

function makeCmd(overrides: Partial<SlashCommand> = {}): SlashCommand {
  return {
    name: 'test',
    description: 'A test command',
    handler: async () => ({ ok: true, output: 'done' }),
    ...overrides,
  };
}

function baseCtx(
  overrides: Partial<Omit<SlashContext, 'raw' | 'command' | 'args'>> = {},
): Omit<SlashContext, 'raw' | 'command' | 'args'> {
  return {
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    runId: 'run-1',
    ...overrides,
  };
}

// ====== tokenize =============================================================

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('foo bar baz')).toEqual(['foo', 'bar', 'baz']);
  });

  it('preserves quoted strings as single token', () => {
    expect(tokenize('/commit "my message here"')).toEqual(['/commit', 'my message here']);
  });

  it('handles escaped quotes inside quoted string', () => {
    expect(tokenize('foo "bar \\"baz\\" qux"')).toEqual(['foo', 'bar "baz" qux']);
  });

  it('handles escaped quotes outside of quoted string', () => {
    expect(tokenize('foo bar\\"baz')).toEqual(['foo', 'bar"baz']);
  });

  it('returns empty array for empty string', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('ignores multiple consecutive spaces', () => {
    expect(tokenize('foo   bar')).toEqual(['foo', 'bar']);
  });
});

// ====== parseArgs ============================================================

describe('parseArgs', () => {
  it('captures positional arguments', () => {
    const result = parseArgs(['hello', 'world']);
    expect(result.positional).toEqual(['hello', 'world']);
  });

  it('parses --flag=value', () => {
    const result = parseArgs(['--name=Alice']);
    expect(result.flags['name']).toBe('Alice');
  });

  it('parses --flag value', () => {
    const result = parseArgs(['--name', 'Alice']);
    expect(result.flags['name']).toBe('Alice');
    expect(result.positional).toHaveLength(0);
  });

  it('parses boolean flags (no value)', () => {
    const result = parseArgs(['--verbose'], {
      flags: { verbose: { type: 'boolean' } },
    });
    expect(result.flags['verbose']).toBe(true);
  });

  it('applies defaults from schema', () => {
    const result = parseArgs([], {
      flags: { format: { type: 'string', default: 'json' } },
    });
    expect(result.flags['format']).toBe('json');
  });

  it('coerces number flags', () => {
    const result = parseArgs(['--count=5'], {
      flags: { count: { type: 'number' } },
    });
    expect(result.flags['count']).toBe(5);
  });

  it('coerces positional numbers', () => {
    const result = parseArgs(['42'], {
      positional: [{ name: 'limit', type: 'number' }],
    });
    expect(result.positional[0]).toBe(42);
  });

  it('mixed positional + flags', () => {
    const result = parseArgs(['positional1', '--flag', 'val', 'positional2']);
    expect(result.positional).toEqual(['positional1', 'positional2']);
    expect(result.flags['flag']).toBe('val');
  });
});

// ====== SlashCommandRegistry — registration ==================================

describe('SlashCommandRegistry.register', () => {
  it('registers and retrieves by name', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({ name: 'greet' });
    r.register(cmd);
    expect(r.get('greet')).toBe(cmd);
  });

  it('retrieves by alias', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({ name: 'greet', aliases: ['hi', 'hello'] });
    r.register(cmd);
    expect(r.get('hi')).toBe(cmd);
    expect(r.get('hello')).toBe(cmd);
  });

  it('throws on duplicate name', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'dup' }));
    expect(() => r.register(makeCmd({ name: 'dup' }))).toThrow(/duplicate/i);
  });

  it('throws on duplicate alias', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'foo', aliases: ['bar'] }));
    expect(() => r.register(makeCmd({ name: 'baz', aliases: ['bar'] }))).toThrow(/duplicate/i);
  });

  it('has() returns true/false correctly', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'ping' }));
    expect(r.has('ping')).toBe(true);
    expect(r.has('pong')).toBe(false);
  });
});

// ====== SlashCommandRegistry — list ==========================================

describe('SlashCommandRegistry.list', () => {
  it('returns commands in insertion order', () => {
    const r = new SlashCommandRegistry();
    const c1 = makeCmd({ name: 'alpha' });
    const c2 = makeCmd({ name: 'beta' });
    const c3 = makeCmd({ name: 'gamma' });
    r.register(c1);
    r.register(c2);
    r.register(c3);
    expect(r.list()).toEqual([c1, c2, c3]);
  });

  it('returns a copy (modification does not affect registry)', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'solo' }));
    const list = r.list();
    list.pop();
    expect(r.list()).toHaveLength(1);
  });
});

// ====== SlashCommandRegistry — unregister ====================================

describe('SlashCommandRegistry.unregister', () => {
  it('removes command and returns true', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'bye', aliases: ['farewell'] }));
    expect(r.unregister('bye')).toBe(true);
    expect(r.has('bye')).toBe(false);
    expect(r.has('farewell')).toBe(false);
  });

  it('returns false for unknown name', () => {
    const r = new SlashCommandRegistry();
    expect(r.unregister('ghost')).toBe(false);
  });
});

// ====== SlashCommandRegistry — parse =========================================

describe('SlashCommandRegistry.parse', () => {
  it('parses with leading slash', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'greet' }));
    const result = r.parse('/greet');
    expect(result).not.toBeNull();
    expect(result!.command).toBe('greet');
  });

  it('parses bare command name', () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'greet' }));
    const result = r.parse('greet');
    expect(result).not.toBeNull();
    expect(result!.command).toBe('greet');
  });

  it('returns null for unknown command', () => {
    const r = new SlashCommandRegistry();
    expect(r.parse('/unknown')).toBeNull();
  });

  it('returns null if required positional is missing', () => {
    const r = new SlashCommandRegistry();
    r.register(
      makeCmd({
        name: 'say',
        argSchema: {
          positional: [{ name: 'message', type: 'string', required: true }],
        },
      }),
    );
    expect(r.parse('/say')).toBeNull();
  });
});

// ====== SlashCommandRegistry — validate ======================================

describe('SlashCommandRegistry.validate', () => {
  it('returns ok:true when no schema', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({ name: 'noop' });
    const args: ParsedArgs = { positional: [], flags: {} };
    expect(r.validate(cmd, args)).toEqual({ ok: true, errors: [] });
  });

  it('errors on missing required positional', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({
      name: 'req',
      argSchema: {
        positional: [{ name: 'target', type: 'string', required: true }],
      },
    });
    const result = r.validate(cmd, { positional: [], flags: {} });
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/target/i);
  });

  it('errors on wrong positional type', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({
      name: 'typed',
      argSchema: {
        positional: [{ name: 'count', type: 'number', required: true }],
      },
    });
    // Providing a string when number is expected
    const result = r.validate(cmd, { positional: ['not-a-number'], flags: {} });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/count/i);
  });

  it('errors on wrong flag type', () => {
    const r = new SlashCommandRegistry();
    const cmd = makeCmd({
      name: 'flags',
      argSchema: {
        flags: { limit: { type: 'number' } },
      },
    });
    // Providing a string value when number is declared
    const result = r.validate(cmd, { positional: [], flags: { limit: 'oops' } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/limit/i);
  });
});

// ====== SlashCommandRegistry — invoke ========================================

describe('SlashCommandRegistry.invoke', () => {
  it('returns ok:false for unknown command', async () => {
    const r = new SlashCommandRegistry();
    const result = await r.invoke('/ghost', baseCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ghost/i);
  });

  it('invokes handler and returns result', async () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'ping', handler: async () => ({ ok: true, output: 'pong' }) }));
    const result = await r.invoke('/ping', baseCtx());
    expect(result.ok).toBe(true);
    expect(result.output).toBe('pong');
  });

  it('measures ms (>= 0)', async () => {
    const r = new SlashCommandRegistry();
    r.register(makeCmd({ name: 'ms', handler: async () => ({ ok: true }) }));
    const result = await r.invoke('/ms', baseCtx());
    expect(typeof result.ms).toBe('number');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('catching throwing handler returns ok:false with error string', async () => {
    const r = new SlashCommandRegistry();
    r.register(
      makeCmd({
        name: 'boom',
        handler: async () => {
          throw new Error('handler exploded');
        },
      }),
    );
    const result = await r.invoke('/boom', baseCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/handler exploded/);
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });
});

// ====== invoke with ledger ===================================================

describe('SlashCommandRegistry.invoke with ledger', () => {
  let ledgerPath: string;
  let ledger: EventLedger;

  // Use a fresh temporary ledger per test
  const setup = () => {
    ledgerPath = tmpLedgerPath();
    ledger = new EventLedger(ledgerPath);
  };

  const teardown = async () => {
    await rm(path.dirname(ledgerPath), { recursive: true, force: true });
  };

  it('emits tool.requested and tool.executed on success', async () => {
    setup();
    try {
      const r = new SlashCommandRegistry();
      r.register(makeCmd({ name: 'ok-cmd', handler: async () => ({ ok: true, output: 'done' }) }));
      await r.invoke('/ok-cmd', { ...baseCtx(), ledger });

      const events = await ledger.readAll();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('tool.requested');
      expect(events[1].type).toBe('tool.executed');
      expect((events[0] as any).tool).toBe('slash:ok-cmd');
      expect((events[1] as any).tool).toBe('slash:ok-cmd');
      expect((events[1] as any).status).toBe('ok');
    } finally {
      await teardown();
    }
  });

  it('seq increments across events', async () => {
    setup();
    try {
      const r = new SlashCommandRegistry();
      r.register(makeCmd({ name: 'seq-cmd', handler: async () => ({ ok: true }) }));
      await r.invoke('/seq-cmd', { ...baseCtx(), ledger });

      const events = await ledger.readAll();
      expect(events[1].seq).toBeGreaterThan(events[0].seq);
    } finally {
      await teardown();
    }
  });

  it('emits tool.executed with status=error when handler throws', async () => {
    setup();
    try {
      const r = new SlashCommandRegistry();
      r.register(
        makeCmd({
          name: 'fail-cmd',
          handler: async () => {
            throw new Error('boom in handler');
          },
        }),
      );
      const result = await r.invoke('/fail-cmd', { ...baseCtx(), ledger });

      expect(result.ok).toBe(false);
      const events = await ledger.readAll();
      expect(events).toHaveLength(2);
      expect(events[1].type).toBe('tool.executed');
      expect((events[1] as any).status).toBe('error');
      expect((events[1] as any).error).toMatch(/boom in handler/);
    } finally {
      await teardown();
    }
  });
});

// ====== createDefaultRegistry ================================================

describe('createDefaultRegistry', () => {
  const EXPECTED_COMMANDS = [
    'help',
    'commit',
    'diff',
    'plan',
    'clear',
    'model',
    'mode',
    'status',
  ];

  it('registers all expected commands', () => {
    const r = createDefaultRegistry();
    for (const name of EXPECTED_COMMANDS) {
      expect(r.has(name)).toBe(true);
    }
  });

  it('/help lists all commands', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/help', baseCtx());
    expect(result.ok).toBe(true);
    for (const name of EXPECTED_COMMANDS) {
      expect(result.output).toContain(`/${name}`);
    }
  });

  it('/commit returns ok:true with descriptive output', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/commit', baseCtx());
    expect(result.ok).toBe(true);
    expect(result.output).toBeTruthy();
  });

  it('/diff returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/diff', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('/plan returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/plan', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('/clear returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/clear', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('/model returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/model', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('/mode returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/mode', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('/status returns ok:true', async () => {
    const r = createDefaultRegistry();
    const result = await r.invoke('/status', baseCtx());
    expect(result.ok).toBe(true);
  });

  it('list() returns 8 commands in insertion order', () => {
    const r = createDefaultRegistry();
    const names = r.list().map((c) => c.name);
    expect(names).toEqual(EXPECTED_COMMANDS);
  });
});

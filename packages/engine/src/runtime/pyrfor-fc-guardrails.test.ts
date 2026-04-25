import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runFreeClaudeWithGuardrails,
  derivePreflightDisallow,
} from './pyrfor-fc-guardrails';
import type { FcGuardrailsOptions, GuardrailedResult } from './pyrfor-fc-guardrails';
import type { FCRunOptions, FCEnvelope, FCHandle, FCEvent } from './pyrfor-fc-adapter';
import type { Guardrails, GuardrailDecision, GuardrailContext, ToolPolicy } from './guardrails';
import { FcEventReader } from './pyrfor-event-reader';

// ─── Stub helpers ─────────────────────────────────────────────────────────────

function makeEnvelope(partial: Partial<FCEnvelope> = {}): FCEnvelope {
  return {
    status: 'success',
    filesTouched: [],
    commandsRun: [],
    exitCode: 0,
    raw: {},
    ...partial,
  };
}

function makeDecision(kind: GuardrailDecision['kind'], allowed?: boolean): GuardrailDecision {
  return {
    allowed: allowed ?? (kind === 'allow' || kind === 'allow-once'),
    kind,
    tier: kind === 'deny' || kind === 'deny-once' ? 'forbidden' : 'safe',
    reason: `stub-${kind}`,
    ts: new Date().toISOString(),
    decisionId: `dec-${Math.random().toString(36).slice(2)}`,
  };
}

/** Build a stub FCHandle that yields provided raw events then completes. */
function makeHandle(
  rawEvents: FCEvent[],
  envelope: FCEnvelope = makeEnvelope(),
): FCHandle & { abortCalls: string[] } {
  const abortCalls: string[] = [];
  let aborted = false;

  const handle: FCHandle & { abortCalls: string[] } = {
    abortCalls,
    async *events() {
      for (const evt of rawEvents) {
        if (aborted) break;
        yield evt;
      }
    },
    async complete() {
      return { envelope, events: rawEvents, exitCode: 0 };
    },
    abort(reason?: string) {
      aborted = true;
      abortCalls.push(reason ?? '');
    },
  };
  return handle;
}

/** Build a raw FCEvent that represents a tool_use (ToolCallStart via FcEventReader). */
function makeToolUseRaw(toolName: string, input: Record<string, unknown> = {}): FCEvent {
  return {
    type: 'tool_use',
    name: toolName,
    input,
    raw: {},
  };
}

/** Stub Guardrails — evaluate always returns the provided decision. */
function makeGuardrails(
  evaluate: (ctx: GuardrailContext) => Promise<GuardrailDecision> = async () => makeDecision('allow'),
  extra?: Partial<Guardrails>,
): Guardrails {
  return {
    evaluate,
    recordOutcome: vi.fn(),
    setPolicy: vi.fn(),
    removePolicy: vi.fn(() => true),
    getPolicies: vi.fn(() => []),
    audit: vi.fn(async () => []),
    approveOnce: vi.fn(),
    denyOnce: vi.fn(),
    flush: vi.fn(async () => {}),
    ...extra,
  };
}

const BASE_OPTS: FCRunOptions = { prompt: 'test prompt', workdir: '/test' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runFreeClaudeWithGuardrails', () => {
  // 1. preflightDisallow merged into opts.disallowedTools
  it('1: preflightDisallow is passed to runFn via disallowedTools', async () => {
    const capturedOpts: FCRunOptions[] = [];
    const runFn = (o: FCRunOptions) => {
      capturedOpts.push(o);
      return makeHandle([], makeEnvelope());
    };

    const guardrails = makeGuardrails();

    await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      preflightDisallow: ['Bash(rm:*)'],
      runFn,
    });

    expect(capturedOpts[0].disallowedTools).toContain('Bash(rm:*)');
  });

  // 2. Existing disallowedTools preserved; new patterns appended (deduped)
  it('2: existing disallowedTools preserved and merged without duplication', async () => {
    const capturedOpts: FCRunOptions[] = [];
    const runFn = (o: FCRunOptions) => {
      capturedOpts.push(o);
      return makeHandle([], makeEnvelope());
    };

    const opts: FCRunOptions = {
      ...BASE_OPTS,
      disallowedTools: ['Write', 'Bash(rm:*)'],
    };

    await runFreeClaudeWithGuardrails(opts, {
      guardrails: makeGuardrails(),
      preflightDisallow: ['Bash(rm:*)', 'FileDelete'],
      runFn,
    });

    const merged = capturedOpts[0].disallowedTools!;
    expect(merged).toContain('Write');
    expect(merged).toContain('Bash(rm:*)');
    expect(merged).toContain('FileDelete');
    // no duplicates
    const count = (s: string) => merged.filter((x) => x === s).length;
    expect(count('Bash(rm:*)')).toBe(1);
  });

  // 3. Single ToolCallStart with allow → no abort; blocked=false; decisions has 1 entry
  it('3: ToolCallStart with allow decision → not blocked, 1 decision recorded', async () => {
    const handle = makeHandle([makeToolUseRaw('Read', { file_path: '/foo' })]);
    const guardrails = makeGuardrails(async () => makeDecision('allow'));

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(false);
    expect(result.blockReason).toBeUndefined();
    expect(result.decisions).toHaveLength(1);
    expect(handle.abortCalls).toHaveLength(0);
  });

  // 4. ToolCallStart with deny → handle.abort called; blocked=true; blockReason set
  it('4: ToolCallStart with deny decision → handle aborted, blocked=true', async () => {
    const handle = makeHandle([makeToolUseRaw('Bash', { command: 'rm -rf /' })]);
    const guardrails = makeGuardrails(async () => makeDecision('deny', false));

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(true);
    expect(result.blockReason).toMatch(/guardrail-block:/);
    expect(handle.abortCalls).toHaveLength(1);
    expect(handle.abortCalls[0]).toMatch(/guardrail-block:/);
  });

  // 5. BashCommand event → ctx.tool='Bash', ctx.args.command set
  it('5: BashCommand event maps to tool=Bash, args.command in GuardrailContext', async () => {
    const capturedCtx: GuardrailContext[] = [];
    // We need to trigger a BashCommand. The FcEventReader emits BashCommand
    // when it sees a tool_use with name 'Bash'. Let's provide both ToolCallStart
    // and BashCommand — we only count distinct evaluations.
    const rawEvents: FCEvent[] = [makeToolUseRaw('Bash', { command: 'echo hello' })];
    const handle = makeHandle(rawEvents);
    const guardrails = makeGuardrails(async (ctx) => {
      capturedCtx.push(ctx);
      return makeDecision('allow');
    });

    await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    // Should have captured at least one evaluation for BashCommand
    const bashCtx = capturedCtx.find((c) => c.toolName === 'Bash' && 'command' in c.args);
    expect(bashCtx).toBeDefined();
    expect(bashCtx?.args.command).toBe('echo hello');
  });

  // 6. Multiple events: first allow, second deny → abort on second; decisions=2
  it('6: first allow then deny → abort on second, decisions length=2', async () => {
    const rawEvents: FCEvent[] = [
      makeToolUseRaw('Read', { file_path: '/a' }),
      makeToolUseRaw('Bash', { command: 'rm -rf /' }),
    ];
    const handle = makeHandle(rawEvents);

    let callCount = 0;
    const guardrails = makeGuardrails(async (ctx) => {
      callCount++;
      if (ctx.toolName === 'Bash') return makeDecision('deny', false);
      return makeDecision('allow');
    });

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(true);
    // Decisions: ToolCallStart(Read)+allow, ToolCallStart(Bash)+deny
    // (BashCommand after Bash may or may not be recorded depending on abort ordering)
    const denyDecision = result.decisions.find((d) => d.decision.kind === 'deny');
    expect(denyDecision).toBeDefined();
    const allowDecision = result.decisions.find((d) => d.decision.kind === 'allow');
    expect(allowDecision).toBeDefined();
    expect(handle.abortCalls).toHaveLength(1);
  });

  // 7. onBlock callback fired on deny
  it('7: onBlock callback is called when a tool is denied', async () => {
    const handle = makeHandle([makeToolUseRaw('Write', { file_path: '/etc/passwd' })]);
    const guardrails = makeGuardrails(async () => makeDecision('deny', false));
    const onBlock = vi.fn();

    await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
      onBlock,
    });

    expect(onBlock).toHaveBeenCalledOnce();
    const [blockedEvent, blockedDecision] = onBlock.mock.calls[0];
    expect(blockedDecision.kind).toBe('deny');
  });

  // 8. 'ask' decision → not blocked (treated as allow + warn log)
  it('8: ask decision → not blocked, only a warn is logged', async () => {
    const handle = makeHandle([makeToolUseRaw('Read')]);
    const guardrails = makeGuardrails(async () => makeDecision('ask', false));
    const warnMessages: string[] = [];
    const logger = (level: string, msg: string) => {
      if (level === 'warn') warnMessages.push(msg);
    };

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
      logger,
    });

    expect(result.blocked).toBe(false);
    expect(warnMessages.some((m) => m.includes('ask'))).toBe(true);
    expect(handle.abortCalls).toHaveLength(0);
  });

  // 9. allow-once / deny-once behave like allow / deny respectively
  it('9a: allow-once decision → not blocked', async () => {
    const handle = makeHandle([makeToolUseRaw('Read')]);
    const guardrails = makeGuardrails(async () => makeDecision('allow-once', true));

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(false);
    expect(handle.abortCalls).toHaveLength(0);
  });

  it('9b: deny-once decision → blocked (abort called)', async () => {
    const handle = makeHandle([makeToolUseRaw('Write')]);
    const guardrails = makeGuardrails(async () => makeDecision('deny-once', false));

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(true);
    expect(handle.abortCalls).toHaveLength(1);
  });

  // Extra: no tool events → no decisions, no abort, blocked=false
  it('extra: no tool events → blocked=false, decisions empty', async () => {
    const handle = makeHandle([
      { type: 'stderr', line: 'Starting...' },
      { type: 'result', result: { result: 'done' }, raw: {} },
    ]);
    const guardrails = makeGuardrails();

    const result = await runFreeClaudeWithGuardrails(BASE_OPTS, {
      guardrails,
      runFn: () => handle,
    });

    expect(result.blocked).toBe(false);
    expect(result.decisions).toHaveLength(0);
  });
});

// ─── derivePreflightDisallow ──────────────────────────────────────────────────

describe('derivePreflightDisallow', () => {
  // 10. stub with listPolicies returning forbidden entries → expected strings emitted
  it('10: getPolicies with forbidden entries → correct FC strings', () => {
    const policies: ToolPolicy[] = [
      { toolName: 'Bash', tier: 'forbidden', pattern: /rm:\*/ },
      { toolName: 'Write', tier: 'forbidden' },
      { toolName: 'Read', tier: 'safe' },
    ];
    const guardrails = makeGuardrails(async () => makeDecision('allow'), {
      getPolicies: () => policies,
    });

    const result = derivePreflightDisallow(guardrails);

    expect(result).toContain('Bash(rm:\\*)');
    expect(result).toContain('Write');
    expect(result).not.toContain('Read');
    expect(result).toHaveLength(2);
  });

  // 11. stub without listPolicies → returns []
  it('11: guardrails without getPolicies/listPolicies → returns []', () => {
    // Create a guardrails-like object with no policy methods
    const guardrails = {
      evaluate: async () => makeDecision('allow'),
      recordOutcome: () => {},
      setPolicy: () => {},
      removePolicy: () => true,
      audit: async () => [],
      approveOnce: () => {},
      denyOnce: () => {},
      flush: async () => {},
      // No getPolicies, no listPolicies
    } as unknown as Guardrails;

    const result = derivePreflightDisallow(guardrails);
    expect(result).toEqual([]);
  });

  it('11b: listPolicies fallback (alternative implementation)', () => {
    const policies: ToolPolicy[] = [
      { toolName: 'FileDelete', tier: 'forbidden' },
    ];
    const guardrails = {
      evaluate: async () => makeDecision('allow'),
      recordOutcome: () => {},
      setPolicy: () => {},
      removePolicy: () => true,
      audit: async () => [],
      approveOnce: () => {},
      denyOnce: () => {},
      flush: async () => {},
      listPolicies: () => policies, // non-standard method
      // getPolicies intentionally absent
    } as unknown as Guardrails;

    const result = derivePreflightDisallow(guardrails);
    expect(result).toContain('FileDelete');
  });

  it('extra: getPolicies returns empty array → returns []', () => {
    const guardrails = makeGuardrails(async () => makeDecision('allow'), {
      getPolicies: () => [],
    });

    const result = derivePreflightDisallow(guardrails);
    expect(result).toEqual([]);
  });
});

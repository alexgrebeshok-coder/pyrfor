import { describe, it, expect, vi } from 'vitest';
import { createFcSupervisor } from './pyrfor-fc-supervisor';
import type { SupervisorOptions } from './pyrfor-fc-supervisor';
import type { StepValidator, ValidatorContext, ValidatorResult, ValidatorVerdict } from './step-validator';
import type { QualityGate, GateDecision, QualityGateState } from './quality-gate';
import type { AcpEvent } from './acp-client';
import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter';

// ─── stub helpers ─────────────────────────────────────────────────────────────

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

function makeValidator(
  verdict: ValidatorVerdict,
  applies: (e: AcpEvent) => boolean = () => true,
): StepValidator {
  return {
    name: `stub-${verdict}`,
    appliesTo: applies,
    async validate(_e: AcpEvent, _ctx: ValidatorContext): Promise<ValidatorResult> {
      return {
        validator: `stub-${verdict}`,
        verdict,
        message: `stub verdict=${verdict}`,
        durationMs: 0,
      };
    },
  };
}

function makeGate(action: GateDecision['action'], injection?: string): QualityGate {
  return {
    async evaluate(
      _event: AcpEvent,
      results: ValidatorResult[],
    ): Promise<GateDecision> {
      return {
        action,
        injection,
        reason: `stub-gate action=${action}`,
        results,
        attempt: action === 'inject_correction' ? 1 : 0,
        remainingPerEvent: 3,
        remainingPerSession: 10,
      };
    },
    state(): QualityGateState {
      return {
        sessionId: 'test-session',
        totalCorrections: 0,
        perEventAttempts: new Map(),
        tokensUsed: 0,
        blocked: false,
        history: [],
      };
    },
    reset() {},
    override() {},
  };
}

/** A raw tool_use FCEvent that produces a ToolCallStart from the reader. */
function toolUseFCEvent(toolName: string, toolUseId: string, input: Record<string, unknown> = {}): FCEvent {
  return { type: 'tool_use', name: toolName, input: { ...input, tool_use_id: toolUseId }, raw: {} };
}

/** A stderr FCEvent — reader returns [] for this. */
function stderrFCEvent(): FCEvent {
  return { type: 'stderr', line: 'some error output' };
}

const BASE_OPTS: Pick<SupervisorOptions, 'sessionId' | 'cwd'> = {
  sessionId: 'test-session',
  cwd: '/tmp/test',
};

// ─── tests ────────────────────────────────────────────────────────────────────

describe('FcSupervisor', () => {
  it('1. Empty stream + empty envelope → finalize verdict pass, no validators ran', async () => {
    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [],
      qualityGate: makeGate('continue'),
    });

    const { results, verdict } = await sup.finalize(makeEnvelope());
    expect(results).toHaveLength(0);
    expect(verdict).toBe('pass');
  });

  it('2. Stub validator pass → gate action continue; onGateDecision NOT invoked', async () => {
    const gateDecisionSpy = vi.fn();

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('pass')],
      qualityGate: makeGate('continue'),
      onGateDecision: gateDecisionSpy,
    });

    // Feed a tool_use event that produces a ToolCallStart (kind 'execute')
    await sup.observe(toolUseFCEvent('Bash', 'tu-1', { command: 'ls' }));

    // 'continue' action → callback should NOT be called
    expect(gateDecisionSpy).not.toHaveBeenCalled();
  });

  it('3. Stub validator block → gate action block; onGateDecision invoked once', async () => {
    const gateDecisionSpy = vi.fn();

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('block')],
      qualityGate: makeGate('block'),
      onGateDecision: gateDecisionSpy,
    });

    // Read tool produces exactly 1 AcpEvent after bridge dedup (ToolCallStart → tool_call;
    // FileRead is skipped).  This ensures exactly 1 gate call.
    await sup.observe(toolUseFCEvent('Read', 'tu-2', { file_path: 'src/danger.ts' }));

    expect(gateDecisionSpy).toHaveBeenCalledTimes(1);
    const [decision] = gateDecisionSpy.mock.calls[0] as [GateDecision];
    expect(decision.action).toBe('block');
  });

  it('4. Stub validator correct → gate action inject_correction; injection non-empty', async () => {
    const gateDecisionSpy = vi.fn();

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('correct')],
      qualityGate: makeGate('inject_correction', 'Please fix the type errors.'),
      onGateDecision: gateDecisionSpy,
    });

    // Read produces 1 AcpEvent → exactly 1 gate call
    await sup.observe(toolUseFCEvent('Read', 'tu-3', { file_path: 'src/a.ts' }));

    expect(gateDecisionSpy).toHaveBeenCalledTimes(1);
    const [decision] = gateDecisionSpy.mock.calls[0] as [GateDecision];
    expect(decision.action).toBe('inject_correction');
    expect(typeof decision.injection).toBe('string');
    expect((decision.injection as string).length).toBeGreaterThan(0);
  });

  it('5. abortSignal aborted → observe() short-circuits immediately', async () => {
    const gateDecisionSpy = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('block')],
      qualityGate: makeGate('block'),
      abortSignal: controller.signal,
      onGateDecision: gateDecisionSpy,
    });

    const result = await sup.observe(toolUseFCEvent('Bash', 'tu-4', { command: 'ls' }));
    expect(result.acp).toHaveLength(0);
    expect(result.results).toHaveLength(0);
    expect(gateDecisionSpy).not.toHaveBeenCalled();
  });

  it('6. stats() increments as expected after multiple events', async () => {
    const sup = createFcSupervisor({
      ...BASE_OPTS,
      // applies only to tool_call events so BashCommand (terminal) doesn't count
      validators: [makeValidator('pass', (e) => e.type === 'tool_call')],
      qualityGate: makeGate('continue'),
    });

    // Each tool_use → 1 ToolCallStart → 1 tool_call event → 1 validator run
    await sup.observe(toolUseFCEvent('Read', 'tu-r1', { file_path: 'a.ts' }));
    await sup.observe(toolUseFCEvent('Read', 'tu-r2', { file_path: 'b.ts' }));
    await sup.observe(toolUseFCEvent('Read', 'tu-r3', { file_path: 'c.ts' }));

    const s = sup.stats();
    expect(s.validatorRuns).toBe(3);
    expect(s.totalResults).toBe(3);
    expect(s.byVerdict.pass).toBe(3);
    expect(s.byVerdict.block).toBe(0);
    expect(s.gateDecisions).toHaveLength(0); // all 'continue'
  });

  it('7. finalize() runs validators on synthetic diff event from envelope.filesTouched', async () => {
    const validateSpy = vi.fn().mockResolvedValue({
      validator: 'spy',
      verdict: 'pass' as ValidatorVerdict,
      message: 'ok',
      durationMs: 0,
    });

    const diffValidator: StepValidator = {
      name: 'spy',
      appliesTo: (e) => e.type === 'diff',
      validate: validateSpy,
    };

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [diffValidator],
      qualityGate: makeGate('continue'),
    });

    const envelope = makeEnvelope({ filesTouched: ['src/a.ts', 'src/b.ts'] });
    const { results, verdict } = await sup.finalize(envelope);

    // Validator was called with the synthetic diff event
    expect(validateSpy).toHaveBeenCalledTimes(1);
    const calledWithEvent = validateSpy.mock.calls[0][0] as AcpEvent;
    expect(calledWithEvent.type).toBe('diff');
    expect((calledWithEvent.data as any).paths).toEqual(['src/a.ts', 'src/b.ts']);

    expect(results).toHaveLength(1);
    expect(verdict).toBe('pass');

    // finalEnvelopeVerdict is set
    expect(sup.stats().finalEnvelopeVerdict).toBe('pass');
  });

  it('8. observe with FCEvent that produces 0 FcEvents → no validators run, no gate calls', async () => {
    const evaluateSpy = vi.fn().mockResolvedValue({
      action: 'continue',
      reason: 'stub',
      results: [],
      attempt: 0,
      remainingPerEvent: 3,
      remainingPerSession: 10,
    } satisfies GateDecision);

    const gate: QualityGate = {
      evaluate: evaluateSpy,
      state: () => ({
        sessionId: 'test-session',
        totalCorrections: 0,
        perEventAttempts: new Map(),
        tokensUsed: 0,
        blocked: false,
        history: [],
      }),
      reset() {},
      override() {},
    };

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('pass')],
      qualityGate: gate,
    });

    // stderr FCEvent → reader returns [] → bridge never called → no validators/gate
    const result = await sup.observe(stderrFCEvent());

    expect(result.acp).toHaveLength(0);
    expect(result.results).toHaveLength(0);
    expect(evaluateSpy).not.toHaveBeenCalled();
  });

  it('9. onValidatorResult callback fires when validator returns results', async () => {
    const callbackSpy = vi.fn();

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [makeValidator('warn', (e) => e.type === 'tool_call')],
      qualityGate: makeGate('continue'),
      onValidatorResult: callbackSpy,
    });

    await sup.observe(toolUseFCEvent('Bash', 'tu-cb', { command: 'whoami' }));

    expect(callbackSpy).toHaveBeenCalledTimes(1);
    const [results, verdict] = callbackSpy.mock.calls[0] as [ValidatorResult[], ValidatorVerdict];
    expect(verdict).toBe('warn');
    expect(results[0].verdict).toBe('warn');
  });

  it('10. finalize with empty envelope produces at least one synthetic event', async () => {
    const evaluateSpy = vi.fn().mockResolvedValue({
      action: 'continue',
      reason: 'stub',
      results: [],
      attempt: 0,
      remainingPerEvent: 3,
      remainingPerSession: 10,
    } satisfies GateDecision);

    const gate: QualityGate = {
      evaluate: evaluateSpy,
      state: () => ({
        sessionId: 'test-session',
        totalCorrections: 0,
        perEventAttempts: new Map(),
        tokensUsed: 0,
        blocked: false,
        history: [],
      }),
      reset() {},
      override() {},
    };

    const sup = createFcSupervisor({
      ...BASE_OPTS,
      validators: [],
      qualityGate: gate,
    });

    await sup.finalize(makeEnvelope()); // no filesTouched, no commandsRun

    // Even with no files, finalize should call qualityGate.evaluate once for the fallback synthetic event
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
  });
});

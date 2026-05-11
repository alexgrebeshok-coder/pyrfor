/**
 * pyrfor-fc-circuit-router.ts
 *
 * Wraps runFreeClaude with per-model circuit breakers.
 * Iterates modelChain in order; skips open circuits, records failures,
 * and calls onFailover when switching models.
 */

import { runFreeClaude } from './pyrfor-fc-adapter';
import type { FCRunOptions, FCHandle, FCEnvelope, FCEvent, FCRunResult } from './pyrfor-fc-adapter';
import { CircuitBreaker, CircuitOpenError, getCircuitBreaker } from '../ai/circuit-breaker';

export interface FcCircuitRouterOptions {
  /** Ordered chain of models. First non-tripped model wins; fallbacks on circuit open. */
  modelChain: string[];
  /** Failure threshold per model circuit. Default: 3. */
  failureThreshold?: number;
  /** Cooldown ms before half-open. Default: 30000. */
  cooldownMs?: number;
  /** Adapter spawner. Default: runFreeClaude. */
  runFn?: (opts: FCRunOptions) => FCHandle;
  /** Custom CircuitBreaker factory for tests. */
  getBreaker?: (name: string, opts: any) => CircuitBreaker;
  /** Logger. */
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  /** Called when failover occurs (from one model to the next). */
  onFailover?: (fromModel: string, toModel: string, reason: string) => void;
  /** Called before spawning each model attempt. Throws are terminal. */
  beforeAttempt?: (ctx: FcCircuitAttemptContext) => void | Promise<void>;
  /** Validate buffered events before any successful attempt is replayed. Throws are terminal. */
  validateEvent?: (event: FCEvent, ctx: FcCircuitAttemptContext) => void | Promise<void>;
  /** Called after each attempt completes, including failed attempts. */
  onAttemptComplete?: (result: FCRunResult, ctx: FcCircuitAttemptContext) => void | Promise<void>;
}

export interface CircuitRoutedResult {
  envelope: FCEnvelope;
  modelUsed: string;
  attempts: Array<{ model: string; status: 'success' | 'failure' | 'circuit_open'; error?: string }>;
}

export interface FcCircuitAttemptContext {
  model: string;
  attemptIndex: number;
}

export interface FCCircuitHandle extends FCHandle {
  completeCircuit(): Promise<CircuitRoutedResult & { events: FCEvent[]; exitCode: number }>;
}

/** Returns true if the envelope indicates a provider-side failure. */
function isFailure(env: FCEnvelope): boolean {
  if (env.status !== 'success') return true;
  const stop = (env.stopReason ?? '').toLowerCase();
  const err = (env.error ?? '').toLowerCase();
  if (stop.includes('overloaded') || stop.includes('rate_limit') || stop.includes('rate limit')) return true;
  if (err.includes('429') || err.includes('rate') || err.includes('overload')) return true;
  return false;
}

function syntheticError(error: string): FCEnvelope {
  return {
    status: 'error',
    error,
    exitCode: -1,
    filesTouched: [],
    commandsRun: [],
    raw: {},
  };
}

class TerminalCircuitAttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TerminalCircuitAttemptError';
  }
}

/**
 * Try modelChain in order, with per-model circuit breakers.
 *
 * - Circuit open → skip (attempt recorded as 'circuit_open').
 * - Failure envelope → record breaker failure, try next.
 * - Success → record breaker success, return.
 * - All exhausted → return last captured envelope (or synthetic error if all open).
 */
export async function runFreeClaudeWithCircuit(
  opts: FCRunOptions,
  router: FcCircuitRouterOptions,
): Promise<CircuitRoutedResult> {
  const result = await createFreeClaudeCircuitHandle(opts, router).completeCircuit();
  return {
    envelope: result.envelope,
    modelUsed: result.modelUsed,
    attempts: result.attempts,
  };
}

export function createFreeClaudeCircuitHandle(
  opts: FCRunOptions,
  router: FcCircuitRouterOptions,
): FCCircuitHandle {
  const {
    modelChain,
    failureThreshold = 3,
    cooldownMs = 30_000,
    runFn = runFreeClaude,
    getBreaker = (name, bOpts) => getCircuitBreaker(name, bOpts),
    logger,
    onFailover,
    beforeAttempt,
    validateEvent,
    onAttemptComplete,
  } = router;

  const attempts: CircuitRoutedResult['attempts'] = [];
  let lastEnvelope: FCEnvelope | null = null;
  let currentHandle: FCHandle | null = null;
  let abortReason: string | null = null;
  let routedPromise: Promise<CircuitRoutedResult & { events: FCEvent[]; exitCode: number }> | null = null;
  let replayEvents: FCEvent[] = [];

  const runAttempt = async (
    model: string,
    attemptIndex: number,
  ): Promise<{ result: FCRunResult; events: FCEvent[] }> => {
    if (abortReason) {
      throw new TerminalCircuitAttemptError(abortReason);
    }
    const ctx: FcCircuitAttemptContext = { model, attemptIndex };
    try {
      await beforeAttempt?.(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const terminal = new TerminalCircuitAttemptError(message);
      if (err instanceof Error) terminal.stack = err.stack;
      throw terminal;
    }
    const handle = runFn({ ...opts, model });
    currentHandle = handle;
    const events: FCEvent[] = [];
    try {
      for await (const event of handle.events()) {
        if (abortReason) {
          handle.abort(abortReason);
          throw new TerminalCircuitAttemptError(abortReason);
        }
        try {
          await validateEvent?.(event, ctx);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          handle.abort(message);
          const terminal = new TerminalCircuitAttemptError(message);
          if (err instanceof Error) terminal.stack = err.stack;
          throw terminal;
        }
        events.push(event);
      }
      const result = await handle.complete();
      await onAttemptComplete?.(result, ctx);
      if (isFailure(result.envelope)) {
        throw new Error(result.envelope.error ?? `FC run failed with status: ${result.envelope.status}`);
      }
      return { result, events };
    } catch (err) {
      if (err instanceof TerminalCircuitAttemptError) {
        throw err;
      }
      if (abortReason) {
        throw new TerminalCircuitAttemptError(abortReason);
      }
      throw err;
    } finally {
      if (currentHandle === handle) {
        currentHandle = null;
      }
    }
  };

  const runRouted = async (): Promise<CircuitRoutedResult & { events: FCEvent[]; exitCode: number }> => {
    if (modelChain.length === 0) {
      const envelope = syntheticError('no FreeClaude circuit models configured');
      return { envelope, modelUsed: 'unknown', attempts, events: [], exitCode: envelope.exitCode };
    }

    for (let i = 0; i < modelChain.length; i++) {
      const model = modelChain[i];
      const nextModel = modelChain[i + 1];

      const breaker = getBreaker(`fc-model-${model}`, {
        failureThreshold,
        resetTimeout: cooldownMs,
      });

      let capturedEnvelope: FCEnvelope | null = null;

      try {
        const attempt = await breaker.execute(async () => {
          const attemptResult = await runAttempt(model, i);
          capturedEnvelope = attemptResult.result.envelope;
          return attemptResult;
        }, {
          ignoreError: (err) => err instanceof TerminalCircuitAttemptError,
        });

        attempts.push({ model, status: 'success' });
        replayEvents = attempt.events;
        logger?.('info', `FC circuit router: success with model ${model}`, { model });
        return {
          envelope: attempt.result.envelope,
          modelUsed: model,
          attempts,
          events: attempt.events,
          exitCode: attempt.result.exitCode,
        };

      } catch (err) {
        if (err instanceof TerminalCircuitAttemptError) {
          const errMsg = err instanceof Error ? err.message : String(err);
          attempts.push({ model, status: 'failure', error: errMsg });
          const envelope = syntheticError(errMsg);
          logger?.('error', `FC circuit router: terminal failure with ${model}: ${errMsg}`, { model });
          return { envelope, modelUsed: model, attempts, events: [], exitCode: envelope.exitCode };
        }
        if (err instanceof CircuitOpenError) {
          const errMsg = err.message;
          attempts.push({ model, status: 'circuit_open', error: errMsg });
          logger?.('warn', `FC circuit router: circuit open for ${model}`, { model });

          if (nextModel !== undefined) {
            onFailover?.(model, nextModel, errMsg);
          }
          continue;
        }

        const errMsg = err instanceof Error ? err.message : String(err);
        attempts.push({ model, status: 'failure', error: errMsg });
        logger?.('warn', `FC circuit router: failure with model ${model}: ${errMsg}`, { model });

        lastEnvelope = capturedEnvelope ?? syntheticError(errMsg);

        if (nextModel !== undefined) {
          onFailover?.(model, nextModel, errMsg);
        }
      }
    }

    const finalEnvelope = lastEnvelope ?? syntheticError('all models exhausted (all circuits open)');
    const lastAttempt = attempts[attempts.length - 1];

    return {
      envelope: finalEnvelope,
      modelUsed: lastAttempt?.model ?? modelChain[0] ?? 'unknown',
      attempts,
      events: [],
      exitCode: finalEnvelope.exitCode,
    };
  };

  const ensureRouted = () => {
    routedPromise ??= runRouted();
    return routedPromise;
  };

  return {
    async *events() {
      const result = await ensureRouted();
      for (const event of result.events) {
        yield event;
      }
    },
    async complete() {
      const result = await ensureRouted();
      return {
        envelope: result.envelope,
        events: [...replayEvents],
        exitCode: result.exitCode,
      };
    },
    async completeCircuit() {
      return ensureRouted();
    },
    abort(reason?: string) {
      abortReason = reason ?? 'aborted';
      currentHandle?.abort(abortReason);
    },
  };
}

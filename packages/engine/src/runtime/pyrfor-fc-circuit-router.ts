/**
 * pyrfor-fc-circuit-router.ts
 *
 * Wraps runFreeClaude with per-model circuit breakers.
 * Iterates modelChain in order; skips open circuits, records failures,
 * and calls onFailover when switching models.
 */

import { runFreeClaude } from './pyrfor-fc-adapter';
import type { FCRunOptions, FCHandle, FCEnvelope } from './pyrfor-fc-adapter';
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
}

export interface CircuitRoutedResult {
  envelope: FCEnvelope;
  modelUsed: string;
  attempts: Array<{ model: string; status: 'success' | 'failure' | 'circuit_open'; error?: string }>;
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
  const {
    modelChain,
    failureThreshold = 3,
    cooldownMs = 30_000,
    runFn = runFreeClaude,
    getBreaker = (name, bOpts) => getCircuitBreaker(name, bOpts),
    logger,
    onFailover,
  } = router;

  const attempts: CircuitRoutedResult['attempts'] = [];
  let lastEnvelope: FCEnvelope | null = null;

  for (let i = 0; i < modelChain.length; i++) {
    const model = modelChain[i];
    const nextModel = modelChain[i + 1];

    const breaker = getBreaker(`fc-model-${model}`, {
      failureThreshold,
      resetTimeout: cooldownMs,
    });

    let capturedEnvelope: FCEnvelope | null = null;

    try {
      const envelope = await breaker.execute(async () => {
        const handle = runFn({ ...opts, model });
        const result = await handle.complete();
        capturedEnvelope = result.envelope;

        if (isFailure(result.envelope)) {
          throw new Error(
            result.envelope.error ?? `FC run failed with status: ${result.envelope.status}`,
          );
        }
        return result.envelope;
      });

      // ── Success ────────────────────────────────────────────────────────────
      attempts.push({ model, status: 'success' });
      logger?.('info', `FC circuit router: success with model ${model}`, { model });
      return { envelope, modelUsed: model, attempts };

    } catch (err) {
      if (err instanceof CircuitOpenError) {
        // ── Circuit open ───────────────────────────────────────────────────
        const errMsg = err.message;
        attempts.push({ model, status: 'circuit_open', error: errMsg });
        logger?.('warn', `FC circuit router: circuit open for ${model}`, { model });

        if (nextModel !== undefined) {
          onFailover?.(model, nextModel, errMsg);
        }
      } else {
        // ── Failure ────────────────────────────────────────────────────────
        const errMsg = err instanceof Error ? err.message : String(err);
        attempts.push({ model, status: 'failure', error: errMsg });
        logger?.('warn', `FC circuit router: failure with model ${model}: ${errMsg}`, { model });

        lastEnvelope = capturedEnvelope ?? syntheticError(errMsg);

        if (nextModel !== undefined) {
          onFailover?.(model, nextModel, errMsg);
        }
      }
    }
  }

  // ── All models exhausted ───────────────────────────────────────────────────
  const finalEnvelope = lastEnvelope ?? syntheticError('all models exhausted (all circuits open)');
  const lastAttempt = attempts[attempts.length - 1];

  return {
    envelope: finalEnvelope,
    modelUsed: lastAttempt?.model ?? modelChain[0] ?? 'unknown',
    attempts,
  };
}

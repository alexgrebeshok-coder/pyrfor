/**
 * pyrfor-fc-supervisor.ts
 *
 * Orchestrates FreeClaude (FC) event supervision:
 *   raw FCEvent → FcEventReader → FcEvent[] → FcAcpBridge → AcpEvent[]
 *   → runValidators → ValidatorResult[] → QualityGate → GateDecision
 *
 * The supervisor wires together the existing `step-validator` and
 * `quality-gate` modules with the FC event stream, providing a single
 * `FcSupervisor` interface for callers.
 */

import type { FCEvent, FCEnvelope } from './pyrfor-fc-adapter';
import type {
  StepValidator,
  ValidatorContext,
  ValidatorResult,
  ValidatorVerdict,
} from './step-validator';
import { runValidators, strongestVerdict } from './step-validator';
import type { QualityGate, GateDecision } from './quality-gate';
import type { AcpEvent } from './acp-client';
import { FcEventReader } from './pyrfor-event-reader';
import { FcAcpBridge } from './pyrfor-fc-event-bridge';

// ── Public types ──────────────────────────────────────────────────────────────

export interface SupervisorOptions {
  sessionId: string;
  cwd: string;
  task?: string;
  validators: StepValidator[];
  qualityGate: QualityGate;
  scopeFiles?: string[];
  abortSignal?: AbortSignal;
  /**
   * Called for every gate decision whose action is NOT 'continue'.
   * Callers can use this to inject corrections, block the agent, etc.
   * 'continue' decisions are intentionally omitted to reduce noise.
   */
  onGateDecision?: (decision: GateDecision) => void | Promise<void>;
  /** Called whenever validators emit results for an AcpEvent. */
  onValidatorResult?: (results: ValidatorResult[], verdict: ValidatorVerdict) => void;
  /** Optional structured logger; defaults to no-op. */
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

export interface SupervisorRunStats {
  /** Number of AcpEvents that had at least one applicable validator. */
  validatorRuns: number;
  /** Total ValidatorResult objects across all events. */
  totalResults: number;
  /** Result count per verdict level. */
  byVerdict: Record<ValidatorVerdict, number>;
  /** All gate decisions that were NOT 'continue' (mirrors onGateDecision calls). */
  gateDecisions: GateDecision[];
  /** Final verdict from `finalize()`, if called. */
  finalEnvelopeVerdict?: ValidatorVerdict;
}

export interface FcSupervisor {
  /**
   * Feed each raw FCEvent as it arrives from the FC stream.
   * Returns the AcpEvents derived (for trajectory recording) plus validation
   * results and the gate decision (if action !== 'continue').
   */
  observe(
    raw: FCEvent,
  ): Promise<{ acp: AcpEvent[]; results: ValidatorResult[]; gateDecision?: GateDecision }>;

  /**
   * Call once after the FC run completes.  Synthesises session-level AcpEvents
   * from the FCEnvelope (diff over filesTouched, terminal summary for
   * commandsRun) so diff-size / scope validators can do a final pass.
   */
  finalize(
    envelope: FCEnvelope,
  ): Promise<{ results: ValidatorResult[]; verdict: ValidatorVerdict; gateDecision?: GateDecision }>;

  /** Aggregated stats collected since the supervisor was created. */
  stats(): SupervisorRunStats;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createFcSupervisor(opts: SupervisorOptions): FcSupervisor {
  const reader = new FcEventReader();
  const bridge = new FcAcpBridge({ sessionId: opts.sessionId });
  const log = opts.logger ?? (() => {/* no-op */});

  // Mutable stats
  let validatorRuns = 0;
  let totalResults = 0;
  const byVerdict: Record<ValidatorVerdict, number> = {
    pass: 0,
    warn: 0,
    correct: 0,
    block: 0,
  };
  const gateDecisions: GateDecision[] = [];
  let finalEnvelopeVerdict: ValidatorVerdict | undefined;

  /** Shared ValidatorContext — reused across all events. */
  const ctx: ValidatorContext = {
    cwd: opts.cwd,
    task: opts.task,
    scopeFiles: opts.scopeFiles,
    abortSignal: opts.abortSignal,
  };

  /**
   * Run validators + gate on a single AcpEvent, update stats, and call
   * callbacks.  Returns accumulated results and optional gate decision.
   */
  async function processAcpEvent(
    acpEvent: AcpEvent,
  ): Promise<{ results: ValidatorResult[]; gateDecision?: GateDecision }> {
    const { verdict, results } = await runValidators({
      validators: opts.validators,
      event: acpEvent,
      ctx,
      parallel: true,
    });

    if (results.length > 0) {
      validatorRuns++;
      totalResults += results.length;
      for (const r of results) {
        byVerdict[r.verdict]++;
      }
      opts.onValidatorResult?.(results, verdict);
      log('info', `[supervisor] validators ran`, { type: acpEvent.type, verdict, count: results.length });
    }

    const gateDecision = await opts.qualityGate.evaluate(acpEvent, results);

    // Only surface non-continue decisions to the caller (reduces noise).
    if (gateDecision.action !== 'continue') {
      gateDecisions.push(gateDecision);
      log('warn', `[supervisor] gate action=${gateDecision.action}`, { reason: gateDecision.reason });
      await opts.onGateDecision?.(gateDecision);
      return { results, gateDecision };
    }

    return { results };
  }

  return {
    async observe(raw: FCEvent) {
      // Short-circuit on abort.
      if (opts.abortSignal?.aborted) {
        return { acp: [], results: [] };
      }

      const fcEvents = reader.read(raw);
      if (fcEvents.length === 0) {
        return { acp: [], results: [] };
      }

      const acpEvents = bridge.translate(fcEvents);
      if (acpEvents.length === 0) {
        return { acp: [], results: [] };
      }

      const allResults: ValidatorResult[] = [];
      let lastGateDecision: GateDecision | undefined;

      for (const acpEvent of acpEvents) {
        if (opts.abortSignal?.aborted) break;
        const { results, gateDecision } = await processAcpEvent(acpEvent);
        allResults.push(...results);
        if (gateDecision) lastGateDecision = gateDecision;
      }

      return { acp: acpEvents, results: allResults, gateDecision: lastGateDecision };
    },

    async finalize(envelope: FCEnvelope) {
      const now = Date.now();
      const syntheticEvents: AcpEvent[] = [];

      // Synthetic diff event covering every file the FC run touched.
      // diff-size / scope-check validators consume this via extractTouchedPaths.
      if (envelope.filesTouched.length > 0) {
        syntheticEvents.push({
          sessionId: opts.sessionId,
          type: 'diff',
          data: { paths: envelope.filesTouched },
          ts: now,
        });
      }

      // Synthetic terminal summary event.
      if (envelope.commandsRun.length > 0) {
        syntheticEvents.push({
          sessionId: opts.sessionId,
          type: 'terminal',
          data: { commands: envelope.commandsRun, role: 'summary' },
          ts: now,
        });
      }

      // Always run at least one synthetic event so session-wide validators
      // (e.g. diff-size with empty scope) get a chance to pass/fail.
      if (syntheticEvents.length === 0) {
        syntheticEvents.push({
          sessionId: opts.sessionId,
          type: 'diff',
          data: { paths: [] },
          ts: now,
        });
      }

      const allResults: ValidatorResult[] = [];
      let lastGateDecision: GateDecision | undefined;

      for (const acpEvent of syntheticEvents) {
        const { results, gateDecision } = await processAcpEvent(acpEvent);
        allResults.push(...results);
        if (gateDecision) lastGateDecision = gateDecision;
      }

      const verdict = strongestVerdict(allResults.map((r) => r.verdict));
      finalEnvelopeVerdict = verdict;
      log('info', `[supervisor] finalize verdict=${verdict}`, { files: envelope.filesTouched.length });

      return { results: allResults, verdict, gateDecision: lastGateDecision };
    },

    stats(): SupervisorRunStats {
      return {
        validatorRuns,
        totalResults,
        byVerdict: { ...byVerdict },
        gateDecisions: [...gateDecisions],
        finalEnvelopeVerdict,
      };
    },
  };
}

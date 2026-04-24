/**
 * acp-trajectory-bridge.ts — Phase H1→G+1 bridge.
 *
 * Wires every supervised ACP coding session into a TrajectoryRecord so the
 * pattern miner and reflector can analyse real agent behaviour.
 *
 * Constraints: ESM, pure TS, no native deps beyond Node built-ins.
 */

import { createHash } from 'node:crypto';
import type { AcpEvent, AcpStopReason, AcpSession } from './acp-client.js';
import type { ToolCallTrace } from './trajectory.js';
import type { GateDecision } from './quality-gate.js';
import type { ValidatorResult } from './step-validator.js';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * ToolCallRecord extends ToolCallTrace with an optional `kind` field used
 * to tag synthetic bridge entries (e.g. 'edit', 'execute').
 */
export type ToolCallRecord = ToolCallTrace & { kind?: string };

/**
 * Minimal recorder interface.  Compatible with the builder returned by
 * TrajectoryRecorder.begin() as well as test-double objects that have a
 * direct `finish` method.
 */
export interface BridgeRecorder {
  finish(record: {
    sessionId: string;
    success: boolean;
    finalAnswer: string;
    stopReason?: string;
    tokensUsed?: number;
    costUsd?: number;
    toolCalls?: ToolCallRecord[];
    metadata?: Record<string, unknown>;
  }): Promise<unknown> | unknown;
}

export interface AcpTrajectoryBridgeOptions {
  /** Compatible with TrajectoryBuilder or test mocks that expose finish(). */
  recorder: BridgeRecorder;
  /** ACP session id — used as the trajectory key. */
  sessionId: string;
  /** Initial task prompt. */
  userInput: string;
  /** Supervised agent name: 'freeclaude' | 'codex' | … */
  agentName: string;
  /** global | chat | project */
  scope?: string;
  /** Extra metadata forwarded verbatim into the trajectory record. */
  metadata?: Record<string, unknown>;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

export interface AcpToolCallTracker {
  recordEvent(event: AcpEvent): void;
  recordValidation(eventId: string, results: ValidatorResult[]): void;
  recordGateDecision(decision: GateDecision): void;
  recordInjection(text: string, attempt: number): void;
  finalize(
    stopReason: AcpStopReason,
    finalAnswer?: string,
    opts?: { tokensUsed?: number; costUsd?: number },
  ): Promise<void>;
  abort(reason: string): Promise<void>;
  state(): AcpBridgeState;
}

export interface AcpBridgeState {
  sessionId: string;
  toolCalls: ToolCallRecord[];
  validatorEvents: number;
  corrections: number;
  blocks: number;
  startedAt: number;
  finalised: boolean;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface PendingToolCall {
  id: string;
  name: string;
  kind: string;
  args: Record<string, unknown>;
  startTs: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_CAP = 50;
const MAX_RESULT_BYTES = 1024;

function hashOf(event: AcpEvent): string {
  const str = `${event.type}:${event.ts}:${JSON.stringify(event.data)}`;
  return createHash('sha1').update(str).digest('hex').slice(0, 8);
}

function trimResult(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > MAX_RESULT_BYTES ? str.slice(0, MAX_RESULT_BYTES) + '…' : str;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// ── createAcpTrajectoryBridge ─────────────────────────────────────────────────

export function createAcpTrajectoryBridge(
  opts: AcpTrajectoryBridgeOptions,
): AcpToolCallTracker {
  if (!opts.recorder) throw new Error('AcpTrajectoryBridge: recorder is required');

  const { recorder, sessionId, agentName, scope } = opts;
  const startedAt = Date.now();

  const toolCalls: ToolCallRecord[] = [];
  const pendingCalls = new Map<string, PendingToolCall>();
  const validationSidecar = new Map<string, ValidatorResult[]>();
  const gateDecisions: GateDecision[] = [];
  const injections: Array<{ text: string; attempt: number; ts: number }> = [];

  let validatorEvents = 0;
  let corrections = 0;
  let blocks = 0;
  let lastAgentText = '';
  let plan: unknown = undefined;
  let finalised = false;

  // ── internal finalize ──────────────────────────────────────────────────────

  function doFinalize(
    stopReason: AcpStopReason,
    finalAnswer?: string,
    finOpts?: { tokensUsed?: number; costUsd?: number; abortReason?: string },
  ): Promise<void> {
    if (finalised) return Promise.resolve();
    finalised = true;

    // Close any still-pending tool calls (agent crashed / abandoned).
    for (const [, pending] of pendingCalls) {
      toolCalls.push({
        name: pending.name,
        kind: pending.kind,
        args: pending.args,
        result: 'abandoned',
        success: false,
        latencyMs: Date.now() - pending.startTs,
        errorMessage: 'abandoned',
        timestamp: new Date().toISOString(),
      });
    }
    pendingCalls.clear();

    const answer = finalAnswer ?? lastAgentText;

    const meta: Record<string, unknown> = {
      agentName,
      scope,
      ...opts.metadata,
      validatorEvents,
      corrections,
      blocks,
      gateDecisions: [...gateDecisions],
      injections: [...injections],
      plan,
    };
    if (finOpts?.abortReason !== undefined) meta['abortReason'] = finOpts.abortReason;

    return Promise.resolve(
      recorder.finish({
        sessionId,
        success: stopReason === 'end_turn',
        finalAnswer: answer,
        stopReason,
        tokensUsed: finOpts?.tokensUsed,
        costUsd: finOpts?.costUsd,
        toolCalls: [...toolCalls],
        metadata: meta,
      }),
    ).then(() => undefined);
  }

  // ── tracker implementation ─────────────────────────────────────────────────

  return {
    // ── recordEvent ──────────────────────────────────────────────────────────
    recordEvent(event: AcpEvent): void {
      if (finalised) return;

      const data = asRecord(event.data);

      switch (event.type) {
        case 'tool_call': {
          const id = (data['id'] as string | undefined) || hashOf(event);
          pendingCalls.set(id, {
            id,
            name: (data['name'] as string | undefined) || (data['tool'] as string | undefined) || 'unknown',
            kind: (data['kind'] as string | undefined) || 'other',
            args: asRecord(data['args'] ?? data['input']),
            startTs: event.ts,
          });
          break;
        }

        case 'tool_call_update': {
          const id = data['id'] as string | undefined;
          if (!id) break;
          const pending = pendingCalls.get(id);
          if (!pending) break;
          const status = data['status'] as string | undefined;
          const hasResult = data['result'] !== undefined;
          const hasError = data['error'] !== undefined;

          if (status === 'completed' || status === 'failed' || hasResult || hasError) {
            pendingCalls.delete(id);
            const success = status !== 'failed' && !hasError;
            toolCalls.push({
              name: pending.name,
              kind: pending.kind,
              args: pending.args,
              result: trimResult(hasResult ? data['result'] : data['error']),
              success,
              latencyMs: event.ts - pending.startTs,
              errorMessage: success ? undefined : trimResult(data['error'] ?? 'failed'),
              timestamp: new Date(event.ts).toISOString(),
            });
          }
          break;
        }

        case 'diff': {
          const additions = (data['additions'] ?? data['added'] ?? 0) as number;
          const deletions = (data['deletions'] ?? data['removed'] ?? 0) as number;
          toolCalls.push({
            name: 'diff',
            kind: 'edit',
            args: { path: data['path'] ?? '' },
            result: `+${additions}/-${deletions}`,
            success: true,
            latencyMs: 0,
            timestamp: new Date(event.ts).toISOString(),
          });
          break;
        }

        case 'agent_message_chunk': {
          lastAgentText +=
            (data['text'] as string | undefined) ||
            (data['content'] as string | undefined) ||
            '';
          break;
        }

        case 'terminal': {
          const cmd =
            (data['command'] as string | undefined) ||
            (data['cmd'] as string | undefined) ||
            '';
          const output = trimResult(data['output'] ?? '');
          const exitCode = data['exitCode'] as number | undefined;
          toolCalls.push({
            name: 'terminal',
            kind: 'execute',
            args: { command: cmd },
            result: output,
            success: exitCode === undefined || exitCode === 0,
            latencyMs: 0,
            timestamp: new Date(event.ts).toISOString(),
          });
          break;
        }

        case 'plan': {
          plan = event.data;
          break;
        }

        default:
          // Unknown event types — ignore; no throw.
          break;
      }
    },

    // ── recordValidation ─────────────────────────────────────────────────────
    recordValidation(eventId: string, results: ValidatorResult[]): void {
      validationSidecar.set(eventId, [
        ...(validationSidecar.get(eventId) ?? []),
        ...results,
      ]);
      validatorEvents++;
    },

    // ── recordGateDecision ───────────────────────────────────────────────────
    recordGateDecision(decision: GateDecision): void {
      if (decision.action === 'inject_correction') corrections++;
      if (decision.action === 'block') blocks++;
      gateDecisions.push(decision);
      // Cap at 50; drop oldest entries.
      if (gateDecisions.length > MAX_CAP) {
        gateDecisions.splice(0, gateDecisions.length - MAX_CAP);
      }
    },

    // ── recordInjection ──────────────────────────────────────────────────────
    recordInjection(text: string, attempt: number): void {
      injections.push({ text, attempt, ts: Date.now() });
      if (injections.length > MAX_CAP) {
        injections.splice(0, injections.length - MAX_CAP);
      }
    },

    // ── finalize ─────────────────────────────────────────────────────────────
    finalize(
      stopReason: AcpStopReason,
      finalAnswer?: string,
      finOpts?: { tokensUsed?: number; costUsd?: number },
    ): Promise<void> {
      return doFinalize(stopReason, finalAnswer, finOpts);
    },

    // ── abort ────────────────────────────────────────────────────────────────
    abort(reason: string): Promise<void> {
      return doFinalize('cancelled', undefined, { abortReason: reason });
    },

    // ── state ────────────────────────────────────────────────────────────────
    state(): AcpBridgeState {
      return {
        sessionId,
        toolCalls: [...toolCalls],
        validatorEvents,
        corrections,
        blocks,
        startedAt,
        finalised,
      };
    },
  };
}

// ── attachBridgeToSession ─────────────────────────────────────────────────────

/**
 * Wires a live AcpSession's event stream into the bridge.
 *
 * Starts an async consumer that calls bridge.recordEvent() for every event
 * yielded by session.events().  When the iterator terminates naturally the
 * bridge is auto-finalised with stopReason='end_turn' if it has not already
 * been finalised.
 *
 * Returns an async disposer.  Calling the disposer detaches and finalises
 * the bridge (stopReason='end_turn') if not already done.
 */
export function attachBridgeToSession(
  session: AcpSession,
  bridge: AcpToolCallTracker,
): () => Promise<void> {
  let detached = false;

  const consume = async (): Promise<void> => {
    try {
      for await (const event of session.events()) {
        if (detached) break;
        bridge.recordEvent(event);
      }
    } catch {
      // Iterator threw (e.g. agent crash). Bridge will be finalised below.
    }
    // Auto-finalise when the stream ends naturally (not via disposer).
    if (!detached && !bridge.state().finalised) {
      await bridge.finalize('end_turn');
    }
  };

  void consume();

  return async (): Promise<void> => {
    detached = true;
    if (!bridge.state().finalised) {
      await bridge.finalize('end_turn');
    }
  };
}

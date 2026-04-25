/**
 * pyrfor-fc-guardrails.ts
 *
 * Pre-validation layer that wires Pyrfor's Guardrails over FreeClaude's tool calls.
 *
 * Two modes:
 *   Mode A (pre-flight): populate FC --disallowed-tools from a hard-deny list before
 *     spawning, giving the FC process zero chance to even start a forbidden tool.
 *   Mode B (post-detect + abort): monitor the FC event stream; on each ToolCallStart /
 *     BashCommand, run guardrails.evaluate(); if the decision is deny/deny-once → abort
 *     the handle immediately.
 *
 * Note: FC executes tools without an ACP control hook in v1, so Mode B is reactive —
 * the guardrail can abort the run but cannot prevent a tool that has already started.
 */

import { FcEventReader } from './pyrfor-event-reader';
import { runFreeClaude } from './pyrfor-fc-adapter';
import type { FCRunOptions, FCEnvelope, FCHandle } from './pyrfor-fc-adapter';
import type { FcEvent } from './pyrfor-event-reader';
import type { Guardrails, GuardrailDecision } from './guardrails';

// ── Public types ──────────────────────────────────────────────────────────────

export interface FcGuardrailsOptions {
  guardrails: Guardrails;
  /**
   * Hard deny patterns to add to FC --disallowed-tools (Mode A pre-flight).
   * These are appended (deduped) to any existing opts.disallowedTools.
   */
  preflightDisallow?: string[];
  /** Adapter spawner. Default: runFreeClaude. */
  runFn?: (opts: FCRunOptions) => FCHandle;
  /** Structured logger. */
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
  /** Called when guardrails block a tool mid-run (Mode B). */
  onBlock?: (event: FcEvent, decision: GuardrailDecision) => void;
  /**
   * Optional FcEventReader factory, primarily for tests.
   * Default: () => new FcEventReader()
   */
  eventReaderFactory?: () => FcEventReader;
}

export interface GuardrailedResult {
  envelope: FCEnvelope;
  /** true if the run was aborted by a guardrail deny. */
  blocked: boolean;
  /** Human-readable reason for the block, if blocked=true. */
  blockReason?: string;
  /** All guardrail decisions recorded during the run (allow and deny alike). */
  decisions: Array<{ event: FcEvent; decision: GuardrailDecision }>;
}

// ── runFreeClaudeWithGuardrails ───────────────────────────────────────────────

/**
 * Run FreeClaude with guardrails active.
 *
 * 1. Mode A: merge preflightDisallow into opts.disallowedTools (deduped).
 * 2. Mode B: spawn FC; for each FcEvent of type ToolCallStart or BashCommand:
 *    - Build a GuardrailContext from the event.
 *    - Call guardrails.evaluate(ctx).
 *    - If decision.kind in {deny, deny-once} → handle.abort('guardrail-block: '+reason); set blocked=true.
 *    - For decision.kind 'ask' → treated as allow with a warn log (no human approver available in stream).
 *    - Record every decision regardless.
 * 3. Return GuardrailedResult.
 */
export async function runFreeClaudeWithGuardrails(
  opts: FCRunOptions,
  gOpts: FcGuardrailsOptions,
): Promise<GuardrailedResult> {
  const log = gOpts.logger ?? (() => {});
  const spawn = gOpts.runFn ?? runFreeClaude;
  const makeReader = gOpts.eventReaderFactory ?? (() => new FcEventReader());

  // ── Mode A: merge preflightDisallow ──────────────────────────────────────
  const mergedDisallowed = mergeDeduped(
    opts.disallowedTools ?? [],
    gOpts.preflightDisallow ?? [],
  );

  const mergedOpts: FCRunOptions = {
    ...opts,
    disallowedTools: mergedDisallowed.length > 0 ? mergedDisallowed : undefined,
  };

  // ── Mode B: spawn + stream ────────────────────────────────────────────────
  const handle = spawn(mergedOpts);
  const reader = makeReader();

  const decisions: Array<{ event: FcEvent; decision: GuardrailDecision }> = [];
  let blocked = false;
  let blockReason: string | undefined;
  // Prevent evaluating additional tool calls after a block
  let aborted = false;

  for await (const rawEvent of handle.events()) {
    const fcEvents = reader.read(rawEvent);

    for (const fcEvent of fcEvents) {
      if (aborted) continue;

      if (fcEvent.type !== 'ToolCallStart' && fcEvent.type !== 'BashCommand') {
        continue;
      }

      // Build GuardrailContext
      let toolName: string;
      let args: Record<string, unknown>;

      if (fcEvent.type === 'ToolCallStart') {
        toolName = fcEvent.toolName;
        args = typeof fcEvent.input === 'object' && fcEvent.input !== null
          ? (fcEvent.input as Record<string, unknown>)
          : { input: fcEvent.input };
      } else {
        // BashCommand
        toolName = 'Bash';
        args = { command: fcEvent.command };
      }

      const ctx = {
        agentId: opts.workdir ?? 'freeclaude',
        toolName,
        args,
        sessionId: undefined as string | undefined,
        cwd: opts.workdir,
      };

      let decision: GuardrailDecision;
      try {
        decision = await gOpts.guardrails.evaluate(ctx);
      } catch (err) {
        log('error', '[fc-guardrails] evaluate threw', { err, toolName });
        continue;
      }

      decisions.push({ event: fcEvent, decision });

      if (decision.kind === 'deny' || decision.kind === 'deny-once') {
        const reason = decision.reason;
        blockReason = `guardrail-block: ${reason}`;
        log('warn', `[fc-guardrails] blocking tool "${toolName}"`, { reason, kind: decision.kind });
        gOpts.onBlock?.(fcEvent, decision);
        blocked = true;
        aborted = true;
        handle.abort(blockReason);
        break;
      }

      if (decision.kind === 'ask') {
        // No human approver available mid-stream; treat as allow + warn.
        log('warn', `[fc-guardrails] tool "${toolName}" requires approval (ask) — treating as allow in stream mode`, {
          toolName,
          reason: decision.reason,
        });
      }
    }

    if (aborted) break;
  }

  // Drain remaining reader state
  reader.flush();

  const result = await handle.complete();
  return {
    envelope: result.envelope,
    blocked,
    blockReason,
    decisions,
  };
}

// ── derivePreflightDisallow ───────────────────────────────────────────────────

/**
 * Best-effort: derive a list of FC --disallowed-tools strings from the
 * guardrails policies.
 *
 * Uses `guardrails.getPolicies()` (the standard method on the Guardrails
 * interface) to find policies with tier 'forbidden', and converts them to FC
 * disallow syntax: `${toolName}(${pattern})` when a pattern exists, or just
 * `${toolName}` when it doesn't.
 *
 * Also falls back to the optional `listPolicies?.()` method for compatibility
 * with alternative Guardrails implementations.
 *
 * Returns [] if neither method is available or no forbidden policies exist.
 */
export function derivePreflightDisallow(guardrails: Guardrails): string[] {
  const g = guardrails as any;

  let policies: Array<{ toolName: string; tier: string; pattern?: RegExp | string }> | undefined;

  // Prefer standard Guardrails.getPolicies()
  if (typeof g.getPolicies === 'function') {
    try {
      policies = g.getPolicies();
    } catch {
      // ignore
    }
  }

  // Fallback for alternative implementations
  if (!policies && typeof g.listPolicies === 'function') {
    try {
      policies = g.listPolicies();
    } catch {
      // ignore
    }
  }

  if (!policies) return [];

  const result: string[] = [];
  for (const policy of policies) {
    if (policy.tier !== 'forbidden') continue;

    if (policy.pattern) {
      // Convert RegExp source or plain string to FC pattern syntax
      const patternStr =
        policy.pattern instanceof RegExp ? policy.pattern.source : String(policy.pattern);
      result.push(`${policy.toolName}(${patternStr})`);
    } else {
      result.push(policy.toolName);
    }
  }
  return result;
}

// ── Private helpers ───────────────────────────────────────────────────────────

function mergeDeduped(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  const merged = [...base];
  for (const item of extra) {
    if (!seen.has(item)) {
      seen.add(item);
      merged.push(item);
    }
  }
  return merged;
}

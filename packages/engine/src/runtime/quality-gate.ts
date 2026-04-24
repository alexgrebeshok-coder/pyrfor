/**
 * Pyrfor Coding Supervisor — Quality Gate
 *
 * Consumes ValidatorResults, decides whether to continue, inject a correction
 * prompt, block, or hand off to the user. Tracks per-event and session-wide
 * attempt budgets.
 */

import { createHash } from 'node:crypto';
import type { AcpEvent } from './acp-client.js';

// ── ValidatorResult types ────────────────────────────────────────────────────
// Defined locally so the gate compiles even before step-validator.ts lands.
// When the sister agent ships step-validator.ts, these are identical shapes,
// so a future re-export swap is trivial.

export type ValidatorVerdict = 'pass' | 'warn' | 'correct' | 'block';

export interface ValidatorResult {
  validator: string;
  verdict: ValidatorVerdict;
  message: string;
  details?: any;
  remediation?: string;
  durationMs: number;
}

// ── Public types ─────────────────────────────────────────────────────────────

export type GateAction = 'continue' | 'inject_correction' | 'block' | 'request_user';

export interface QualityGateConfig {
  /** Default 3 */
  maxCorrectAttemptsPerEvent?: number;
  /** Default 10 */
  maxCorrectAttemptsPerSession?: number;
  /** Soft token cap; default 100_000 */
  budgetTokens?: number;
  /** Whether a 'warn' verdict is treated as 'correct'; default false */
  warnIsCorrection?: boolean;
  injectionTemplate?: (input: InjectionContext) => string;
  /** Optional context blob injected into correction prompts */
  ceoClawContext?: () => Promise<string> | string;
  /** Optional LLM call used to enrich remediation text */
  llmFn?: (prompt: string) => Promise<string>;
  logger?: (level: 'info' | 'warn' | 'error', msg: string, meta?: any) => void;
}

export interface InjectionContext {
  event: AcpEvent;
  results: ValidatorResult[];
  attempt: number;
  ceoContext?: string;
}

export interface GateDecision {
  action: GateAction;
  injection?: string;
  reason: string;
  results: ValidatorResult[];
  attempt: number;
  remainingPerEvent: number;
  remainingPerSession: number;
}

export interface QualityGateState {
  sessionId: string;
  totalCorrections: number;
  /** keyed by stable event id */
  perEventAttempts: Map<string, number>;
  tokensUsed: number;
  blocked: boolean;
  history: GateDecision[];
}

export interface QualityGate {
  evaluate(
    event: AcpEvent,
    results: ValidatorResult[],
    opts?: { eventId?: string; tokensUsed?: number },
  ): Promise<GateDecision>;
  state(): QualityGateState;
  reset(): void;
  override(action: 'unblock' | 'reset_event_attempts', payload?: any): void;
}

export interface CreateQualityGateOptions extends QualityGateConfig {
  sessionId: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const VERDICT_RANK: Record<ValidatorVerdict, number> = {
  pass: 0,
  warn: 1,
  correct: 2,
  block: 3,
};

/** Returns the most severe verdict from a list. */
export function strongestVerdict(verdicts: ValidatorVerdict[]): ValidatorVerdict {
  if (verdicts.length === 0) return 'pass';
  return verdicts.reduce<ValidatorVerdict>((best, v) =>
    VERDICT_RANK[v] > VERDICT_RANK[best] ? v : best,
  'pass');
}

function stableEventId(event: AcpEvent): string {
  const raw =
    String(event.type) +
    String(event.ts) +
    JSON.stringify(event.data).slice(0, 200);
  return createHash('sha1').update(raw).digest('hex').slice(0, 16);
}

const HISTORY_CAP = 100;

/** Default correction-prompt template. */
export function defaultInjectionTemplate(input: InjectionContext): string {
  const lines: string[] = [];
  lines.push(`[PYRFOR QUALITY GATE — attempt ${input.attempt}]`);

  if (input.ceoContext) {
    lines.push('');
    lines.push('Context:');
    lines.push(input.ceoContext);
  }

  lines.push('');
  lines.push('Validators flagged the following issue(s):');

  for (const r of input.results) {
    if (r.verdict === 'correct' || r.verdict === 'block') {
      lines.push(`- [${r.validator}] ${r.message}`);
      if (r.remediation) {
        lines.push(`  ${r.remediation}`);
      }
    }
  }

  lines.push('');
  lines.push('Please fix these issues and continue.');
  return lines.join('\n');
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createQualityGate(opts: CreateQualityGateOptions): QualityGate {
  const maxPerEvent = opts.maxCorrectAttemptsPerEvent ?? 3;
  const maxPerSession = opts.maxCorrectAttemptsPerSession ?? 10;
  const budgetTokens = opts.budgetTokens ?? 100_000;
  const warnIsCorrection = opts.warnIsCorrection ?? false;
  const template = opts.injectionTemplate ?? defaultInjectionTemplate;
  const log = opts.logger ?? (() => {});

  // Mutable state
  let state: QualityGateState = makeEmptyState(opts.sessionId);

  function makeEmptyState(sessionId: string): QualityGateState {
    return {
      sessionId,
      totalCorrections: 0,
      perEventAttempts: new Map(),
      tokensUsed: 0,
      blocked: false,
      history: [],
    };
  }

  function pushHistory(d: GateDecision) {
    state.history.push(d);
    if (state.history.length > HISTORY_CAP) {
      state.history.shift();
    }
  }

  async function evaluate(
    event: AcpEvent,
    results: ValidatorResult[],
    evalOpts?: { eventId?: string; tokensUsed?: number },
  ): Promise<GateDecision> {
    // Accumulate external token usage if provided
    if (evalOpts?.tokensUsed != null) {
      state.tokensUsed += evalOpts.tokensUsed;
    }

    // 1. Hard block already set
    if (state.blocked) {
      const d: GateDecision = {
        action: 'block',
        reason: 'session is blocked',
        results,
        attempt: 0,
        remainingPerEvent: 0,
        remainingPerSession: maxPerSession - state.totalCorrections,
      };
      pushHistory(d);
      return d;
    }

    // 2. Empty results
    if (results.length === 0) {
      const d: GateDecision = {
        action: 'continue',
        reason: 'no validators applied',
        results,
        attempt: 0,
        remainingPerEvent: maxPerEvent,
        remainingPerSession: maxPerSession - state.totalCorrections,
      };
      pushHistory(d);
      return d;
    }

    // 3. Strongest verdict
    const verdicts = results.map((r) => r.verdict);
    let strongest = strongestVerdict(verdicts);

    // 4. Check requireUser flag
    const requiresUser = results.some((r) => r.details?.requireUser === true);
    if (requiresUser) {
      const d: GateDecision = {
        action: 'request_user',
        reason: 'validator requires user review',
        results,
        attempt: 0,
        remainingPerEvent: maxPerEvent,
        remainingPerSession: maxPerSession - state.totalCorrections,
      };
      pushHistory(d);
      return d;
    }

    // 5. Resolve effective verdict
    if (strongest === 'warn' && warnIsCorrection) {
      strongest = 'correct';
    }

    const eventId = evalOpts?.eventId ?? stableEventId(event);

    // 6. Handle 'pass' / 'warn' (not treated as correction)
    if (strongest === 'pass' || strongest === 'warn') {
      const d: GateDecision = {
        action: 'continue',
        reason: `strongest verdict: ${strongest}`,
        results,
        attempt: 0,
        remainingPerEvent: maxPerEvent - (state.perEventAttempts.get(eventId) ?? 0),
        remainingPerSession: maxPerSession - state.totalCorrections,
      };
      pushHistory(d);
      return d;
    }

    // 7. Handle 'block' from validators
    if (strongest === 'block') {
      state.blocked = true;
      const d: GateDecision = {
        action: 'block',
        reason: 'validator issued block verdict',
        results,
        attempt: state.perEventAttempts.get(eventId) ?? 0,
        remainingPerEvent: 0,
        remainingPerSession: 0,
      };
      pushHistory(d);
      log('warn', '[quality-gate] blocked by validator', { eventId });
      return d;
    }

    // 8. Handle 'correct'
    const prevAttempts = state.perEventAttempts.get(eventId) ?? 0;
    const attempt = prevAttempts + 1;

    const overPerEvent = prevAttempts >= maxPerEvent;
    const overSession = state.totalCorrections >= maxPerSession;
    const overBudget = state.tokensUsed >= budgetTokens;

    if (overPerEvent || overSession || overBudget) {
      state.blocked = true;
      const reason = overPerEvent
        ? `exceeded per-event auto-fix budget (${maxPerEvent})`
        : overBudget
          ? `exceeded token budget (${budgetTokens})`
          : `exceeded session auto-fix budget (${maxPerSession})`;
      const d: GateDecision = {
        action: 'block',
        reason: 'exceeded auto-fix budget',
        results,
        attempt: prevAttempts,
        remainingPerEvent: 0,
        remainingPerSession: Math.max(0, maxPerSession - state.totalCorrections),
      };
      pushHistory(d);
      log('warn', `[quality-gate] ${reason}`, { eventId });
      return d;
    }

    // Build injection prompt
    let ceoContext: string | undefined;
    if (opts.ceoClawContext) {
      try {
        ceoContext = await opts.ceoClawContext();
      } catch {
        // silently ignore
      }
    }

    const ctx: InjectionContext = { event, results, attempt, ceoContext };

    // Try to enrich via llmFn only when at least one result lacks remediation
    const needsLlm = results.some((r) => (r.verdict === 'correct' || r.verdict === 'block') && !r.remediation);
    let injection = template(ctx);

    if (opts.llmFn && needsLlm) {
      try {
        const enriched = await opts.llmFn(injection);
        injection = enriched;
      } catch (err) {
        log('warn', '[quality-gate] llmFn failed, falling back to template', { err });
        // keep template-only injection
      }
    }

    // Commit state changes
    state.perEventAttempts.set(eventId, attempt);
    state.totalCorrections += 1;

    const d: GateDecision = {
      action: 'inject_correction',
      injection,
      reason: `auto-fix attempt ${attempt}`,
      results,
      attempt,
      remainingPerEvent: maxPerEvent - attempt,
      remainingPerSession: maxPerSession - state.totalCorrections,
    };
    pushHistory(d);
    log('info', `[quality-gate] injecting correction attempt=${attempt}`, { eventId });
    return d;
  }

  return {
    evaluate,
    state(): QualityGateState {
      return {
        ...state,
        perEventAttempts: new Map(state.perEventAttempts),
        history: [...state.history],
      };
    },
    reset() {
      state = makeEmptyState(opts.sessionId);
    },
    override(action: 'unblock' | 'reset_event_attempts', payload?: any) {
      if (action === 'unblock') {
        state.blocked = false;
        log('info', '[quality-gate] manually unblocked');
      } else if (action === 'reset_event_attempts') {
        const eid: string | undefined = payload?.eventId;
        if (eid) {
          state.perEventAttempts.delete(eid);
          log('info', '[quality-gate] reset per-event attempts', { eventId: eid });
        }
      }
    },
  };
}

/**
 * pyrfor-fc-plan-act.ts
 *
 * Two-stage orchestration: a planning model produces a numbered plan, then an
 * execution model carries it out.
 *
 * Text extraction contract:
 *   fcRunner is expected to return an FCEnvelope whose `raw` field has a
 *   `lastAssistantText` property (string) populated by the caller/test stub.
 *   This module reads `envelope.raw.lastAssistantText` to extract the plan.
 *   If absent, it falls back to `String(envelope.output ?? '')`.
 */

import type { FCEnvelope, FCRunOptions } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlanActOptions {
  task: string;
  workdir: string;
  fcRunner: typeof runFreeClaude;
  planModel: string;
  actModel: string;
  planSystemPrompt?: string;
  actSystemPrompt?: string;
  /** Override plan text → string[] conversion. Default: split on newlines, keep numbered lines. */
  parsePlan?: (text: string) => string[];
  trajectory?: { append: (ev: any) => void };
}

export interface PlanActResult {
  plan: string[];
  planEnvelope: FCEnvelope;
  actEnvelope: FCEnvelope;
  totalCostUsd: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PLAN_SYSTEM_PROMPT = 'You are a planning model. Output a numbered plan only.';

function defaultParsePlan(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+[\.\)]\s+/.test(l))
    .map((l) => l.replace(/^\d+[\.\)]\s+/, '').trim());
}

function extractText(envelope: FCEnvelope): string {
  if (envelope.raw && typeof envelope.raw.lastAssistantText === 'string') {
    return envelope.raw.lastAssistantText;
  }
  return String(envelope.output ?? '');
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function runPlanAct(opts: PlanActOptions): Promise<PlanActResult> {
  const planSystemPrompt = opts.planSystemPrompt ?? DEFAULT_PLAN_SYSTEM_PROMPT;
  const parsePlan = opts.parsePlan ?? defaultParsePlan;

  // ── Stage 1: Plan ──────────────────────────────────────────────────────────
  opts.trajectory?.append({ type: 'plan_act_stage_start', stage: 'plan', model: opts.planModel });

  const planOpts: FCRunOptions = {
    prompt: opts.task,
    workdir: opts.workdir,
    model: opts.planModel,
    systemPrompt: planSystemPrompt,
  };

  const planHandle = opts.fcRunner(planOpts);
  const planResult = await planHandle.complete();
  const planEnvelope = planResult.envelope;

  opts.trajectory?.append({ type: 'plan_act_stage_end', stage: 'plan', envelope: planEnvelope });

  if (planEnvelope.status === 'error') {
    throw new Error(
      `Plan stage failed: ${planEnvelope.error ?? 'unknown error'}`,
    );
  }

  const rawText = extractText(planEnvelope);
  const plan = parsePlan(rawText);

  // ── Stage 2: Act ───────────────────────────────────────────────────────────
  const actPrompt = [
    opts.task,
    '',
    'PLAN:',
    plan.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    'Execute the plan now.',
  ].join('\n');

  opts.trajectory?.append({ type: 'plan_act_stage_start', stage: 'act', model: opts.actModel, plan });

  const actOpts: FCRunOptions = {
    prompt: actPrompt,
    workdir: opts.workdir,
    model: opts.actModel,
    ...(opts.actSystemPrompt ? { systemPrompt: opts.actSystemPrompt } : {}),
  };

  const actHandle = opts.fcRunner(actOpts);
  const actResult = await actHandle.complete();
  const actEnvelope = actResult.envelope;

  opts.trajectory?.append({ type: 'plan_act_stage_end', stage: 'act', envelope: actEnvelope });

  const totalCostUsd = (planEnvelope.costUsd ?? 0) + (actEnvelope.costUsd ?? 0);

  return { plan, planEnvelope, actEnvelope, totalCostUsd };
}

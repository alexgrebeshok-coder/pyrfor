/**
 * pyrfor-fc-quest.ts
 *
 * Quest Mode: orchestrate a chained series of FreeClaude invocations driven by
 * a QuestSpec. Steps run in order; each step can retry on failure.
 *
 * Template substitution supports:
 *   - {{varName}}              → from opts.templateVars
 *   - {{prev.lastFile}}        → last entry of previous envelope.filesTouched
 *   - {{prev.filesTouched}}    → comma-joined previous envelope.filesTouched
 *   - {{step.<id>.sessionId}}  → sessionId from a named prior step's envelope
 */

import type { FCEnvelope, FCRunOptions } from './pyrfor-fc-adapter';
import { runFreeClaude } from './pyrfor-fc-adapter';

// ── Public types ──────────────────────────────────────────────────────────────

export interface QuestStep {
  id: string;
  prompt: string;
  model?: string;
  successCriteria?: (env: FCEnvelope) => boolean | Promise<boolean>;
  retries?: number;
}

export interface QuestSpec {
  name: string;
  steps: QuestStep[];
}

export interface QuestStepResult {
  id: string;
  envelope: FCEnvelope;
  attempts: number;
  success: boolean;
}

export interface QuestResult {
  name: string;
  steps: QuestStepResult[];
  success: boolean;
  totalCostUsd: number;
}

export interface QuestOptions {
  spec: QuestSpec;
  workdir: string;
  fcRunner: typeof runFreeClaude;
  templateVars?: Record<string, string>;
  trajectory?: { append: (ev: any) => void };
}

// ── Template resolution ───────────────────────────────────────────────────────

function resolveTemplate(
  template: string,
  templateVars: Record<string, string>,
  prevEnvelope: FCEnvelope | null,
  stepEnvelopes: Map<string, FCEnvelope>,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const k = key.trim();

    // {{prev.lastFile}}
    if (k === 'prev.lastFile') {
      if (!prevEnvelope || prevEnvelope.filesTouched.length === 0) return '';
      return prevEnvelope.filesTouched[prevEnvelope.filesTouched.length - 1];
    }

    // {{prev.filesTouched}}
    if (k === 'prev.filesTouched') {
      if (!prevEnvelope) return '';
      return prevEnvelope.filesTouched.join(',');
    }

    // {{step.<id>.envelope.sessionId}} or {{step.<id>.sessionId}}
    const stepMatch = k.match(/^step\.([^.]+)(?:\.envelope)?\.sessionId$/);
    if (stepMatch) {
      const stepId = stepMatch[1];
      const env = stepEnvelopes.get(stepId);
      return env?.sessionId ?? '';
    }

    // Caller-provided template vars
    if (k in templateVars) return templateVars[k];

    return _match; // leave unresolved placeholders as-is
  });
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function runQuest(opts: QuestOptions): Promise<QuestResult> {
  const { spec, workdir, fcRunner } = opts;
  const templateVars = opts.templateVars ?? {};
  const stepResults: QuestStepResult[] = [];
  const stepEnvelopes = new Map<string, FCEnvelope>();
  let prevEnvelope: FCEnvelope | null = null;
  let questSuccess = true;
  let totalCostUsd = 0;

  for (const step of spec.steps) {
    const maxAttempts = (step.retries ?? 0) + 1;
    let attempts = 0;
    let lastEnvelope: FCEnvelope | null = null;
    let stepSucceeded = false;

    opts.trajectory?.append({ type: 'quest_step_start', id: step.id });

    const resolvedPrompt = resolveTemplate(step.prompt, templateVars, prevEnvelope, stepEnvelopes);

    while (attempts < maxAttempts) {
      attempts++;

      const runOpts: FCRunOptions = {
        prompt: resolvedPrompt,
        workdir,
        ...(step.model ? { model: step.model } : {}),
      };

      const handle = fcRunner(runOpts);
      const result = await handle.complete();
      lastEnvelope = result.envelope;
      totalCostUsd += lastEnvelope.costUsd ?? 0;

      if (step.successCriteria) {
        const ok = await step.successCriteria(lastEnvelope);
        if (ok) {
          stepSucceeded = true;
          break;
        }
      } else {
        stepSucceeded = lastEnvelope.status !== 'error';
        if (stepSucceeded) break;
      }
    }

    const stepResult: QuestStepResult = {
      id: step.id,
      envelope: lastEnvelope!,
      attempts,
      success: stepSucceeded,
    };

    stepResults.push(stepResult);
    stepEnvelopes.set(step.id, lastEnvelope!);
    prevEnvelope = lastEnvelope;

    opts.trajectory?.append({
      type: 'quest_step_end',
      id: step.id,
      success: stepSucceeded,
      attempts,
    });

    if (!stepSucceeded) {
      questSuccess = false;
      break;
    }
  }

  return {
    name: spec.name,
    steps: stepResults,
    success: questSuccess,
    totalCostUsd,
  };
}

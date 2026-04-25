// @vitest-environment node
import type { IterationResult } from './pyrfor-fc-ralph.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextRotateInput {
  iter: number;
  history: IterationResult[];
  basePrompt: string;
  lessonsBuilder?: () => Promise<string>;
}

export interface RotatedContext {
  appendSystemPrompt?: string;
  resumeSessionId?: string;
  prompt: string;
}

// ─── rotateContext ────────────────────────────────────────────────────────────

export async function rotateContext(
  input: ContextRotateInput
): Promise<RotatedContext> {
  const { iter, history, basePrompt, lessonsBuilder } = input;

  // Iteration 1: no context rotation needed
  if (iter === 1 || history.length === 0) {
    return { prompt: basePrompt };
  }

  const prev = history[history.length - 1]!;
  const prevScore = prev.score.total;
  const breakdownStr = JSON.stringify(prev.score.breakdown);

  const correctionNote = `[ITERATION ${iter}] Previous score: ${prevScore}/100. Failures: ${breakdownStr}. Address these specifically.`;
  const lightNote = `[ITERATION ${iter}] Previous score: ${prevScore}/100. Continue improving.`;

  // Lessons prefix (if builder provided)
  let lessonsPrefix = '';
  if (lessonsBuilder) {
    const lessons = await lessonsBuilder();
    if (lessons) {
      lessonsPrefix = `${lessons}\n\n`;
    }
  }

  const prevSessionId = prev.envelope.sessionId ?? undefined;

  if (prevScore < 50) {
    // Fresh start: no resume, corrections + lessons in appendSystemPrompt
    const appendSystemPrompt = lessonsPrefix + correctionNote;
    return {
      prompt: basePrompt,
      appendSystemPrompt: appendSystemPrompt || undefined,
    };
  } else if (prevScore < 80) {
    // Resume previous session + correction note
    return {
      prompt: basePrompt,
      resumeSessionId: prevSessionId,
      appendSystemPrompt: lessonsPrefix + correctionNote,
    };
  } else {
    // Score >= 80: light append + resume
    const appendSystemPrompt = lessonsPrefix + lightNote;
    return {
      prompt: basePrompt,
      resumeSessionId: prevSessionId,
      appendSystemPrompt: appendSystemPrompt || undefined,
    };
  }
}

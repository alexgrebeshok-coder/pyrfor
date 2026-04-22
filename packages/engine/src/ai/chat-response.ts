import type { AIConfidenceSummary, AIEvidenceFact } from './types';

export interface AIChatResponsePayload {
  success?: boolean;
  response?: string;
  error?: string;
  provider?: string;
  model?: string;
  runId?: string;
  status?: string;
  facts?: unknown;
  confidence?: unknown;
  context?: Record<string, unknown>;
}

export function normalizeChatFacts(value: unknown): AIEvidenceFact[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((fact) => normalizeChatFact(fact))
    .filter((fact): fact is AIEvidenceFact => fact !== null)
    .slice(0, 4);
}

export function normalizeChatConfidence(value: unknown): AIConfidenceSummary | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<AIConfidenceSummary> & {
    band?: unknown;
    basis?: unknown;
    score?: unknown;
    label?: unknown;
    rationale?: unknown;
  };

  const score = normalizeScore(candidate.score);
  const band = normalizeBand(candidate.band);
  const label = normalizeString(candidate.label);
  const rationale = normalizeString(candidate.rationale);

  if (score === null || !band || !label || !rationale) {
    return undefined;
  }

  const basis = Array.isArray(candidate.basis)
    ? candidate.basis
        .map((item) => normalizeString(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, 4)
    : [];

  return {
    score,
    band,
    label,
    rationale,
    basis,
  };
}

function normalizeChatFact(value: unknown): AIEvidenceFact | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    href?: unknown;
    label?: unknown;
    meta?: unknown;
    value?: unknown;
  };

  const label = normalizeString(candidate.label);
  const text = normalizeString(candidate.value);

  if (!label || !text) {
    return null;
  }

  const fact: AIEvidenceFact = {
    label,
    value: text,
  };

  const href = normalizeString(candidate.href);
  if (href) {
    fact.href = href;
  }

  const meta = normalizeString(candidate.meta);
  if (meta) {
    fact.meta = meta;
  }

  return fact;
}

function normalizeBand(value: unknown): AIConfidenceSummary["band"] | null {
  return value === "low" || value === "medium" || value === "high" || value === "strong"
    ? value
    : null;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

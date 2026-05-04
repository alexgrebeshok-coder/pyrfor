import { createHash } from 'node:crypto';

export interface ResearchEvidenceSourceInput {
  url: string;
  title?: string;
  snippet?: string;
  citation?: string;
  observedAt?: string;
}

export interface ResearchEvidenceInput {
  query: string;
  sources: ResearchEvidenceSourceInput[];
  summary?: string;
  conclusion?: string;
  notes?: string[];
}

export interface ResearchEvidenceSource {
  url: string;
  title?: string;
  snippet?: string;
  citation?: string;
  observedAt?: string;
}

export interface ResearchEvidenceSnapshot {
  schemaVersion: 'pyrfor.research_evidence.v1';
  createdAt: string;
  runId: string;
  query: string;
  queryHash: string;
  sourceMode: 'operator_supplied';
  effectsExecuted: [];
  sources: ResearchEvidenceSource[];
  summary?: string;
  conclusion?: string;
  notes: string[];
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeHttpUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`ResearchEvidence: invalid source URL: ${value}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`ResearchEvidence: source URL must use http or https: ${value}`);
  }
  parsed.hash = '';
  return parsed.toString();
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function createResearchEvidenceSnapshot(
  runId: string,
  input: ResearchEvidenceInput,
  now: () => Date = () => new Date(),
): ResearchEvidenceSnapshot {
  const query = nonEmptyText(input.query);
  if (!query) throw new Error('ResearchEvidence: query is required');
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error('ResearchEvidence: at least one source is required');
  }
  if (input.sources.length > 25) {
    throw new Error('ResearchEvidence: sources are limited to 25 per artifact');
  }
  const sources = input.sources.map((source) => {
    const url = nonEmptyText(source.url);
    if (!url) throw new Error('ResearchEvidence: source URL is required');
    return {
      url: normalizeHttpUrl(url),
      ...(nonEmptyText(source.title) ? { title: nonEmptyText(source.title) } : {}),
      ...(nonEmptyText(source.snippet) ? { snippet: nonEmptyText(source.snippet) } : {}),
      ...(nonEmptyText(source.citation) ? { citation: nonEmptyText(source.citation) } : {}),
      ...(nonEmptyText(source.observedAt) ? { observedAt: nonEmptyText(source.observedAt) } : {}),
    };
  });
  return {
    schemaVersion: 'pyrfor.research_evidence.v1',
    createdAt: now().toISOString(),
    runId,
    query,
    queryHash: hashText(query),
    sourceMode: 'operator_supplied',
    effectsExecuted: [],
    sources,
    ...(nonEmptyText(input.summary) ? { summary: nonEmptyText(input.summary) } : {}),
    ...(nonEmptyText(input.conclusion) ? { conclusion: nonEmptyText(input.conclusion) } : {}),
    notes: (Array.isArray(input.notes) ? input.notes : []).map(nonEmptyText).filter((note): note is string => Boolean(note)),
  };
}

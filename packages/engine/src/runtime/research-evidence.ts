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

export type ResearchSearchProvider = 'brave' | 'duckduckgo';

export interface ResearchEvidenceWebSearchEffect {
  kind: 'web_search';
  provider: ResearchSearchProvider;
  approvalId: string;
  executedAt: string;
  maxResults: number;
  resultCount: number;
}

export interface OperatorResearchEvidenceSnapshot {
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

export interface GovernedSearchResearchEvidenceSnapshot {
  schemaVersion: 'pyrfor.research_evidence.v2';
  createdAt: string;
  runId: string;
  query: string;
  queryHash: string;
  sourceMode: 'governed_search';
  effectsExecuted: [ResearchEvidenceWebSearchEffect];
  sources: ResearchEvidenceSource[];
  summary?: string;
  conclusion?: string;
  notes: string[];
}

export type ResearchEvidenceSnapshot =
  | OperatorResearchEvidenceSnapshot
  | GovernedSearchResearchEvidenceSnapshot;

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const SENSITIVE_URL_QUERY_KEY_RE = /(token|secret|password|passwd|credential|signature|authorization|apikey|accesskey|keypairid)|(^|[-_])(auth|sig|pwd)([-_]|$)|^api[-_]?key$|^access[-_]?key$|^awsaccesskeyid$|^key[-_]?pair[-_]?id$|^x-amz-|^x-goog-|^x-oss-/i;

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
  if (parsed.username || parsed.password) {
    throw new Error('ResearchEvidence: source URL must not contain embedded credentials');
  }
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (SENSITIVE_URL_QUERY_KEY_RE.test(key)) {
      parsed.searchParams.set(key, 'redacted');
    }
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
): OperatorResearchEvidenceSnapshot {
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

export function createGovernedSearchResearchEvidenceSnapshot(
  runId: string,
  input: {
    query: string;
    notes?: string[];
    approvalId: string;
    provider: ResearchSearchProvider;
    maxResults: number;
    executedAt: string;
    results: ResearchEvidenceSourceInput[];
  },
  now: () => Date = () => new Date(),
): GovernedSearchResearchEvidenceSnapshot {
  const query = nonEmptyText(input.query);
  if (!query) throw new Error('ResearchEvidence: query is required');
  const approvalId = nonEmptyText(input.approvalId);
  if (!approvalId) throw new Error('ResearchEvidence: approvalId is required for governed search');
  if (!Array.isArray(input.results) || input.results.length === 0) {
    throw new Error('ResearchEvidence: governed search returned no sources');
  }
  const sources = input.results.slice(0, input.maxResults).map((source) => {
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
    schemaVersion: 'pyrfor.research_evidence.v2',
    createdAt: now().toISOString(),
    runId,
    query,
    queryHash: hashText(query),
    sourceMode: 'governed_search',
    effectsExecuted: [{
      kind: 'web_search',
      provider: input.provider,
      approvalId,
      executedAt: input.executedAt,
      maxResults: input.maxResults,
      resultCount: sources.length,
    }],
    sources,
    summary: `Governed ${input.provider} search captured ${sources.length} source${sources.length === 1 ? '' : 's'}.`,
    notes: (Array.isArray(input.notes) ? input.notes : []).map(nonEmptyText).filter((note): note is string => Boolean(note)),
  };
}

import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { MemoryEntry, MemoryStore } from '../memory-store';

export type ExperienceProjectionVersion = 'pyrfor.experience.v1';
export type ExperienceOutcome = 'completed' | 'failed' | 'cancelled' | 'blocked';
export type ExperienceAudience = 'planner' | 'audit' | 'operator';
export type ExperienceRetrievalBackend = 'fts' | 'embedding';
export type ExperienceEmbedder = (texts: string[]) => Promise<number[][]> | number[][];

export interface ExperienceProvenance {
  sourceRunId: string;
  conceptId?: string;
  parentConceptId?: string;
  retryOf?: string;
  memoryEntryIds: string[];
  artifactIds: string[];
}

export interface ExperienceEntry {
  id: string;
  runId: string;
  conceptId?: string;
  projectId: string;
  schemaVersion: ExperienceProjectionVersion;
  approvalState: 'approved' | 'quarantined' | 'rejected';
  legacy: boolean;
  quarantined: boolean;
  provenance: ExperienceProvenance;
  retrievalKey: {
    fts: string;
    goalKeywords: string[];
    toolSignatures: string[];
  };
  domain?: string;
  outcome: ExperienceOutcome;
  whatWorked: string[];
  whatFailed: string[];
  reusablePatterns: string[];
  durationMs?: number;
  toolCallCount?: number;
  costUsd?: number;
  verifierScore?: number;
  acceptanceTestPassRate?: number;
  wasPatternApplied: boolean;
  patternEffectiveness?: number;
  createdAt: string;
  indexedAt: string;
  sourceMemory: MemoryEntry;
  sourceArtifacts: ArtifactRef[];
}

export interface ExperienceQuery {
  goal?: string;
  projectId: string;
  domain?: string;
  toolSignatures?: string[];
  minVerifierScore?: number;
  outcome?: ExperienceOutcome;
  limit?: number;
  includeFailed?: boolean;
  audience: ExperienceAudience;
  retrievalBackend?: ExperienceRetrievalBackend;
}

export interface ExperienceLibrary {
  query(q: ExperienceQuery): Promise<ExperienceEntry[]>;
  queryForPlanner(q: Omit<ExperienceQuery, 'audience'>): Promise<ExperienceEntry[]>;
  findSimilar(q: { goal: string; projectId: string; limit: number }): Promise<ExperienceEntry[]>;
  getPatternEffectiveness(patternKey: string): Promise<number>;
  getTopPatterns(domain: string, limit: number): Promise<PatternStat[]>;
}

export interface PatternStat {
  patternKey: string;
  occurrences: number;
  averageEffectiveness: number;
  evidenceEntryIds: string[];
}

export interface ExperienceLibraryOptions {
  memoryStore: MemoryStore;
  artifactStore?: ArtifactStore;
  embeddings?: {
    enabled: boolean;
    embedder?: ExperienceEmbedder;
    minScore?: number;
    onFallback?: (reason: string, error?: unknown) => void;
  };
  now?: () => Date;
}

type LessonRecordShape = {
  kind?: 'single_loop' | 'double_loop';
  sourceRunId?: string;
  conceptId?: string;
  artifactIds?: string[];
  approvalState?: ExperienceEntry['approvalState'] | 'pending_approval';
  legacy?: boolean;
  quarantined?: boolean;
  context?: {
    runId?: string;
    conceptId?: string;
    projectId?: string;
    parentConceptId?: string;
    retryOf?: string;
    domain?: string;
    toolSignatures?: string[];
    verifierScore?: number;
    acceptanceTestPassRate?: number;
  };
  defectRootCause?: string;
  fixApplied?: string;
  reusablePattern?: string;
  systemicDefect?: string;
  expectedImpact?: string;
  impact?: { observedScore?: number; predictedScore?: number; successRateDelta?: number };
  algorithmOutcome?: 'improved' | 'neutral' | 'worsened';
  status?: string;
  createdAt?: string;
};

type PostmortemShape = {
  outcome?: ExperienceOutcome;
  whatWorked?: string[];
  whatFailed?: string[];
  reusablePatterns?: string[];
  toolsUsed?: string[];
  toolsForged?: string[];
};

export function createExperienceLibrary(options: ExperienceLibraryOptions): ExperienceLibrary {
  const now = options.now ?? (() => new Date());

  async function query(q: ExperienceQuery): Promise<ExperienceEntry[]> {
    if (
      q.retrievalBackend !== undefined &&
      q.retrievalBackend !== 'fts' &&
      q.retrievalBackend !== 'embedding'
    ) {
      throw new ExperienceLibraryError(`unsupported retrieval backend: ${q.retrievalBackend}`);
    }
    const limit = q.limit ?? 5;
    const candidateLimit = Math.max(limit * 5, limit);
    if (q.retrievalBackend === 'embedding') {
      return queryByEmbedding(q, limit, candidateLimit);
    }
    return queryByFts(q, limit, candidateLimit);
  }

  async function queryForPlanner(q: Omit<ExperienceQuery, 'audience'>): Promise<ExperienceEntry[]> {
    return query({ ...q, audience: 'planner' });
  }

  async function findSimilar(q: { goal: string; projectId: string; limit: number }): Promise<ExperienceEntry[]> {
    return queryForPlanner({ goal: q.goal, projectId: q.projectId, limit: q.limit });
  }

  async function getPatternEffectiveness(patternKey: string): Promise<number> {
    const entries = await query({ projectId: '*', audience: 'audit', limit: 500 });
    const matches = entries.filter((entry) => entry.reusablePatterns.includes(patternKey));
    if (matches.length === 0) return 0;
    const total = matches.reduce((sum, entry) => sum + (entry.patternEffectiveness ?? entry.verifierScore ?? 0), 0);
    return Number((total / matches.length).toFixed(3));
  }

  async function getTopPatterns(domain: string, limit: number): Promise<PatternStat[]> {
    const entries = await query({ projectId: '*', audience: 'audit', domain, limit: 500 });
    const stats = new Map<string, { values: number[]; ids: string[] }>();
    for (const entry of entries) {
      for (const pattern of entry.reusablePatterns) {
        const stat = stats.get(pattern) ?? { values: [], ids: [] };
        stat.values.push(entry.patternEffectiveness ?? entry.verifierScore ?? 0);
        stat.ids.push(entry.id);
        stats.set(pattern, stat);
      }
    }
    return [...stats.entries()]
      .map(([patternKey, stat]) => ({
        patternKey,
        occurrences: stat.ids.length,
        averageEffectiveness: Number((stat.values.reduce((sum, value) => sum + value, 0) / stat.values.length).toFixed(3)),
        evidenceEntryIds: stat.ids,
      }))
      .sort((a, b) => b.occurrences - a.occurrences || b.averageEffectiveness - a.averageEffectiveness)
      .slice(0, limit);
  }

  return { query, queryForPlanner, findSimilar, getPatternEffectiveness, getTopPatterns };

  function ftsOrTagQuery(q: ExperienceQuery, candidateLimit: number): MemoryEntry[] {
    const searched = options.memoryStore.search(q.goal!, { limit: candidateLimit });
    const tagged = options.memoryStore.query({
      kind: ['lesson', 'strategy'],
      tags: queryTags(q),
      limit: candidateLimit,
    });
    return dedupeMemoryEntries([...searched, ...tagged]);
  }

  async function queryByFts(q: ExperienceQuery, limit: number, candidateLimit: number): Promise<ExperienceEntry[]> {
    const candidates = q.goal?.trim()
      ? ftsOrTagQuery(q, candidateLimit)
      : taggedQuery(q, candidateLimit);
    const entries = await projectCandidates(candidates);
    return entries
      .filter((entry) => matchesQuery(entry, q))
      .sort((a, b) => scoreEntry(b, q) - scoreEntry(a, q))
      .slice(0, limit);
  }

  async function queryByEmbedding(q: ExperienceQuery, limit: number, candidateLimit: number): Promise<ExperienceEntry[]> {
    const embedder = options.embeddings?.embedder;
    if (options.embeddings?.enabled !== true || embedder === undefined || !q.goal?.trim()) {
      options.embeddings?.onFallback?.('embedding_disabled_or_unavailable');
      return queryByFts({ ...q, retrievalBackend: 'fts' }, limit, candidateLimit);
    }
    try {
      const candidates = taggedQuery(q, Math.max(candidateLimit * 4, 50));
      const entries = (await projectCandidates(candidates)).filter((entry) => matchesQuery(entry, q));
      if (entries.length === 0) return [];
      const vectors = await Promise.resolve(embedder([q.goal, ...entries.map((entry) => entry.retrievalKey.fts)]));
      const [queryVector, ...entryVectors] = vectors;
      if (queryVector === undefined || entryVectors.length !== entries.length) {
        throw new ExperienceLibraryError('embedding backend returned an invalid vector count');
      }
      const scored = entries
        .map((entry, index) => {
          const vector = entryVectors[index];
          if (vector === undefined) throw new ExperienceLibraryError('embedding backend returned a missing vector');
          return {
            entry,
            score: cosineSimilarity(queryVector, vector),
          };
        })
        .filter(({ score }) => score >= (options.embeddings?.minScore ?? Number.NEGATIVE_INFINITY))
        .sort((a, b) => b.score - a.score || scoreEntry(b.entry, q) - scoreEntry(a.entry, q))
        .map(({ entry }) => entry);
      return scored.slice(0, limit);
    } catch (error) {
      options.embeddings?.onFallback?.('embedding_query_failed', error);
      return queryByFts({ ...q, retrievalBackend: 'fts' }, limit, candidateLimit);
    }
  }

  function taggedQuery(q: ExperienceQuery, candidateLimit: number): MemoryEntry[] {
    return options.memoryStore.query({
      kind: ['lesson', 'strategy'],
      tags: queryTags(q),
      limit: candidateLimit,
    });
  }

  async function projectCandidates(candidates: MemoryEntry[]): Promise<ExperienceEntry[]> {
    const entries = await Promise.all(candidates.map((entry) => projectMemoryEntry(entry, options.artifactStore, now())));
    return entries.filter((entry): entry is ExperienceEntry => entry !== undefined);
  }
}

export class ExperienceLibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExperienceLibraryError';
  }
}

async function projectMemoryEntry(
  entry: MemoryEntry,
  artifactStore: ArtifactStore | undefined,
  indexedAt: Date,
): Promise<ExperienceEntry | undefined> {
  if (entry.kind !== 'lesson' && entry.kind !== 'strategy') return undefined;
  const parsed = parseLessonRecord(entry);
  const projectId = tagValue(entry.tags, 'project:') ?? parsed?.context?.projectId;
  if (!projectId) return undefined;
  const artifactIds = uniqueStrings([
    ...tagValues(entry.tags, 'artifactId:'),
    ...tagValues(entry.tags, 'artifactRef:'),
    ...(parsed?.artifactIds ?? []),
  ]);
  const sourceArtifacts = artifactStore
    ? await resolveIndexedArtifacts(artifactStore, artifactIds)
    : [];
  const postmortem = artifactStore
    ? await readFirstPostmortem(artifactStore, sourceArtifacts)
    : undefined;
  const approvalState = normalizeApprovalState(tagValue(entry.tags, 'approvalState:') ?? parsed?.approvalState);
  const legacy = entry.tags.includes('legacy') || parsed?.legacy === true;
  const quarantined = entry.tags.includes('quarantined') || entry.tags.includes('imported_quarantined') || parsed?.quarantined === true;
  const domain = tagValue(entry.tags, 'domain:') ?? parsed?.context?.domain;
  const toolSignatures = uniqueStrings([
    ...tagValues(entry.tags, 'toolSignature:'),
    ...(parsed?.context?.toolSignatures ?? []),
    ...(postmortem?.toolsUsed ?? []),
    ...(postmortem?.toolsForged ?? []),
  ]);
  const runId = tagValue(entry.tags, 'runId:') ?? parsed?.context?.runId ?? parsed?.sourceRunId ?? 'unknown';
  const conceptId = tagValue(entry.tags, 'conceptId:') ?? parsed?.context?.conceptId;
  const verifierScore = numberFromTag(entry.tags, 'verifierScore:') ?? parsed?.context?.verifierScore;
  const acceptanceTestPassRate = numberFromTag(entry.tags, 'acceptanceTestPassRate:') ?? parsed?.context?.acceptanceTestPassRate;
  const whatWorked = postmortem?.whatWorked?.length
    ? postmortem.whatWorked
    : parsed?.fixApplied ? [parsed.fixApplied] : [entry.text];
  const whatFailed = postmortem?.whatFailed?.length
    ? postmortem.whatFailed
    : uniqueStrings([parsed?.systemicDefect ?? '', parsed?.defectRootCause ?? '']);
  const reusablePatterns = uniqueStrings([
    ...(postmortem?.reusablePatterns ?? []),
    parsed?.reusablePattern ?? '',
    parsed?.fixApplied ?? '',
    parsed === undefined ? entry.text : '',
  ]);
  return {
    id: `experience:${entry.id}`,
    runId,
    ...(conceptId ? { conceptId } : {}),
    projectId,
    schemaVersion: 'pyrfor.experience.v1',
    approvalState,
    legacy,
    quarantined,
    provenance: {
      sourceRunId: tagValue(entry.tags, 'sourceRunId:') ?? parsed?.sourceRunId ?? runId,
      ...(conceptId ? { conceptId } : {}),
      ...(tagValue(entry.tags, 'parentConceptId:') ?? parsed?.context?.parentConceptId
        ? { parentConceptId: tagValue(entry.tags, 'parentConceptId:') ?? parsed?.context?.parentConceptId }
        : {}),
      ...(tagValue(entry.tags, 'retryOf:') ?? parsed?.context?.retryOf
        ? { retryOf: tagValue(entry.tags, 'retryOf:') ?? parsed?.context?.retryOf }
        : {}),
      memoryEntryIds: [entry.id],
      artifactIds,
    },
    retrievalKey: {
      fts: uniqueStrings([entry.text, ...entry.tags]).join('\n'),
      goalKeywords: keywords(entry.text),
      toolSignatures,
    },
    ...(domain ? { domain } : {}),
    outcome: postmortem?.outcome ?? inferOutcome(parsed),
    whatWorked,
    whatFailed,
    reusablePatterns,
    verifierScore,
    acceptanceTestPassRate,
    wasPatternApplied: entry.applied_count > 0,
    patternEffectiveness: parsed?.impact?.observedScore ?? parsed?.impact?.predictedScore,
    createdAt: parsed?.createdAt ?? entry.created_at,
    indexedAt: indexedAt.toISOString(),
    sourceMemory: entry,
    sourceArtifacts,
  };
}

function matchesQuery(entry: ExperienceEntry, q: ExperienceQuery): boolean {
  if (q.audience === 'planner' && !isPlannerVisible(entry)) return false;
  if (q.projectId !== '*' && entry.projectId !== q.projectId) return false;
  if (q.domain && entry.domain !== q.domain) return false;
  if (q.outcome && entry.outcome !== q.outcome) return false;
  if (q.includeFailed !== true && (entry.outcome === 'failed' || entry.outcome === 'blocked')) return false;
  if (q.minVerifierScore !== undefined && (entry.verifierScore ?? 0) < q.minVerifierScore) return false;
  if (q.toolSignatures?.length && !q.toolSignatures.some((signature) => entry.retrievalKey.toolSignatures.includes(signature))) return false;
  return true;
}

function queryTags(q: ExperienceQuery): string[] | undefined {
  const tags: string[] = [];
  if (q.audience === 'planner') tags.push('approved');
  if (q.projectId !== '*') tags.push(`project:${q.projectId}`);
  return tags.length > 0 ? tags : undefined;
}

function isPlannerVisible(entry: ExperienceEntry): boolean {
  return entry.approvalState === 'approved' && !entry.legacy && !entry.quarantined;
}

function scoreEntry(entry: ExperienceEntry, q: ExperienceQuery): number {
  const queryTerms = q.goal ? keywords(q.goal) : [];
  const termHits = queryTerms.filter((term) => entry.retrievalKey.fts.toLowerCase().includes(term)).length;
  const toolBoost = q.toolSignatures?.some((signature) => entry.retrievalKey.toolSignatures.includes(signature)) ? 2 : 0;
  return termHits + toolBoost + (entry.verifierScore ?? 0) + entry.sourceMemory.weight;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new ExperienceLibraryError(`embedding dimension mismatch: expected ${a.length}, got ${b.length}`);
  }
  const normA = vectorNorm(a);
  const normB = vectorNorm(b);
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i]! * b[i]!;
  return dot / (normA * normB);
}

function vectorNorm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

function parseLessonRecord(entry: MemoryEntry): LessonRecordShape | undefined {
  if (entry.kind !== 'lesson') return undefined;
  try {
    const parsed = JSON.parse(entry.text) as LessonRecordShape;
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function inferOutcome(record: LessonRecordShape | undefined): ExperienceOutcome {
  if (record?.algorithmOutcome === 'worsened') return 'failed';
  if (record?.status === 'quarantined' || record?.status === 'rejected') return 'blocked';
  return 'completed';
}

function normalizeApprovalState(value: unknown): ExperienceEntry['approvalState'] {
  if (value === 'approved') return 'approved';
  if (value === 'quarantined') return 'quarantined';
  return 'rejected';
}

async function resolveIndexedArtifacts(artifactStore: ArtifactStore, artifactIds: string[]): Promise<ArtifactRef[]> {
  if (artifactIds.length === 0) return [];
  const refs = await artifactStore.listIndexed();
  const ids = new Set(artifactIds);
  return refs.filter((ref) => ids.has(ref.id));
}

async function readFirstPostmortem(artifactStore: ArtifactStore, refs: ArtifactRef[]): Promise<PostmortemShape | undefined> {
  const postmortemRef = refs.find((ref) => ref.kind === 'postmortem_report');
  if (!postmortemRef) return undefined;
  const parsed = await artifactStore.readJSON<unknown>(postmortemRef);
  if (!isPostmortemShape(parsed)) return undefined;
  return parsed;
}

function isPostmortemShape(value: unknown): value is PostmortemShape {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as { outcome?: unknown };
  return candidate.outcome === undefined ||
    candidate.outcome === 'completed' ||
    candidate.outcome === 'failed' ||
    candidate.outcome === 'cancelled' ||
    candidate.outcome === 'blocked';
}

function dedupeMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const seen = new Set<string>();
  const result: MemoryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    result.push(entry);
  }
  return result;
}

function tagValue(tags: string[], prefix: string): string | undefined {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
}

function tagValues(tags: string[], prefix: string): string[] {
  return tags.filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length));
}

function numberFromTag(tags: string[], prefix: string): number | undefined {
  const value = tagValue(tags, prefix);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function keywords(text: string): string[] {
  return uniqueStrings(text.toLowerCase().split(/[^a-zа-я0-9_:-]+/i).filter((term) => term.length > 2));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

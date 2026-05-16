import type { ArtifactRef, ArtifactStore } from '../artifact-model';
import type { EventLedger } from '../event-ledger';
import type { ConceptRecord } from './engine-loop';

export interface MemoryWriteRecommendation {
  kind: 'episode' | 'strategy' | 'tool_result';
  summary: string;
  evidenceRef: string;
}

export interface RunPostMortem {
  schemaVersion: 'pyrfor.postmortem.v1';
  runId: string;
  conceptId: string;
  projectId?: string;
  parentConceptId?: string;
  retryOf?: string;
  goal: string;
  outcome: 'completed' | 'failed' | 'cancelled' | 'blocked';
  summary: string;
  whatWorked: string[];
  whatFailed: string[];
  toolsUsed: string[];
  toolsForged: string[];
  verifierFindings: string[];
  reusablePatterns: string[];
  memoryWriteRecommendations: MemoryWriteRecommendation[];
  createdAt: string;
  phaseArtifactRefs: string[];
  deliveryBundleRef?: string;
  error?: string;
}

export interface PostMortemDeps {
  artifactStore: ArtifactStore;
  ledger: EventLedger;
  clock?: () => number;
}

export interface PostMortemInput {
  conceptRecord: ConceptRecord;
  outcome: RunPostMortem['outcome'];
  summary: string;
  whatWorked?: string[];
  whatFailed?: string[];
  toolsUsed?: string[];
  toolsForged?: string[];
  verifierFindings?: string[];
  reusablePatterns?: string[];
  memoryWriteRecommendations?: MemoryWriteRecommendation[];
  deliveryBundleRef?: string;
}

export class PostMortemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostMortemError';
  }
}

export function buildPostMortem(input: PostMortemInput, clock: () => number = Date.now): RunPostMortem {
  validatePostMortemInput(input);
  const record = input.conceptRecord;
  return {
    schemaVersion: 'pyrfor.postmortem.v1',
    runId: record.runId,
    conceptId: record.conceptId,
    ...(record.projectId ? { projectId: record.projectId } : {}),
    ...(record.parentConceptId ? { parentConceptId: record.parentConceptId } : {}),
    ...(record.retryOf ? { retryOf: record.retryOf } : {}),
    goal: record.goal,
    outcome: input.outcome,
    summary: input.summary,
    whatWorked: input.whatWorked ?? [],
    whatFailed: input.whatFailed ?? (record.error ? [record.error] : []),
    toolsUsed: input.toolsUsed ?? [],
    toolsForged: input.toolsForged ?? [],
    verifierFindings: input.verifierFindings ?? [],
    reusablePatterns: input.reusablePatterns ?? [],
    memoryWriteRecommendations: input.memoryWriteRecommendations ?? [],
    createdAt: new Date(clock()).toISOString(),
    phaseArtifactRefs: record.artifactRefs.map((ref) => ref.id),
    ...(input.deliveryBundleRef ? { deliveryBundleRef: input.deliveryBundleRef } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

export async function runPostMortem(input: PostMortemInput, deps: PostMortemDeps): Promise<ArtifactRef> {
  validatePostMortemInput(input);
  const record = input.conceptRecord;
  await deps.ledger.append({
    type: 'postmortem.started',
    run_id: record.runId,
    concept_id: record.conceptId,
  });
  const postmortem = buildPostMortem(input, deps.clock);
  const artifactRef = await deps.artifactStore.writeJSON('postmortem_report', postmortem, {
    runId: record.runId,
    meta: {
      conceptId: record.conceptId,
      outcome: input.outcome,
      ...(input.deliveryBundleRef ? { deliveryBundleRef: input.deliveryBundleRef } : {}),
    },
  });
  await deps.ledger.append({
    type: 'postmortem.completed',
    run_id: record.runId,
    concept_id: record.conceptId,
    artifact_id: artifactRef.id,
    status: input.outcome,
  });
  return artifactRef;
}

function validatePostMortemInput(input: PostMortemInput): void {
  if (!input.conceptRecord.conceptId.trim()) throw new PostMortemError('conceptId is required');
  if (!input.conceptRecord.runId.trim()) throw new PostMortemError('runId is required');
  if (!input.summary.trim()) throw new PostMortemError('summary is required');
}

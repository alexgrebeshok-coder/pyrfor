import { randomUUID } from 'node:crypto';
import type { ApprovalDecision, ApprovalRequest } from '../../approval-flow';
import type { MemoryEntry, MemoryStore } from '../../memory-store';
import type { EventLedger } from '../../event-ledger';
import { distillLessons, type HistorianDistillInput } from '../historian';
import type { GovernedAlgorithm } from '../completion-gate-engine';
import type { DoubleLoopRecord, SingleLoopRecord, StrategySetInput } from './types';
import { createStrategyStore, type StrategyStore } from './strategy-store';

export interface HistorianProvenance {
  runId: string;
  conceptId?: string;
  nodeId: string;
  artifactRefs: string[];
  algorithm: GovernedAlgorithm;
}

export interface HistorianApprovalFlow {
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
}

export interface HistorianWriterDeps {
  memoryStore: MemoryStore;
  approvalFlow: HistorianApprovalFlow;
  ledger: EventLedger;
  strategyStore?: StrategyStore;
}

export interface HistorianWriteResult {
  singleLoopEntry?: MemoryEntry;
  doubleLoopEntry?: MemoryEntry;
  conflictRequests: string[];
}

export async function persistLessons(
  input: HistorianDistillInput,
  provenance: HistorianProvenance,
  deps: HistorianWriterDeps,
): Promise<HistorianWriteResult> {
  validateProvenance(provenance);
  const distilled = distillLessons(input);
  const conflictRequests: string[] = [];
  const result: HistorianWriteResult = { conflictRequests };

  if (distilled.singleLoop) {
    result.singleLoopEntry = await writeLessonRecord(distilled.singleLoop, provenance, deps);
  }
  if (distilled.doubleLoop) {
    result.doubleLoopEntry = await writeLessonRecord(distilled.doubleLoop, provenance, deps);
  }
  return result;
}

export async function promoteDoubleLoop(
  entryId: string,
  approvedBy: string,
  deps: Pick<HistorianWriterDeps, 'memoryStore' | 'ledger'>,
): Promise<MemoryEntry | null> {
  if (!approvedBy.trim()) throw new HistorianWriterError('approvedBy is required');
  const entry = deps.memoryStore.get(entryId);
  if (!entry) return null;
  const record = assertDoubleLoopTransition(entry, 'approved');
  const updated = deps.memoryStore.update(entryId, {
    tags: transitionTags(entry.tags, 'approved'),
    text: JSON.stringify({ ...record, status: 'approved' } satisfies DoubleLoopRecord),
  });
  if (updated) {
    await deps.ledger.append({
      type: 'memory.written',
      run_id: tagValue(updated.tags, 'runId:') ?? 'memory',
      concept_id: tagValue(updated.tags, 'conceptId:'),
      node_id: tagValue(updated.tags, 'nodeId:'),
      entry_id: updated.id,
      memory_kind: updated.kind,
      memory_scope: updated.scope,
      artifact_refs: artifactTags(updated.tags),
      reason: `double_loop_promoted_by:${approvedBy}`,
    });
  }
  return updated;
}

export async function quarantineDoubleLoop(
  entryId: string,
  reason: string,
  deps: Pick<HistorianWriterDeps, 'memoryStore' | 'ledger'>,
): Promise<MemoryEntry | null> {
  if (!reason.trim()) throw new HistorianWriterError('reason is required');
  const entry = deps.memoryStore.get(entryId);
  if (!entry) return null;
  const record = assertDoubleLoopTransition(entry, 'quarantined');
  const updated = deps.memoryStore.update(entryId, {
    tags: transitionTags(entry.tags, 'quarantined'),
    text: JSON.stringify({ ...record, status: 'quarantined', rejectionReason: reason } satisfies DoubleLoopRecord),
  });
  if (updated) {
    await deps.ledger.append({
      type: 'memory.written',
      run_id: tagValue(updated.tags, 'runId:') ?? 'memory',
      concept_id: tagValue(updated.tags, 'conceptId:'),
      node_id: tagValue(updated.tags, 'nodeId:'),
      entry_id: updated.id,
      memory_kind: updated.kind,
      memory_scope: updated.scope,
      artifact_refs: artifactTags(updated.tags),
      reason: `double_loop_quarantined:${reason}`,
    });
  }
  return updated;
}

export async function writeStrategyOrConflict(
  input: StrategySetInput,
  provenance: HistorianProvenance,
  deps: HistorianWriterDeps,
): Promise<{ wrote: MemoryEntry } | { conflictId: string }> {
  validateProvenance(provenance);
  const strategyStore = deps.strategyStore ?? createStrategyStore(deps.memoryStore);
  const existing = strategyStore.getApproved(input.key, { projectId: input.projectId, includeGlobal: true });
  if (existing && existing.value !== input.value) {
    const approvalId = randomUUID();
    const decision = await deps.approvalFlow.requestApproval({
      id: approvalId,
      toolName: 'memory.write',
      summary: `Strategy memory conflict on key "${input.key}"`,
      args: {
        key: input.key,
        existing: existing.value,
        proposed: input.value,
      },
      run_id: provenance.runId,
      concept_id: provenance.conceptId,
      engine_phase: 'memory_persist',
      reason_codes: ['conflict'],
    });
    await deps.ledger.append({
      type: 'memory.conflict',
      run_id: provenance.runId,
      concept_id: provenance.conceptId,
      node_id: provenance.nodeId,
      conflict_key: input.key,
      existing_entry_id: existing.memoryEntryId,
      approval_id: approvalId,
      decision,
      artifact_refs: provenance.artifactRefs,
    });
    if (decision !== 'approve') return { conflictId: approvalId };
  }

  const strategy = strategyStore.setApproved(input);
  const entry = deps.memoryStore.get(strategy.memoryEntryId);
  if (!entry) throw new HistorianWriterError(`strategy entry disappeared: ${strategy.memoryEntryId}`);
  const tagged = deps.memoryStore.update(entry.id, {
    tags: mergeTags(entry.tags, provenanceTags(provenance)),
  });
  if (!tagged) throw new HistorianWriterError(`strategy entry disappeared during provenance tagging: ${entry.id}`);
  await deps.ledger.append({
    type: 'memory.written',
    run_id: provenance.runId,
    concept_id: provenance.conceptId,
    node_id: provenance.nodeId,
    entry_id: tagged.id,
    memory_kind: tagged.kind,
    memory_scope: tagged.scope,
    artifact_refs: provenance.artifactRefs,
    reason: 'strategy_memory_write',
  });
  return { wrote: tagged };
}

export class HistorianWriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistorianWriterError';
  }
}

async function writeLessonRecord(
  record: SingleLoopRecord | DoubleLoopRecord,
  provenance: HistorianProvenance,
  deps: HistorianWriterDeps,
): Promise<MemoryEntry> {
  const entry = deps.memoryStore.add({
    kind: 'lesson',
    text: JSON.stringify(record),
    source: `historian:${provenance.runId}`,
    scope: 'universal',
    tags: lessonTags(record, provenance),
    weight: record.confidence === 'high' ? 0.9 : record.confidence === 'medium' ? 0.6 : 0.3,
  });
  await deps.ledger.append({
    type: 'memory.written',
    run_id: provenance.runId,
    concept_id: provenance.conceptId,
    node_id: provenance.nodeId,
    entry_id: entry.id,
    memory_kind: entry.kind,
    memory_scope: entry.scope,
    artifact_refs: provenance.artifactRefs,
    reason: `${record.kind}_lesson_write`,
  });
  return entry;
}

function validateProvenance(provenance: HistorianProvenance): void {
  if (!provenance.runId.trim()) throw new HistorianWriterError('runId is required');
  if (!provenance.nodeId.trim()) throw new HistorianWriterError('nodeId is required');
  if (provenance.artifactRefs.length === 0) throw new HistorianWriterError('at least one artifactRef is required');
}

function lessonTags(record: SingleLoopRecord | DoubleLoopRecord, provenance: HistorianProvenance): string[] {
  return [
    record.kind,
    `confidence:${record.confidence}`,
    record.provenance,
    ...provenanceTags(provenance),
    record.context.phase,
    record.context.nodeKind,
    ...(record.kind === 'single_loop' && record.eligibleForStrategyDistillation ? ['approved'] : []),
    ...(record.kind === 'double_loop' ? [record.status] : []),
    ...(record.kind === 'double_loop' ? [record.targetScope.ruleKey] : []),
  ];
}

function provenanceTags(provenance: HistorianProvenance): string[] {
  return [
    provenance.algorithm,
    `runId:${provenance.runId}`,
    `nodeId:${provenance.nodeId}`,
    ...(provenance.conceptId ? [`conceptId:${provenance.conceptId}`] : []),
    ...provenance.artifactRefs.map((ref) => `artifactRef:${ref}`),
  ];
}

function transitionTags(tags: string[], status: 'approved' | 'quarantined'): string[] {
  const statusTags = new Set(['candidate', 'pending_approval', 'approved', 'rejected', 'quarantined', 'superseded']);
  return [...tags.filter((tag) => !statusTags.has(tag)), status];
}

function assertDoubleLoopTransition(entry: MemoryEntry, nextStatus: 'approved' | 'quarantined'): DoubleLoopRecord {
  if (entry.kind !== 'lesson' || !entry.tags.includes('double_loop')) {
    throw new HistorianWriterError(`cannot ${nextStatus} non-double-loop memory entry: ${entry.id}`);
  }
  if (!entry.tags.includes('candidate') && !entry.tags.includes('pending_approval')) {
    throw new HistorianWriterError(`cannot ${nextStatus} double-loop entry without candidate/pending_approval state: ${entry.id}`);
  }
  const record = parseDoubleLoopRecord(entry);
  const tagStatus = entry.tags.includes('candidate') ? 'candidate' : 'pending_approval';
  if (record.status !== tagStatus) {
    throw new HistorianWriterError(`double-loop record status does not match tags for entry: ${entry.id}`);
  }
  return record;
}

function parseDoubleLoopRecord(entry: MemoryEntry): DoubleLoopRecord {
  const parsed = JSON.parse(entry.text) as Partial<DoubleLoopRecord>;
  if (
    parsed.kind !== 'double_loop' ||
    typeof parsed.id !== 'string' ||
    !isLessonProvenance(parsed.provenance) ||
    !isConfidence(parsed.confidence) ||
    typeof parsed.context !== 'object' ||
    parsed.context === null ||
    typeof parsed.sourceLessonsArtifactRef !== 'string' ||
    !Array.isArray(parsed.evidence) ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.author !== 'string' ||
    !isProposedChangeType(parsed.proposedChangeType) ||
    typeof parsed.targetScope !== 'object' ||
    parsed.targetScope === null ||
    typeof parsed.targetScope.ruleKey !== 'string' ||
    typeof parsed.targetScope.currentRule !== 'string' ||
    typeof parsed.targetScope.proposedRule !== 'string' ||
    typeof parsed.systemicDefect !== 'string' ||
    typeof parsed.expectedImpact !== 'string' ||
    typeof parsed.impact !== 'object' ||
    parsed.impact === null ||
    !isImpactVector(parsed.impact) ||
    !Array.isArray(parsed.risks) ||
    typeof parsed.rollbackPlan !== 'string' ||
    typeof parsed.status !== 'string' ||
    typeof parsed.similarityKey !== 'string' ||
    typeof parsed.requiresNovelEvidenceAfterRejection !== 'boolean' ||
    !isLessonContext(parsed.context) ||
    !parsed.evidence.every(isLessonEvidenceRef) ||
    !parsed.risks.every((risk) => typeof risk === 'string') ||
    !isDoubleLoopStatus(parsed.status)
  ) {
    throw new HistorianWriterError(`memory entry does not contain a double-loop record: ${entry.id}`);
  }
  return parsed as DoubleLoopRecord;
}

function isLessonContext(value: unknown): boolean {
  const context = value as DoubleLoopRecord['context'];
  return typeof context.runId === 'string' &&
    typeof context.nodeId === 'string' &&
    typeof context.nodeHash === 'string' &&
    typeof context.algorithm === 'string' &&
    typeof context.phase === 'string' &&
    typeof context.nodeKind === 'string';
}

function isLessonEvidenceRef(value: unknown): boolean {
  const evidence = value as DoubleLoopRecord['evidence'][number];
  return typeof evidence === 'object' &&
    evidence !== null &&
    typeof evidence.artifactRef === 'string' &&
    typeof evidence.verifierConfirmed === 'boolean';
}

function isDoubleLoopStatus(value: string): value is DoubleLoopRecord['status'] {
  return value === 'candidate' ||
    value === 'pending_approval' ||
    value === 'approved' ||
    value === 'rejected' ||
    value === 'quarantined' ||
    value === 'superseded';
}

function isLessonProvenance(value: unknown): value is DoubleLoopRecord['provenance'] {
  return value === 'native' || value === 'legacy' || value === 'imported';
}

function isConfidence(value: unknown): value is DoubleLoopRecord['confidence'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isProposedChangeType(value: unknown): value is DoubleLoopRecord['proposedChangeType'] {
  return value === 'algorithm' ||
    value === 'heuristic' ||
    value === 'policy' ||
    value === 'budget' ||
    value === 'verifier_rules';
}

function isImpactVector(value: DoubleLoopRecord['impact']): boolean {
  const numericKeys: Array<keyof DoubleLoopRecord['impact']> = [
    'predictedScore',
    'observedScore',
    'costDeltaUsd',
    'latencyDeltaMs',
    'successRateDelta',
    'verifierPassRateDelta',
  ];
  const hasNumericSignal = numericKeys.some((key) => value[key] !== undefined && typeof value[key] === 'number' && Number.isFinite(value[key]));
  const hasRiskSignal = value.riskDelta === 'lower' || value.riskDelta === 'same' || value.riskDelta === 'higher';
  return hasNumericSignal || hasRiskSignal;
}

function mergeTags(tags: string[], extra: string[]): string[] {
  return [...new Set([...tags, ...extra])];
}

function tagValue(tags: string[], prefix: string): string | undefined {
  return tags.find((tag) => tag.startsWith(prefix))?.slice(prefix.length);
}

function artifactTags(tags: string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith('artifactRef:'))
    .map((tag) => tag.slice('artifactRef:'.length));
}

import { createHash, randomUUID } from 'node:crypto';
import type { DecisionRecord } from './decision-record-auditor';
import type {
  DoubleLoopRecord,
  LessonContext,
  LessonEvidenceRef,
  LessonRootCause,
  SingleLoopRecord,
} from './memory/types';

export interface LessonsLearnedArtifact {
  scope: 'tool' | 'run' | 'policy' | 'strategy';
  whatWorked: string[];
  whatFailed: string[];
  rootCause: LessonRootCause;
  strategyDelta?: string;
  toolDelta?: string;
  policyProposal?: string;
  evidenceRefs: string[];
  confidence: 'low' | 'medium' | 'high';
  algorithmOutcome?: 'improved' | 'neutral' | 'worsened' | 'success' | 'partial' | 'failed_to_meet_criteria';
}

export interface HistorianDistillInput {
  lessons: LessonsLearnedArtifact;
  context: LessonContext;
  sourceLessonsArtifactRef: string;
  originDecisionRecord?: DecisionRecord;
  supportingDecisionRecords?: DecisionRecord[];
}

export interface HistorianDistillResult {
  singleLoop?: SingleLoopRecord;
  doubleLoop?: DoubleLoopRecord;
}

export function distillLessons(input: HistorianDistillInput): HistorianDistillResult {
  const evidence = input.lessons.evidenceRefs.map<LessonEvidenceRef>((artifactRef) => ({
    artifactRef,
    verifierConfirmed: input.lessons.confidence !== 'low',
  }));
  const singleLoop = makeSingleLoop(input, evidence);
  const doubleLoop = shouldCreateDoubleLoop(input.lessons)
    ? makeDoubleLoop(input, evidence)
    : undefined;
  return { singleLoop, doubleLoop };
}

function makeSingleLoop(input: HistorianDistillInput, evidence: LessonEvidenceRef[]): SingleLoopRecord {
  return {
    id: randomUUID(),
    kind: 'single_loop',
    provenance: input.context.nodeKind === 'legacy' ? 'legacy' : 'native',
    confidence: input.lessons.confidence,
    context: input.context,
    sourceLessonsArtifactRef: input.sourceLessonsArtifactRef,
    evidence,
    createdAt: new Date().toISOString(),
    author: 'historian',
    originDecisionRecordRef: input.originDecisionRecord?.id,
    supportingDecisionRecordRefs: input.supportingDecisionRecords?.map((record) => record.id),
    defectRootCause: input.lessons.rootCause,
    defectSignature: hashText([...input.lessons.whatFailed, input.lessons.rootCause].join('\n')),
    fixApplied: input.lessons.whatWorked.join('\n') || 'no reusable fix recorded',
    fixType: classifyFixType(input.lessons),
    algorithmOutcome: normalizeAlgorithmOutcome(input.lessons.algorithmOutcome),
    localOnly: input.lessons.confidence !== 'high',
    eligibleForStrategyDistillation: input.lessons.confidence === 'high' && input.context.nodeKind !== 'legacy',
  };
}

function makeDoubleLoop(input: HistorianDistillInput, evidence: LessonEvidenceRef[]): DoubleLoopRecord {
  const proposedRule = input.lessons.policyProposal ?? input.lessons.strategyDelta ?? input.lessons.toolDelta ?? 'unspecified rule delta';
  return {
    id: randomUUID(),
    kind: 'double_loop',
    provenance: input.context.nodeKind === 'legacy' ? 'legacy' : 'native',
    confidence: input.lessons.confidence,
    context: input.context,
    sourceLessonsArtifactRef: input.sourceLessonsArtifactRef,
    evidence,
    createdAt: new Date().toISOString(),
    author: 'historian',
    originDecisionRecordRef: input.originDecisionRecord?.id,
    supportingDecisionRecordRefs: input.supportingDecisionRecords?.map((record) => record.id),
    proposedChangeType: classifyProposedChangeType(input.lessons),
    targetScope: {
      algorithm: input.context.algorithm,
      phase: input.context.phase,
      nodeKind: input.context.nodeKind,
      ruleKey: `${input.context.algorithm}.${input.context.phase}.${input.lessons.rootCause}`,
      currentRule: 'current governance rule',
      proposedRule,
    },
    systemicDefect: input.lessons.whatFailed.join('\n') || input.lessons.rootCause,
    expectedImpact: input.lessons.strategyDelta ?? input.lessons.policyProposal ?? 'reduce repeated failure class',
    impact: {
      predictedScore: input.lessons.confidence === 'high' ? 0.8 : 0.5,
    },
    risks: ['requires verifier confirmation before activation'],
    rollbackPlan: 'revert governance_adjustment_proposal and restore previous rule snapshot',
    status: input.context.nodeKind === 'legacy' ? 'quarantined' : 'candidate',
    similarityKey: hashText(`${input.context.algorithm}:${input.context.phase}:${proposedRule}`),
    requiresNovelEvidenceAfterRejection: true,
  };
}

function shouldCreateDoubleLoop(lessons: LessonsLearnedArtifact): boolean {
  return Boolean(lessons.policyProposal || lessons.strategyDelta || lessons.scope === 'policy' || lessons.scope === 'strategy');
}

function classifyProposedChangeType(lessons: LessonsLearnedArtifact): DoubleLoopRecord['proposedChangeType'] {
  if (lessons.scope === 'policy' || lessons.policyProposal) return 'policy';
  if (lessons.rootCause === 'budget_or_tier') return 'budget';
  if (lessons.rootCause === 'verifier_disagreement') return 'verifier_rules';
  if (lessons.strategyDelta) return 'heuristic';
  return 'algorithm';
}

function classifyFixType(lessons: LessonsLearnedArtifact): SingleLoopRecord['fixType'] {
  if (lessons.toolDelta) return 'tool_swap';
  if (lessons.rootCause === 'test_gap') return 'test_rewrite';
  if (lessons.rootCause === 'spec_gap') return 'spec_clarification';
  if (lessons.rootCause === 'tool_gap') return 'tool_retry';
  return 'replan';
}

function normalizeAlgorithmOutcome(value: LessonsLearnedArtifact['algorithmOutcome']): SingleLoopRecord['algorithmOutcome'] {
  if (value === 'improved' || value === 'neutral' || value === 'worsened') return value;
  if (value === 'success') return 'improved';
  if (value === 'failed_to_meet_criteria') return 'worsened';
  return 'neutral';
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

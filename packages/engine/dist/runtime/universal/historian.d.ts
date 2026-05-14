import type { DecisionRecord } from './decision-record-auditor';
import type { DoubleLoopRecord, LessonContext, LessonRootCause, SingleLoopRecord } from './memory/types';
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
export declare function distillLessons(input: HistorianDistillInput): HistorianDistillResult;
//# sourceMappingURL=historian.d.ts.map
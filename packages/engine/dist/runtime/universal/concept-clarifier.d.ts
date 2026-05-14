export type ClarificationStopReason = 'resolved' | 'max_rounds' | 'non_interactive' | 'trivially_clear';
export type ClarificationDimension = 'scope' | 'ambiguity' | 'constraint' | 'priority';
export interface ClarificationQuestion {
    id: string;
    dimension: ClarificationDimension;
    prompt: string;
    defaultAnswer: string;
    required: boolean;
}
export interface ClarificationRound {
    round: number;
    questions: ClarificationQuestion[];
    answers: Record<string, string>;
    skipped: boolean;
}
export interface ClarificationResult {
    originalConcept: string;
    refinedConcept: string;
    rounds: ClarificationRound[];
    stoppedAt: ClarificationStopReason;
    totalRounds: number;
}
export interface ClarificationNeededResult {
    needsClarification: boolean;
    questions: ClarificationQuestion[];
    clarity: number;
}
export interface ClarificationAdapter {
    ask(questions: ClarificationQuestion[]): Promise<Record<string, string> | null>;
}
export interface ConceptClarifierDeps {
    adapter: ClarificationAdapter;
    maxRounds?: number;
    nonInteractive?: boolean;
}
export declare function scoreClarify(concept: string): ClarificationNeededResult;
export declare class ConceptClarifier {
    private readonly adapter;
    private readonly maxRounds;
    private readonly nonInteractive;
    constructor(deps: ConceptClarifierDeps);
    clarify(concept: string): Promise<ClarificationResult>;
}
//# sourceMappingURL=concept-clarifier.d.ts.map
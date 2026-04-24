import type { AIActionType, AIRunInput } from './types';
export interface AIRunEvalFixture {
    id: string;
    label: string;
    input: AIRunInput;
    expectedProposalType?: AIActionType;
    minProposalItems?: number;
    expectedFailure?: "missing_project_context";
}
export interface AIRunEvalResult {
    fixtureId: string;
    label: string;
    status: "passed" | "failed";
    issues: string[];
    proposalType: AIActionType | null;
    proposalItemCount: number;
    traceWorkflow: string | null;
}
export interface AIRunEvalSuiteResult {
    summary: {
        total: number;
        passed: number;
        failed: number;
    };
    results: AIRunEvalResult[];
}
export declare function evaluateAIRunFixture(fixture: AIRunEvalFixture): AIRunEvalResult;
export declare function runAIRunEvalSuite(fixtures: AIRunEvalFixture[]): AIRunEvalSuiteResult;
//# sourceMappingURL=evals.d.ts.map
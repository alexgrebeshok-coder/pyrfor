import { type NeverGrandfatheredGate } from './legacy-node-auditor';
import type { DecisionVector } from './types';
export type TierDecision = 'autonomous' | 'notify' | 'approve' | 'block';
export interface TierDeciderInput {
    decisionVector: DecisionVector;
    gate?: string;
}
export interface TierDeciderResult {
    decision: TierDecision;
    reasonCodes: string[];
    requiresApproval: boolean;
    abortRequired: boolean;
}
export declare function decideTier(input: TierDeciderInput): TierDeciderResult;
export declare function isNeverGrandfatheredGate(value: string | undefined): value is NeverGrandfatheredGate;
//# sourceMappingURL=tier-decider.d.ts.map
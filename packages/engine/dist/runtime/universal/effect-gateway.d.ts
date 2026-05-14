import type { TierDecision } from './tier-decider';
import type { ToolCapabilityManifest } from './tool-registry';
import type { DecisionVector } from './types';
export type EffectOperation = ToolCapabilityManifest['declaredEffects'][number];
export interface EffectRequest {
    runId: string;
    toolName: string;
    effect: EffectOperation;
    targetPath?: string;
    url?: string;
    estimatedCostUsd?: number;
    estimatedWallMs?: number;
    estimatedEgressBytes?: number;
    capability: ToolCapabilityManifest;
    decisionVector?: DecisionVector;
    decisionVectorRef?: string;
    tierDecision?: TierDecision;
    tierReasonCodes?: string[];
    requiresApproval?: boolean;
}
export interface EffectDecision {
    allowed: boolean;
    reason: string;
    effect: EffectOperation;
    toolName: string;
    decisionVectorRef?: string;
    tierDecision?: TierDecision;
    reasonCodes?: string[];
    requiresApproval?: boolean;
}
export interface AllowedEffect {
    request: EffectRequest;
    decision: EffectDecision;
    artifactId?: string;
}
export interface EffectGateway {
    authorize(request: EffectRequest): EffectDecision;
    journal(entry: AllowedEffect): string;
    entries(): string[];
}
export declare function createEffectGateway(): EffectGateway;
//# sourceMappingURL=effect-gateway.d.ts.map
export type ModelFamily = 'openai' | 'anthropic' | 'executable';
export type VerifierKind = 'llm' | 'executable';
export type VerifierVerdict = 'pass' | 'rework' | 'block';
export declare const MODEL_FAMILY_MAP: Readonly<{
    'gpt-5.4': "openai";
    'gpt-5.2': "openai";
    'gpt-5.4-mini': "openai";
    'gpt-4.1': "openai";
    'gpt-5.3-codex': "openai";
    'gpt-5.2-codex': "openai";
    'claude-sonnet-4.6': "anthropic";
    'claude-haiku-4.5': "anthropic";
}>;
export interface VerifierSpec {
    id: string;
    kind: VerifierKind;
    family: ModelFamily;
    modelId?: string;
}
export interface EnsembleConfig {
    verifiers: VerifierSpec[];
    coderFamily: ModelFamily;
    requireExecutable?: boolean;
}
export interface CriticInput {
    artifactRef: string;
    specSummary?: string;
    contextHint?: string;
}
export interface VerifierResult {
    verifierId: string;
    family: ModelFamily;
    kind: VerifierKind;
    verdict: VerifierVerdict;
    rationale: string;
    durationMs: number;
}
export interface CriticReport {
    aggregateVerdict: VerifierVerdict;
    results: VerifierResult[];
    familyDiversityMet: boolean;
    executableVerifierPresent: boolean;
}
export type VerifierRunner = (spec: VerifierSpec, input: CriticInput) => Promise<{
    verdict: VerifierVerdict;
    rationale: string;
}>;
export declare class EnsembleDiversityError extends Error {
    constructor(message: string);
}
export declare function resolveModelFamily(modelId: string): ModelFamily;
export declare function llmVerifier(id: string, modelId: string): VerifierSpec;
export declare function executableVerifier(id: string): VerifierSpec;
export declare function validateEnsembleDiversity(config: EnsembleConfig): void;
export declare function aggregateQuorum(results: VerifierResult[]): VerifierVerdict;
export declare function runCriticEnsemble(config: EnsembleConfig, input: CriticInput, runners: ReadonlyMap<string, VerifierRunner>): Promise<CriticReport>;
//# sourceMappingURL=critic.d.ts.map
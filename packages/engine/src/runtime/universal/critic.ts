export type ModelFamily = 'openai' | 'anthropic' | 'executable';

export type VerifierKind = 'llm' | 'executable';

export type VerifierVerdict = 'pass' | 'rework' | 'block';

export const MODEL_FAMILY_MAP = Object.freeze({
  'gpt-5.4': 'openai',
  'gpt-5.2': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-4.1': 'openai',
  'gpt-5.3-codex': 'openai',
  'gpt-5.2-codex': 'openai',
  'claude-sonnet-4.6': 'anthropic',
  'claude-haiku-4.5': 'anthropic',
} satisfies Record<string, ModelFamily>);

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

export type VerifierRunner = (
  spec: VerifierSpec,
  input: CriticInput,
) => Promise<{ verdict: VerifierVerdict; rationale: string }>;

export class EnsembleDiversityError extends Error {
  constructor(message: string) {
    super(`critic: ensemble diversity violation - ${message}`);
    this.name = 'EnsembleDiversityError';
  }
}

export function resolveModelFamily(modelId: string): ModelFamily {
  const family = MODEL_FAMILY_MAP[modelId as keyof typeof MODEL_FAMILY_MAP];
  if (family === undefined) {
    throw new Error(`critic: unknown or disallowed model "${modelId}"`);
  }
  return family;
}

export function llmVerifier(id: string, modelId: string): VerifierSpec {
  return { id, kind: 'llm', modelId, family: resolveModelFamily(modelId) };
}

export function executableVerifier(id: string): VerifierSpec {
  return { id, kind: 'executable', family: 'executable' };
}

export function validateEnsembleDiversity(config: EnsembleConfig): void {
  const requireExecutable = config.requireExecutable ?? true;

  if (config.verifiers.length < 2) {
    throw new EnsembleDiversityError(`ensemble must have at least 2 verifiers, got ${config.verifiers.length}`);
  }

  const hasIndependentFamily = config.verifiers.some((verifier) => verifier.family !== config.coderFamily);
  if (!hasIndependentFamily) {
    throw new EnsembleDiversityError(`all verifiers share coder family "${config.coderFamily}"`);
  }

  if (requireExecutable && !config.verifiers.some((verifier) => verifier.kind === 'executable')) {
    throw new EnsembleDiversityError('no executable verifier present');
  }
}

export function aggregateQuorum(results: VerifierResult[]): VerifierVerdict {
  if (results.some((result) => result.verdict === 'block')) return 'block';
  if (results.some((result) => result.verdict === 'rework')) return 'rework';
  return 'pass';
}

export async function runCriticEnsemble(
  config: EnsembleConfig,
  input: CriticInput,
  runners: ReadonlyMap<string, VerifierRunner>,
): Promise<CriticReport> {
  validateEnsembleDiversity(config);

  const results = await Promise.all(config.verifiers.map(async (spec): Promise<VerifierResult> => {
    const runner = runners.get(spec.id);
    if (runner === undefined) {
      throw new Error(`critic: no runner registered for verifier "${spec.id}"`);
    }
    const startedAt = Date.now();
    const result = await runner(spec, input);
    return {
      verifierId: spec.id,
      family: spec.family,
      kind: spec.kind,
      verdict: result.verdict,
      rationale: result.rationale,
      durationMs: Date.now() - startedAt,
    };
  }));

  return {
    aggregateVerdict: aggregateQuorum(results),
    results,
    familyDiversityMet: true,
    executableVerifierPresent: config.verifiers.some((verifier) => verifier.kind === 'executable'),
  };
}

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export const MODEL_FAMILY_MAP = Object.freeze({
    'gpt-5.4': 'openai',
    'gpt-5.2': 'openai',
    'gpt-5.4-mini': 'openai',
    'gpt-4.1': 'openai',
    'gpt-5.3-codex': 'openai',
    'gpt-5.2-codex': 'openai',
    'claude-sonnet-4.6': 'anthropic',
    'claude-haiku-4.5': 'anthropic',
});
export class EnsembleDiversityError extends Error {
    constructor(message) {
        super(`critic: ensemble diversity violation - ${message}`);
        this.name = 'EnsembleDiversityError';
    }
}
export function resolveModelFamily(modelId) {
    const family = MODEL_FAMILY_MAP[modelId];
    if (family === undefined) {
        throw new Error(`critic: unknown or disallowed model "${modelId}"`);
    }
    return family;
}
export function llmVerifier(id, modelId) {
    return { id, kind: 'llm', modelId, family: resolveModelFamily(modelId) };
}
export function executableVerifier(id) {
    return { id, kind: 'executable', family: 'executable' };
}
export function validateEnsembleDiversity(config) {
    var _a;
    const requireExecutable = (_a = config.requireExecutable) !== null && _a !== void 0 ? _a : true;
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
export function aggregateQuorum(results) {
    if (results.some((result) => result.verdict === 'block'))
        return 'block';
    if (results.some((result) => result.verdict === 'rework'))
        return 'rework';
    return 'pass';
}
export function runCriticEnsemble(config, input, runners) {
    return __awaiter(this, void 0, void 0, function* () {
        validateEnsembleDiversity(config);
        const results = yield Promise.all(config.verifiers.map((spec) => __awaiter(this, void 0, void 0, function* () {
            const runner = runners.get(spec.id);
            if (runner === undefined) {
                throw new Error(`critic: no runner registered for verifier "${spec.id}"`);
            }
            const startedAt = Date.now();
            const result = yield runner(spec, input);
            return {
                verifierId: spec.id,
                family: spec.family,
                kind: spec.kind,
                verdict: result.verdict,
                rationale: result.rationale,
                durationMs: Date.now() - startedAt,
            };
        })));
        return {
            aggregateVerdict: aggregateQuorum(results),
            results,
            familyDiversityMet: true,
            executableVerifierPresent: config.verifiers.some((verifier) => verifier.kind === 'executable'),
        };
    });
}

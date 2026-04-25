import type { StepValidator } from '../step-validator.js';
export interface TestGateOptions {
    command?: string;
    failBlockThreshold?: number;
    failCorrectThreshold?: number;
    timeoutMs?: number;
}
export declare function createTestGateValidator(opts?: TestGateOptions): StepValidator;
//# sourceMappingURL=test-gate.d.ts.map
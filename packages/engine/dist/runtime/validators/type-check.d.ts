import type { StepValidator } from '../step-validator.js';
export interface TypeCheckOptions {
    command?: string;
    timeoutMs?: number;
    appliesToKinds?: string[];
}
export declare function createTypeCheckValidator(opts?: TypeCheckOptions): StepValidator;
//# sourceMappingURL=type-check.d.ts.map
import type { StepValidator } from '../step-validator.js';
export interface DiffSizeOptions {
    warnLines?: number;
    blockLines?: number;
}
export declare function createDiffSizeValidator(opts?: DiffSizeOptions): StepValidator;
//# sourceMappingURL=diff-size.d.ts.map
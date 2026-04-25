import type { StepValidator } from '../step-validator.js';
export interface SecurityScanOptions {
    extraPatterns?: RegExp[];
}
export declare function createSecurityScanValidator(opts?: SecurityScanOptions): StepValidator;
//# sourceMappingURL=security-scan.d.ts.map
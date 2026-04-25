/**
 * Bearer-token validator with rotation support.
 *
 * Supports:
 * - Legacy single `bearerToken` (treated as never-expiring, label="legacy")
 * - Multiple tokens in `bearerTokens` with optional ISO expiry and labels
 * - Constant-time comparison via `crypto.timingSafeEqual` to prevent timing leaks
 * - Injected `now` clock for deterministic expiry tests
 */
export interface TokenEntry {
    value: string;
    expiresAt?: string;
    label?: string;
}
export interface TokenValidatorConfig {
    bearerToken?: string;
    bearerTokens?: TokenEntry[];
}
export interface ValidateResult {
    ok: boolean;
    reason?: 'unknown' | 'expired';
    label?: string;
}
export interface TokenValidator {
    validate(token: string): ValidateResult;
}
export declare function createTokenValidator(config: TokenValidatorConfig, opts?: {
    now?: () => Date;
}): TokenValidator;
//# sourceMappingURL=auth-tokens.d.ts.map
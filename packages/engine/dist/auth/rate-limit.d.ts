/**
 * Check if authentication request should be rate limited
 *
 * @param key - Unique identifier (e.g., "auth:email@example.com:192.168.1.1")
 * @returns Object with allowed status and remaining attempts
 */
export declare function checkAuthRateLimit(key: string): {
    allowed: boolean;
    remaining: number;
    resetAt?: number;
};
/**
 * Reset rate limit for a key (e.g., after successful login)
 */
export declare function resetAuthRateLimit(key: string): void;
/**
 * Get remaining time until rate limit resets
 */
export declare function getRateLimitResetTime(key: string): number | null;
//# sourceMappingURL=rate-limit.d.ts.map
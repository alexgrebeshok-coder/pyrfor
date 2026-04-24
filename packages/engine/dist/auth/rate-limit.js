import { LRUCache } from "lru-cache";
/**
 * Authentication rate limiter using LRU cache
 *
 * Purpose: Prevent brute-force and credential stuffing attacks
 * Limits: 5 attempts per 15 minutes per email/IP combination
 */
const authRateLimiter = new LRUCache({
    max: 10000, // Track up to 10,000 unique keys
    ttl: 900000, // 15 minutes TTL
});
const WINDOW_MS = 900000; // 15 minute window
const MAX_ATTEMPTS = 5; // Max login attempts per window
/**
 * Check if authentication request should be rate limited
 *
 * @param key - Unique identifier (e.g., "auth:email@example.com:192.168.1.1")
 * @returns Object with allowed status and remaining attempts
 */
export function checkAuthRateLimit(key) {
    const now = Date.now();
    const entry = authRateLimiter.get(key) || { count: 0, resetAt: now + WINDOW_MS };
    // Reset window if expired
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + WINDOW_MS;
    }
    if (entry.count >= MAX_ATTEMPTS) {
        return {
            allowed: false,
            remaining: 0,
            resetAt: entry.resetAt
        };
    }
    entry.count++;
    authRateLimiter.set(key, entry);
    return {
        allowed: true,
        remaining: MAX_ATTEMPTS - entry.count,
        resetAt: entry.resetAt
    };
}
/**
 * Reset rate limit for a key (e.g., after successful login)
 */
export function resetAuthRateLimit(key) {
    authRateLimiter.delete(key);
}
/**
 * Get remaining time until rate limit resets
 */
export function getRateLimitResetTime(key) {
    const entry = authRateLimiter.get(key);
    if (!entry)
        return null;
    const now = Date.now();
    if (now > entry.resetAt)
        return null;
    return Math.ceil((entry.resetAt - now) / 1000); // Return seconds
}

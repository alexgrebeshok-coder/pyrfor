import { LRUCache } from "lru-cache";
/**
 * Simple in-memory rate limiter using LRU cache
 *
 * Limits: 100 requests per minute per IP
 */
const rateLimiter = new LRUCache({
    max: 1000, // Track up to 100 IPs
    ttl: 60000, // 1 minute TTL
});
const WINDOW_MS = 60000; // 1 minute window
const MAX_REQUESTS = 100; // Max requests per window
/**
 * Check if request should be rate limited
 */
export function checkRateLimit(ip) {
    const now = Date.now();
    const entry = rateLimiter.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
    // Reset window if expired
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + WINDOW_MS;
    }
    if (entry.count >= MAX_REQUESTS) {
        return { allowed: false, remaining: 0 };
    }
    entry.count++;
    rateLimiter.set(ip, entry);
    return { allowed: true, remaining: MAX_REQUESTS - entry.count };
}

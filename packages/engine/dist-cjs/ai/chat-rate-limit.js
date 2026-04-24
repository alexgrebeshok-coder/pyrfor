"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAIChatRateLimit = checkAIChatRateLimit;
const lru_cache_1 = require("lru-cache");
const WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 20;
const chatRateLimiter = new lru_cache_1.LRUCache({
    max: 5000,
    ttl: WINDOW_MS,
});
function checkAIChatRateLimit(userId) {
    const now = Date.now();
    const entry = chatRateLimiter.get(userId) ?? {
        count: 0,
        resetAt: now + WINDOW_MS,
    };
    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + WINDOW_MS;
    }
    if (entry.count >= MAX_REQUESTS_PER_WINDOW) {
        return {
            allowed: false,
            limit: MAX_REQUESTS_PER_WINDOW,
            remaining: 0,
            resetAt: entry.resetAt,
        };
    }
    entry.count += 1;
    chatRateLimiter.set(userId, entry);
    return {
        allowed: true,
        limit: MAX_REQUESTS_PER_WINDOW,
        remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - entry.count),
        resetAt: entry.resetAt,
    };
}

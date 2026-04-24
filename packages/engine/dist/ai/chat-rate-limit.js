import { LRUCache } from "lru-cache";
const WINDOW_MS = 60000;
const MAX_REQUESTS_PER_WINDOW = 20;
const chatRateLimiter = new LRUCache({
    max: 5000,
    ttl: WINDOW_MS,
});
export function checkAIChatRateLimit(userId) {
    var _a;
    const now = Date.now();
    const entry = (_a = chatRateLimiter.get(userId)) !== null && _a !== void 0 ? _a : {
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

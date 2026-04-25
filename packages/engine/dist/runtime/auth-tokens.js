/**
 * Bearer-token validator with rotation support.
 *
 * Supports:
 * - Legacy single `bearerToken` (treated as never-expiring, label="legacy")
 * - Multiple tokens in `bearerTokens` with optional ISO expiry and labels
 * - Constant-time comparison via `crypto.timingSafeEqual` to prevent timing leaks
 * - Injected `now` clock for deterministic expiry tests
 */
import { timingSafeEqual } from 'crypto';
// ─── Factory ─────────────────────────────────────────────────────────────────
export function createTokenValidator(config, opts) {
    var _a;
    const now = (_a = opts === null || opts === void 0 ? void 0 : opts.now) !== null && _a !== void 0 ? _a : (() => new Date());
    // Build the canonical token list: bearerToken first (legacy), then bearerTokens array
    const entries = [];
    if (config.bearerToken) {
        entries.push({ value: config.bearerToken, label: 'legacy' });
    }
    if (config.bearerTokens) {
        entries.push(...config.bearerTokens);
    }
    // Open mode: no tokens configured → allow all
    const openMode = entries.length === 0;
    return {
        validate(token) {
            if (openMode)
                return { ok: true };
            // Guard against runtime misuse (e.g. undefined from untyped callers).
            if (typeof token !== 'string')
                return { ok: false, reason: 'unknown' };
            for (const entry of entries) {
                if (!constantEqual(token, entry.value))
                    continue;
                // Token value matches — check expiry
                if (entry.expiresAt) {
                    const expiry = new Date(entry.expiresAt);
                    if (now() >= expiry) {
                        return { ok: false, reason: 'expired', label: entry.label };
                    }
                }
                return { ok: true, label: entry.label };
            }
            return { ok: false, reason: 'unknown' };
        },
    };
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Constant-time string comparison.
 * `timingSafeEqual` requires equal-length buffers, so we always allocate the
 * same-length buffer for both sides (padding with the candidate itself to avoid
 * leaking the stored token's length).
 */
function constantEqual(candidate, stored) {
    const a = Buffer.from(candidate);
    const b = Buffer.from(stored);
    // Pads/truncates `a` to `b.length` so `timingSafeEqual` can run.
    // If lengths differ the result is always false, but we still do the comparison
    // to avoid a short-circuit that leaks timing info about string length.
    const paddedA = Buffer.allocUnsafe(b.length);
    a.copy(paddedA, 0, 0, Math.min(a.length, b.length));
    if (a.length < b.length)
        paddedA.fill(0, a.length);
    const match = timingSafeEqual(paddedA, b);
    // Only return true when lengths also match (padding would give false positives)
    return match && a.length === b.length;
}

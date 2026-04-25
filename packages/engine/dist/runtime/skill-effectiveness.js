/**
 * skill-effectiveness.ts — Pyrfor SkillEffectivenessTracker (G+4).
 *
 * Tracks per-skill usage, success/failure/partial outcomes, mean latency, and
 * last-used timestamp.  Persists to a JSON file atomically (tmp + renameSync).
 * Exposes pickBest() for epsilon-greedy skill selection based on proven track
 * records.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
// ── Atomic write helper ───────────────────────────────────────────────────────
function atomicWriteSync(filePath, content) {
    const dir = path.dirname(filePath);
    const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomBytes(4).toString('hex')}`);
    try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(tmp, content, 'utf8');
        renameSync(tmp, filePath);
    }
    catch (err) {
        try {
            unlinkSync(tmp);
        }
        catch (_a) {
            // best-effort cleanup
        }
        throw err;
    }
}
// ── Default score function ────────────────────────────────────────────────────
function clamp(min, max, v) {
    return Math.min(max, Math.max(min, v));
}
function buildDefaultScoreFn(clock) {
    return (r) => {
        const emaScore = r.ema * 0.7;
        let recencyScore = 0.2; // no lastUsedAt → treat as brand-new (neutral)
        if (r.lastUsedAt) {
            const daysOld = (clock() - new Date(r.lastUsedAt).getTime()) / 86400000;
            recencyScore = (1 - clamp(0, 1, daysOld / 30)) * 0.2;
        }
        const latencyScore = (1 / (1 + r.meanLatencyMs / 1000)) * 0.1;
        return emaScore + recencyScore + latencyScore;
    };
}
// ── Zero-usage synthetic record helper ───────────────────────────────────────
function syntheticRecord(id, name) {
    return {
        skillId: id,
        skillName: name !== null && name !== void 0 ? name : id,
        uses: 0,
        successes: 0,
        failures: 0,
        partials: 0,
        totalLatencyMs: 0,
        meanLatencyMs: 0,
        ema: 0.5,
    };
}
// ── Factory ───────────────────────────────────────────────────────────────────
export function createSkillEffectivenessTracker(opts) {
    const { storePath, alpha = 0.3, clock = () => Date.now(), flushDebounceMs = 200, logger, } = opts !== null && opts !== void 0 ? opts : {};
    const _records = new Map();
    let _debounceTimer = null;
    const defaultScoreFn = buildDefaultScoreFn(clock);
    // ── Load from disk ────────────────────────────────────────────────────────
    if (storePath) {
        try {
            const raw = readFileSync(storePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const rec of parsed) {
                    _records.set(rec.skillId, rec);
                }
            }
        }
        catch (err) {
            const isMissing = err instanceof Error && 'code' in err && err.code === 'ENOENT';
            if (!isMissing) {
                logger === null || logger === void 0 ? void 0 : logger('warn', '[SkillEffectivenessTracker] Bad JSON in storePath; starting fresh.', {
                    storePath,
                    err,
                });
            }
        }
    }
    // ── Flush ─────────────────────────────────────────────────────────────────
    function flush() {
        return __awaiter(this, void 0, void 0, function* () {
            if (_debounceTimer !== null) {
                clearTimeout(_debounceTimer);
                _debounceTimer = null;
            }
            if (!storePath)
                return;
            const items = Array.from(_records.values());
            atomicWriteSync(storePath, JSON.stringify(items, null, 2));
        });
    }
    function scheduledFlush() {
        if (!storePath)
            return;
        if (_debounceTimer !== null)
            clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
            _debounceTimer = null;
            const items = Array.from(_records.values());
            try {
                atomicWriteSync(storePath, JSON.stringify(items, null, 2));
            }
            catch (err) {
                logger === null || logger === void 0 ? void 0 : logger('error', '[SkillEffectivenessTracker] Debounced flush failed.', { err });
            }
        }, flushDebounceMs);
    }
    // ── recordOutcome ─────────────────────────────────────────────────────────
    function recordOutcome(input) {
        var _a, _b;
        const latencyMs = Math.max(0, input.latencyMs);
        let rec = _records.get(input.skillId);
        if (!rec) {
            rec = {
                skillId: input.skillId,
                skillName: input.skillName,
                uses: 0,
                successes: 0,
                failures: 0,
                partials: 0,
                totalLatencyMs: 0,
                meanLatencyMs: 0,
                ema: 0.5,
                tags: [],
            };
        }
        rec.uses += 1;
        if (input.outcome === 'success')
            rec.successes += 1;
        else if (input.outcome === 'failure')
            rec.failures += 1;
        else
            rec.partials += 1;
        rec.totalLatencyMs += latencyMs;
        rec.meanLatencyMs = rec.totalLatencyMs / rec.uses;
        rec.lastUsedAt = (_a = input.timestamp) !== null && _a !== void 0 ? _a : new Date(clock()).toISOString();
        rec.lastOutcome = input.outcome;
        // EMA: x=1 for success, 0 for failure, 0.5 for partial
        const x = input.outcome === 'success' ? 1 : input.outcome === 'failure' ? 0 : 0.5;
        rec.ema = alpha * x + (1 - alpha) * rec.ema;
        // Merge tags: deduped, capped at 10
        if (input.tags && input.tags.length > 0) {
            const existing = new Set((_b = rec.tags) !== null && _b !== void 0 ? _b : []);
            for (const t of input.tags) {
                existing.add(t);
            }
            rec.tags = Array.from(existing).slice(0, 10);
        }
        _records.set(rec.skillId, rec);
        scheduledFlush();
        return rec;
    }
    // ── get / list ────────────────────────────────────────────────────────────
    function get(skillId) {
        return _records.get(skillId);
    }
    function list() {
        return Array.from(_records.values());
    }
    // ── rank ──────────────────────────────────────────────────────────────────
    function rank(rankOpts) {
        var _a, _b;
        const scoreFn = (_a = rankOpts === null || rankOpts === void 0 ? void 0 : rankOpts.scoreFn) !== null && _a !== void 0 ? _a : defaultScoreFn;
        const clockFn = (_b = rankOpts === null || rankOpts === void 0 ? void 0 : rankOpts.clock) !== null && _b !== void 0 ? _b : clock;
        const effectiveScoreFn = (rankOpts === null || rankOpts === void 0 ? void 0 : rankOpts.scoreFn)
            ? scoreFn
            : buildDefaultScoreFn(clockFn);
        return Array.from(_records.values())
            .slice()
            .sort((a, b) => effectiveScoreFn(b) - effectiveScoreFn(a));
    }
    // ── pickBest ──────────────────────────────────────────────────────────────
    function pickBest(candidates, pickOpts) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        if (candidates.length === 0)
            return undefined;
        const minUses = (_a = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.minUses) !== null && _a !== void 0 ? _a : 0;
        const explorationRate = clamp(0, 1, (_b = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.explorationRate) !== null && _b !== void 0 ? _b : 0.1);
        const minScore = (_c = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.minScore) !== null && _c !== void 0 ? _c : 0;
        const rng = (_d = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.rng) !== null && _d !== void 0 ? _d : Math.random;
        const clockFn = (_e = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.clock) !== null && _e !== void 0 ? _e : clock;
        const scoreFn = (_f = pickOpts === null || pickOpts === void 0 ? void 0 : pickOpts.scoreFn) !== null && _f !== void 0 ? _f : buildDefaultScoreFn(clockFn);
        // Build (candidate, record, score) tuples for eligible candidates
        const eligible = [];
        for (const c of candidates) {
            const rec = (_g = _records.get(c.id)) !== null && _g !== void 0 ? _g : syntheticRecord(c.id, c.name);
            if (rec.uses < minUses)
                continue;
            const score = scoreFn(rec);
            if (score < minScore)
                continue;
            eligible.push({ candidate: c, score });
        }
        if (eligible.length === 0)
            return undefined;
        // Epsilon-greedy: explore uniformly from eligible, or exploit top score
        if (rng() < explorationRate) {
            const idx = Math.floor(rng() * eligible.length);
            return (_j = (_h = eligible[idx]) === null || _h === void 0 ? void 0 : _h.candidate) !== null && _j !== void 0 ? _j : eligible[0].candidate;
        }
        // Exploit: pick highest score (stable: preserves original index on tie)
        let best = eligible[0];
        for (let i = 1; i < eligible.length; i++) {
            if (eligible[i].score > best.score) {
                best = eligible[i];
            }
        }
        return best.candidate;
    }
    // ── reset ─────────────────────────────────────────────────────────────────
    function reset(skillId) {
        if (skillId !== undefined) {
            _records.delete(skillId);
        }
        else {
            _records.clear();
        }
        scheduledFlush();
    }
    return { recordOutcome, get, list, pickBest, rank, reset, flush };
}

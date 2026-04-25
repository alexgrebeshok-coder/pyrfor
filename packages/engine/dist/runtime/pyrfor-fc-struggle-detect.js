// ─── Helpers ─────────────────────────────────────────────────────────────────
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
// ─── Implementation ───────────────────────────────────────────────────────────
export class DefaultStruggleDetector {
    constructor(opts) {
        var _a, _b, _c, _d;
        this.plateauWindow = (_a = opts === null || opts === void 0 ? void 0 : opts.plateauWindow) !== null && _a !== void 0 ? _a : 3;
        this.plateauDelta = (_b = opts === null || opts === void 0 ? void 0 : opts.plateauDelta) !== null && _b !== void 0 ? _b : 2;
        this.sameErrorN = (_c = opts === null || opts === void 0 ? void 0 : opts.sameErrorN) !== null && _c !== void 0 ? _c : 3;
        this.costSpikeMultiplier = (_d = opts === null || opts === void 0 ? void 0 : opts.costSpikeMultiplier) !== null && _d !== void 0 ? _d : 3;
    }
    detect(history) {
        if (history.length === 0)
            return { stuck: false };
        // ── Plateau: last plateauWindow iters all within plateauDelta AND below 80 ──
        if (history.length >= this.plateauWindow) {
            const window = history.slice(-this.plateauWindow);
            const scores = window.map((r) => r.score.total);
            const minS = Math.min(...scores);
            const maxS = Math.max(...scores);
            if (maxS - minS <= this.plateauDelta && maxS < 80) {
                return { stuck: true, reason: 'plateau' };
            }
        }
        // ── Same error: same breakdown.failedCheck repeated sameErrorN times ──
        if (history.length >= this.sameErrorN) {
            const recent = history.slice(-this.sameErrorN);
            const errors = recent.map((r) => {
                const bd = r.score.breakdown;
                return bd === null || bd === void 0 ? void 0 : bd.failedCheck;
            });
            if (errors[0] !== undefined &&
                errors[0] !== null &&
                errors.every((e) => e === errors[0])) {
                return { stuck: true, reason: `same-error:${errors[0]}` };
            }
        }
        // ── Cost spike: latest > costSpikeMultiplier × median(prior) ──
        if (history.length >= 2) {
            const prior = history.slice(0, -1).map((r) => r.costUsd);
            const latest = history[history.length - 1].costUsd;
            const med = median(prior);
            if (med > 0 && latest > this.costSpikeMultiplier * med) {
                return { stuck: true, reason: 'cost-spike' };
            }
        }
        return { stuck: false };
    }
}

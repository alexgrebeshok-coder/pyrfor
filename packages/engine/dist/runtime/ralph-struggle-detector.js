function resolveOpts(opts) {
    var _a, _b, _c, _d;
    return {
        flatWindow: (_a = opts === null || opts === void 0 ? void 0 : opts.flatWindow) !== null && _a !== void 0 ? _a : 3,
        flatTolerance: (_b = opts === null || opts === void 0 ? void 0 : opts.flatTolerance) !== null && _b !== void 0 ? _b : 1.0,
        regressionTolerance: (_c = opts === null || opts === void 0 ? void 0 : opts.regressionTolerance) !== null && _c !== void 0 ? _c : 5.0,
        minIterations: (_d = opts === null || opts === void 0 ? void 0 : opts.minIterations) !== null && _d !== void 0 ? _d : 3,
    };
}
function analyseScores(scores, o) {
    const len = scores.length;
    if (len === 0)
        return { kind: 'progressing', lastScore: 0 };
    const last = scores[len - 1];
    if (len < o.minIterations) {
        return { kind: 'progressing', lastScore: last };
    }
    const prev = scores[len - 2];
    // Regression check
    if (last < prev - o.regressionTolerance) {
        return { kind: 'regression', from: prev, to: last };
    }
    // Oscillation check: in last flatWindow*2 scores, sign of delta flips >= flatWindow times
    const oscWindow = o.flatWindow * 2;
    if (len >= oscWindow + 1) {
        const window = scores.slice(len - oscWindow - 1);
        let flips = 0;
        let prevSign = null;
        for (let i = 1; i < window.length; i++) {
            const delta = window[i] - window[i - 1];
            const sign = delta > 0 ? 1 : delta < 0 ? -1 : 0;
            if (sign !== 0 && prevSign !== null && sign !== prevSign) {
                flips++;
            }
            if (sign !== 0)
                prevSign = sign;
        }
        if (flips >= o.flatWindow) {
            return { kind: 'oscillation', window: oscWindow };
        }
    }
    // Flat check: last flatWindow scores within ±flatTolerance of each other
    if (len >= o.flatWindow) {
        const window = scores.slice(len - o.flatWindow);
        const min = Math.min(...window);
        const max = Math.max(...window);
        if (max - min <= o.flatTolerance) {
            return { kind: 'flat', iterations: o.flatWindow, lastScore: last };
        }
    }
    // Progressing
    return { kind: 'progressing', lastScore: last };
}
export function createStruggleDetector(opts) {
    const o = resolveOpts(opts);
    let scores = [];
    return {
        observe(score) {
            scores.push(score);
            return analyseScores(scores, o);
        },
        reset() {
            scores = [];
        },
        history() {
            return scores;
        },
    };
}
export function detectStruggle(scores, opts) {
    return analyseScores(scores, resolveOpts(opts));
}

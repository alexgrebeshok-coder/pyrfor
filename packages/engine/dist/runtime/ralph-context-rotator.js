var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
export function defaultSummariser(text, opts) {
    const MARKER = '── earlier truncated ──';
    if (!text.trim())
        return text;
    if (opts.estimate(text) <= opts.maxTokens)
        return text;
    const lines = text.split('\n');
    const markerTokens = opts.estimate(MARKER + '\n');
    const lineBudget = opts.maxTokens - markerTokens;
    if (lineBudget <= 0) {
        // Budget too small even for marker; return as many trailing chars as fit
        let tail = '';
        for (let i = lines.length - 1; i >= 0; i--) {
            const candidate = lines[i] + (tail ? '\n' + tail : '');
            if (opts.estimate(candidate) > opts.maxTokens)
                break;
            tail = candidate;
        }
        return tail || text.slice(-Math.max(1, Math.floor(text.length * opts.maxTokens / opts.estimate(text))));
    }
    const kept = [];
    let used = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
        const lineTokens = opts.estimate(lines[i] + '\n');
        if (used + lineTokens > lineBudget)
            break;
        used += lineTokens;
        kept.unshift(lines[i]);
    }
    if (kept.length === lines.length)
        return text;
    return MARKER + '\n' + kept.join('\n');
}
export function createContextRotator(opts) {
    var _a, _b, _c;
    const maxTokens = (_a = opts === null || opts === void 0 ? void 0 : opts.maxTokens) !== null && _a !== void 0 ? _a : 80000;
    const summaryMaxTokens = (_b = opts === null || opts === void 0 ? void 0 : opts.summaryMaxTokens) !== null && _b !== void 0 ? _b : 800;
    const estimate = (_c = opts === null || opts === void 0 ? void 0 : opts.estimateTokens) !== null && _c !== void 0 ? _c : ((text) => Math.ceil(text.length / 4));
    const summariseFn = opts === null || opts === void 0 ? void 0 : opts.summariseFn;
    return {
        estimate(text) {
            return estimate(text);
        },
        shouldRotate(currentContext) {
            if (!currentContext) {
                return { rotate: false, reason: 'empty context', tokensEstimated: 0 };
            }
            const tokensEstimated = estimate(currentContext);
            if (tokensEstimated > maxTokens) {
                return {
                    rotate: true,
                    reason: `estimated ${tokensEstimated} tokens exceeds limit ${maxTokens}`,
                    tokensEstimated,
                };
            }
            return {
                rotate: false,
                reason: `estimated ${tokensEstimated} tokens within limit ${maxTokens}`,
                tokensEstimated,
            };
        },
        rotate(currentContext) {
            return __awaiter(this, void 0, void 0, function* () {
                const tokensEstimated = estimate(currentContext);
                let summary;
                if (summariseFn) {
                    summary = yield Promise.resolve(summariseFn(currentContext, { maxTokens: summaryMaxTokens }));
                }
                else {
                    summary = defaultSummariser(currentContext, {
                        maxTokens: summaryMaxTokens,
                        estimate,
                    });
                }
                // Cap to summaryMaxTokens
                if (estimate(summary) > summaryMaxTokens) {
                    const lines = summary.split('\n');
                    if (lines.length > 1) {
                        // Drop lines from front until it fits
                        let start = 0;
                        while (start < lines.length && estimate(lines.slice(start).join('\n')) > summaryMaxTokens) {
                            start++;
                        }
                        summary = lines.slice(start).join('\n');
                    }
                    // If still over (single line or couldn't shrink enough), proportional char trim
                    if (estimate(summary) > summaryMaxTokens && summary.length > 0) {
                        const ratio = summaryMaxTokens / estimate(summary);
                        summary = summary.slice(0, Math.max(0, Math.floor(summary.length * ratio)));
                        // Final safety trim
                        while (estimate(summary) > summaryMaxTokens && summary.length > 0) {
                            summary = summary.slice(0, summary.length - 1);
                        }
                    }
                }
                return { summary, tokensEstimated };
            });
        },
    };
}

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function countDiffLines(data) {
    var _a, _b;
    if (typeof data === 'object' && data !== null) {
        const d = data;
        if (typeof d['added'] === 'number' && typeof d['removed'] === 'number') {
            return { added: d['added'], removed: d['removed'] };
        }
        const content = (_b = (_a = d['content']) !== null && _a !== void 0 ? _a : d['diff']) !== null && _b !== void 0 ? _b : d['patch'];
        if (typeof content === 'string') {
            return parseUnifiedDiff(content);
        }
    }
    if (typeof data === 'string') {
        return parseUnifiedDiff(data);
    }
    return { added: 0, removed: 0 };
}
function parseUnifiedDiff(diff) {
    let added = 0;
    let removed = 0;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++'))
            added++;
        else if (line.startsWith('-') && !line.startsWith('---'))
            removed++;
    }
    return { added, removed };
}
export function createDiffSizeValidator(opts) {
    var _a, _b;
    const warnLines = (_a = opts === null || opts === void 0 ? void 0 : opts.warnLines) !== null && _a !== void 0 ? _a : 100;
    const blockLines = (_b = opts === null || opts === void 0 ? void 0 : opts.blockLines) !== null && _b !== void 0 ? _b : 500;
    return {
        name: 'diff-size',
        appliesTo(event) {
            return event.type === 'diff';
        },
        validate(event, _ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const start = Date.now();
                const { added, removed } = countDiffLines(event.data);
                const total = added + removed;
                const durationMs = Date.now() - start;
                if (total >= blockLines) {
                    return {
                        validator: 'diff-size',
                        verdict: 'block',
                        message: `Diff too large: ${total} lines (limit ${blockLines})`,
                        details: { added, removed, total, blockLines },
                        remediation: 'Break the change into smaller, focused commits',
                        durationMs,
                    };
                }
                if (total >= warnLines) {
                    return {
                        validator: 'diff-size',
                        verdict: 'warn',
                        message: `Diff is large: ${total} lines (warn threshold ${warnLines})`,
                        details: { added, removed, total, warnLines },
                        durationMs,
                    };
                }
                return {
                    validator: 'diff-size',
                    verdict: 'pass',
                    message: `Diff size OK: ${total} lines`,
                    details: { added, removed, total },
                    durationMs,
                };
            });
        },
    };
}

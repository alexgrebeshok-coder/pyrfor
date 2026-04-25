var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { extractTouchedPaths } from '../step-validator.js';
function isEditDeleteMoveEvent(event) {
    var _a;
    if (event.type !== 'tool_call' && event.type !== 'tool_call_update')
        return false;
    const data = event.data;
    const kind = String((_a = data === null || data === void 0 ? void 0 : data['kind']) !== null && _a !== void 0 ? _a : '');
    return ['edit', 'delete', 'move'].includes(kind);
}
export function createScopeCheckValidator(opts) {
    var _a;
    const strict = (_a = opts === null || opts === void 0 ? void 0 : opts.strict) !== null && _a !== void 0 ? _a : false;
    return {
        name: 'scope-check',
        appliesTo(event) {
            return isEditDeleteMoveEvent(event);
        },
        validate(event, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                const start = Date.now();
                const touchedPaths = extractTouchedPaths(event);
                if (ctx.scopeFiles && ctx.scopeFiles.length > 0) {
                    const outOfScope = touchedPaths.filter((p) => !ctx.scopeFiles.includes(p));
                    if (outOfScope.length > 0) {
                        const durationMs = Date.now() - start;
                        if (strict) {
                            return {
                                validator: 'scope-check',
                                verdict: 'block',
                                message: `Out-of-scope files modified: ${outOfScope.join(', ')}`,
                                details: { outOfScope, scopeFiles: ctx.scopeFiles },
                                remediation: 'Limit changes to files within the task scope',
                                durationMs,
                            };
                        }
                        return {
                            validator: 'scope-check',
                            verdict: 'warn',
                            message: `Possible out-of-scope files modified: ${outOfScope.join(', ')}`,
                            details: { outOfScope, scopeFiles: ctx.scopeFiles },
                            durationMs,
                        };
                    }
                }
                if (ctx.llmFn && ctx.task) {
                    const dataStr = typeof event.data === 'string' ? event.data : JSON.stringify(event.data).slice(0, 2000);
                    const prompt = `Task: ${ctx.task}\n\nThe agent made this change:\n${dataStr}\n\nDid this change stay within the task scope? Reply with exactly "yes" or "no".`;
                    try {
                        const answer = (yield ctx.llmFn(prompt)).trim().toLowerCase();
                        if (answer.startsWith('no')) {
                            const durationMs = Date.now() - start;
                            return {
                                validator: 'scope-check',
                                verdict: 'correct',
                                message: 'LLM judged change as outside task scope',
                                details: { llmAnswer: answer, task: ctx.task },
                                remediation: 'Revise the change to stay within task scope',
                                durationMs,
                            };
                        }
                    }
                    catch (_a) {
                        // LLM failure is non-fatal
                    }
                }
                const durationMs = Date.now() - start;
                return {
                    validator: 'scope-check',
                    verdict: 'pass',
                    message: 'Change is within task scope',
                    durationMs,
                };
            });
        },
    };
}

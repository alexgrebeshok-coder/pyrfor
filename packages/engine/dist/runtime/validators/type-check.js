var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { runShell } from '../step-validator.js';
export function createTypeCheckValidator(opts) {
    var _a, _b;
    const command = (_a = opts === null || opts === void 0 ? void 0 : opts.command) !== null && _a !== void 0 ? _a : 'npx tsc --noEmit';
    const appliesToKinds = (_b = opts === null || opts === void 0 ? void 0 : opts.appliesToKinds) !== null && _b !== void 0 ? _b : ['edit'];
    return {
        name: 'type-check',
        appliesTo(event) {
            var _a;
            if (event.type !== 'tool_call' && event.type !== 'tool_call_update')
                return false;
            const data = event.data;
            return appliesToKinds.includes(String((_a = data === null || data === void 0 ? void 0 : data['kind']) !== null && _a !== void 0 ? _a : ''));
        },
        validate(event, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const start = Date.now();
                const timeoutMs = (_b = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : ctx.shellTimeoutMs) !== null && _b !== void 0 ? _b : 60000;
                const { stdout, stderr, exitCode } = yield runShell(command, {
                    cwd: ctx.cwd,
                    timeoutMs,
                    abortSignal: ctx.abortSignal,
                });
                const durationMs = Date.now() - start;
                if (exitCode === 0) {
                    return {
                        validator: 'type-check',
                        verdict: 'pass',
                        message: 'TypeScript compiled successfully',
                        durationMs,
                    };
                }
                return {
                    validator: 'type-check',
                    verdict: 'block',
                    message: 'TypeScript compilation failed',
                    details: { stdout, stderr, exitCode },
                    remediation: 'Fix TypeScript errors before proceeding',
                    durationMs,
                };
            });
        },
    };
}

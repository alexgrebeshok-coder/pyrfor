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
function parseTestJson(stdout) {
    var _a, _b;
    try {
        const parsed = JSON.parse(stdout.trim());
        const total = (_a = parsed.numTotalTests) !== null && _a !== void 0 ? _a : 0;
        const failed = (_b = parsed.numFailedTests) !== null && _b !== void 0 ? _b : 0;
        return { failed, total };
    }
    catch (_c) {
        return null;
    }
}
export function createTestGateValidator(opts) {
    var _a, _b;
    const command = (_a = opts === null || opts === void 0 ? void 0 : opts.command) !== null && _a !== void 0 ? _a : 'npx vitest run --reporter=json';
    const correctThreshold = (_b = opts === null || opts === void 0 ? void 0 : opts.failCorrectThreshold) !== null && _b !== void 0 ? _b : 0.5;
    return {
        name: 'test-gate',
        appliesTo(event) {
            var _a;
            if (event.type !== 'tool_call' && event.type !== 'tool_call_update')
                return false;
            const data = event.data;
            const kind = String((_a = data === null || data === void 0 ? void 0 : data['kind']) !== null && _a !== void 0 ? _a : '');
            return kind === 'edit';
        },
        validate(event, ctx) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                const start = Date.now();
                const timeoutMs = (_b = (_a = opts === null || opts === void 0 ? void 0 : opts.timeoutMs) !== null && _a !== void 0 ? _a : ctx.shellTimeoutMs) !== null && _b !== void 0 ? _b : 60000;
                const { stdout, exitCode } = yield runShell(command, {
                    cwd: ctx.cwd,
                    timeoutMs,
                    abortSignal: ctx.abortSignal,
                });
                const durationMs = Date.now() - start;
                const parsed = parseTestJson(stdout);
                if (!parsed) {
                    return {
                        validator: 'test-gate',
                        verdict: exitCode === 0 ? 'pass' : 'block',
                        message: exitCode === 0 ? 'Tests passed' : 'Tests failed (could not parse output)',
                        details: { stdout: stdout.slice(0, 500) },
                        durationMs,
                    };
                }
                const { failed, total } = parsed;
                const ratio = total === 0 ? 0 : failed / total;
                if (ratio === 0) {
                    return {
                        validator: 'test-gate',
                        verdict: 'pass',
                        message: `All ${total} tests passed`,
                        details: { failed, total },
                        durationMs,
                    };
                }
                if (ratio <= correctThreshold) {
                    return {
                        validator: 'test-gate',
                        verdict: 'correct',
                        message: `${failed}/${total} tests failed (below block threshold)`,
                        details: { failed, total, ratio },
                        remediation: 'Fix failing tests',
                        durationMs,
                    };
                }
                return {
                    validator: 'test-gate',
                    verdict: 'block',
                    message: `${failed}/${total} tests failed (exceeds threshold)`,
                    details: { failed, total, ratio },
                    remediation: 'Fix failing tests before proceeding',
                    durationMs,
                };
            });
        },
    };
}

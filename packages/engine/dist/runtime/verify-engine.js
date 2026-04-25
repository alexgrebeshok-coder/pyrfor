var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { spawn } from 'child_process';
function tailBuffer(buf, max) {
    if (buf.length <= max)
        return buf;
    return buf.subarray(buf.length - max);
}
function runCheck(check, opts) {
    var _a, _b;
    const truncateBytes = (_a = opts.truncateOutputBytes) !== null && _a !== void 0 ? _a : 4000;
    const timeoutMs = (_b = check.timeoutMs) !== null && _b !== void 0 ? _b : 60000;
    const start = Date.now();
    return new Promise((resolve) => {
        var _a;
        const env = Object.assign(Object.assign({}, process.env), ((_a = opts.env) !== null && _a !== void 0 ? _a : {}));
        const proc = spawn('bash', ['-lc', check.command], {
            cwd: opts.cwd,
            env,
        });
        let stdoutBuf = Buffer.alloc(0);
        let stderrBuf = Buffer.alloc(0);
        let timedOut = false;
        let aborted = false;
        let settled = false;
        const onStdout = (chunk) => {
            stdoutBuf = tailBuffer(Buffer.concat([stdoutBuf, chunk]), truncateBytes);
        };
        const onStderr = (chunk) => {
            stderrBuf = tailBuffer(Buffer.concat([stderrBuf, chunk]), truncateBytes);
        };
        proc.stdout.on('data', onStdout);
        proc.stderr.on('data', onStderr);
        const timer = setTimeout(() => {
            timedOut = true;
            try {
                proc.kill('SIGTERM');
            }
            catch (_a) {
                // ignore
            }
            // Force kill after a short grace period
            setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                }
                catch (_a) {
                    // ignore
                }
            }, 200);
        }, timeoutMs);
        const onAbort = () => {
            aborted = true;
            try {
                proc.kill('SIGTERM');
            }
            catch (_a) {
                // ignore
            }
            setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                }
                catch (_a) {
                    // ignore
                }
            }, 200);
        };
        if (opts.abortSignal) {
            if (opts.abortSignal.aborted) {
                onAbort();
            }
            else {
                opts.abortSignal.addEventListener('abort', onAbort, { once: true });
            }
        }
        proc.on('error', (_err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (opts.abortSignal)
                opts.abortSignal.removeEventListener('abort', onAbort);
            const stdout = stdoutBuf.toString('utf8');
            const stderr = stderrBuf.toString('utf8');
            resolve({
                name: check.name,
                passed: false,
                score: 0,
                stdout,
                stderr,
                exitCode: null,
                durationMs: Date.now() - start,
            });
        });
        proc.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (opts.abortSignal)
                opts.abortSignal.removeEventListener('abort', onAbort);
            const stdout = stdoutBuf.toString('utf8');
            const stderr = stderrBuf.toString('utf8');
            const exitCode = timedOut || aborted ? null : code;
            let passed = !timedOut && !aborted && exitCode === 0;
            if (passed && check.successPattern) {
                passed = check.successPattern.test(stdout);
            }
            resolve({
                name: check.name,
                passed,
                score: passed ? check.weight : 0,
                stdout,
                stderr,
                exitCode,
                durationMs: Date.now() - start,
            });
        });
    });
}
export function runVerify(checks_1) {
    return __awaiter(this, arguments, void 0, function* (checks, opts = {}) {
        var _a, _b;
        const threshold = (_a = opts.threshold) !== null && _a !== void 0 ? _a : 80;
        if (checks.length === 0) {
            return {
                total: 100,
                threshold,
                passed: 100 >= threshold,
                checks: [],
                ts: Date.now(),
            };
        }
        const results = [];
        for (const check of checks) {
            if ((_b = opts.abortSignal) === null || _b === void 0 ? void 0 : _b.aborted) {
                results.push({
                    name: check.name,
                    passed: false,
                    score: 0,
                    stdout: '',
                    stderr: '',
                    exitCode: null,
                    durationMs: 0,
                });
                continue;
            }
            const r = yield runCheck(check, opts);
            results.push(r);
        }
        const total = results.reduce((s, r) => s + r.score, 0);
        return {
            total,
            threshold,
            passed: total >= threshold,
            checks: results,
            ts: Date.now(),
        };
    });
}

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_PATH = '/usr/bin:/bin';
export class LocalProcessBackend {
    constructor() {
        this.backend = 'local-process';
    }
    isAvailable() {
        return __awaiter(this, void 0, void 0, function* () {
            return true;
        });
    }
    run(options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const startedAt = Date.now();
            const timeoutMs = (_a = options.timeoutMs) !== null && _a !== void 0 ? _a : DEFAULT_TIMEOUT_MS;
            const maxOutputBytes = (_b = options.maxOutputBytes) !== null && _b !== void 0 ? _b : DEFAULT_MAX_OUTPUT_BYTES;
            const args = (_c = options.args) !== null && _c !== void 0 ? _c : [];
            let stdout = Buffer.alloc(0);
            let stderr = Buffer.alloc(0);
            let timedOut = false;
            let killedForOutput = false;
            return new Promise((resolve) => {
                var _a, _b;
                const child = spawn(options.implPath, args, {
                    cwd: options.workdir,
                    env: buildSandboxEnv(options.env),
                    detached: true,
                    shell: false,
                });
                const finish = (exitCode) => {
                    resolve({
                        exitCode,
                        stdout: stdout.toString('utf8'),
                        stderr: stderr.toString('utf8'),
                        durationMs: Date.now() - startedAt,
                        timedOut,
                        backend: this.backend,
                        artifactId: `sandbox:${randomUUID()}`,
                    });
                };
                const killGroup = () => {
                    if (child.pid === undefined || child.killed)
                        return;
                    try {
                        process.kill(-child.pid, 'SIGKILL');
                    }
                    catch (_a) {
                        child.kill('SIGKILL');
                    }
                };
                const timeout = setTimeout(() => {
                    timedOut = true;
                    killGroup();
                }, timeoutMs);
                (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
                    stdout = appendCapped(stdout, chunk, maxOutputBytes);
                    if (stdout.byteLength >= maxOutputBytes && !killedForOutput) {
                        killedForOutput = true;
                        killGroup();
                    }
                });
                (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (chunk) => {
                    stderr = appendCapped(stderr, chunk, maxOutputBytes);
                });
                child.on('error', (error) => {
                    clearTimeout(timeout);
                    stderr = appendCapped(stderr, Buffer.from(error.message), maxOutputBytes);
                    finish(127);
                });
                child.on('close', (code, signal) => {
                    clearTimeout(timeout);
                    if (timedOut) {
                        finish(code !== null && code !== void 0 ? code : 124);
                        return;
                    }
                    if (killedForOutput) {
                        finish(code !== null && code !== void 0 ? code : 137);
                        return;
                    }
                    if (code !== null) {
                        finish(code);
                        return;
                    }
                    finish(signal ? 128 : 1);
                });
            });
        });
    }
}
export function createSandboxExecutor(preferred) {
    return __awaiter(this, void 0, void 0, function* () {
        if (preferred === 'wasm') {
            const { WasmSandboxBackend } = yield import('./wasm-sandbox-backend.js');
            return new WasmSandboxBackend();
        }
        if (preferred === 'microsandbox-stub') {
            const { MicrosandboxStubBackend } = yield import('../sandbox/adapters/microsandbox-stub.js');
            return new MicrosandboxStubBackend();
        }
        if (preferred === 'docker' ||
            preferred === 'container_no_net' ||
            preferred === 'container_net_allowlist' ||
            preferred === 'container_full') {
            const { DockerSandboxBackend } = yield import('./docker-sandbox-backend.js');
            return new DockerSandboxBackend(preferred === 'docker' ? 'container_no_net' : preferred);
        }
        return new LocalProcessBackend();
    });
}
function buildSandboxEnv(input) {
    const _a = input !== null && input !== void 0 ? input : {}, { NODE_ENV } = _a, rest = __rest(_a, ["NODE_ENV"]);
    return Object.assign(Object.assign({ PATH: DEFAULT_PATH }, rest), { NODE_ENV: normalizeNodeEnv(NODE_ENV !== null && NODE_ENV !== void 0 ? NODE_ENV : 'test') });
}
function normalizeNodeEnv(value) {
    if (value === 'development' || value === 'production' || value === 'test')
        return value;
    return 'test';
}
function appendCapped(current, chunk, maxBytes) {
    if (maxBytes <= 0)
        return Buffer.alloc(0);
    const remaining = maxBytes - current.byteLength;
    if (remaining <= 0)
        return current;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
}

var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { chmod, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSandboxExecutor, } from '../universal/sandbox-executor.js';
import { MicrosandboxStubBackend } from './adapters/microsandbox-stub.js';
function isDockerTierBackend(backend) {
    return (backend === 'docker'
        || backend === 'container_no_net'
        || backend === 'container_net_allowlist'
        || backend === 'container_full');
}
/** Safe single-quoted literal for POSIX sh */
function shellSingleQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
export class SandboxProvider {
    constructor(cfg) {
        this.cfg = cfg;
        this.executorPromise = null;
    }
    get config() {
        return this.cfg;
    }
    resetExecutorCache() {
        this.executorPromise = null;
    }
    /** Resolve universal backend preference from runtime mode */
    preferredBackend() {
        var _a;
        switch (this.cfg.mode) {
            case 'none':
                return undefined;
            case 'local-process':
                return 'local-process';
            case 'docker':
                return (_a = this.cfg.dockerTier) !== null && _a !== void 0 ? _a : 'docker';
            case 'wasm':
                return 'wasm';
            case 'microsandbox':
                return 'microsandbox-stub';
            default:
                return undefined;
        }
    }
    getExecutor() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.executorPromise) {
                const backend = this.preferredBackend();
                if (this.cfg.mode === 'microsandbox') {
                    this.executorPromise = Promise.resolve(new MicrosandboxStubBackend());
                }
                else {
                    this.executorPromise = createSandboxExecutor(backend);
                }
            }
            return this.executorPromise;
        });
    }
    /**
     * Run a shell one-liner inside the sandbox backend with `cwd` mounted / used as workdir.
     */
    runShellCommand(command, opts) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const exe = yield this.getExecutor();
            const timeoutMs = (_a = opts.timeoutMs) !== null && _a !== void 0 ? _a : 30000;
            const maxOutputBytes = (_b = opts.maxOutputBytes) !== null && _b !== void 0 ? _b : 2 * 1024 * 1024;
            const runOpts = {
                workdir: opts.cwd,
                timeoutMs,
                maxOutputBytes,
                image: this.cfg.dockerImage,
            };
            if (isDockerTierBackend(exe.backend)) {
                const scriptPath = path.join(opts.cwd, `.pyrfor-sbx-${randomUUID().slice(0, 8)}.sh`);
                const body = `#!/bin/sh
set -e
exec /bin/sh -c ${shellSingleQuote(command)}
`;
                yield writeFile(scriptPath, body, 'utf8');
                yield chmod(scriptPath, 0o755);
                try {
                    const result = yield exe.run(Object.assign({ implPath: scriptPath, args: [] }, runOpts));
                    return {
                        exitCode: result.exitCode,
                        stdout: result.stdout,
                        stderr: result.stderr,
                        timedOut: result.timedOut,
                    };
                }
                finally {
                    yield unlink(scriptPath).catch(() => { });
                }
            }
            const useWindows = process.platform === 'win32';
            const implPath = useWindows ? ((_c = process.env.ComSpec) !== null && _c !== void 0 ? _c : 'cmd.exe') : '/bin/sh';
            const args = useWindows ? ['/d', '/s', '/c', command] : ['-lc', command];
            const result = yield exe.run(Object.assign({ implPath,
                args }, runOpts));
            return {
                exitCode: result.exitCode,
                stdout: result.stdout,
                stderr: result.stderr,
                timedOut: result.timedOut,
            };
        });
    }
}
export function createSandboxProvider(cfg) {
    if (!cfg || cfg.mode === 'none')
        return null;
    return new SandboxProvider(cfg);
}

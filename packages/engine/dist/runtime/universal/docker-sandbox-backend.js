var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
const DOCKER_SOCKETS = [
    '/var/run/docker.sock',
    '\\\\.\\pipe\\docker_engine',
];
const DEFAULT_IMAGE = 'node:20-alpine';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const CONTAINER_WORKDIR = '/workspace';
export class DockerSandboxBackend {
    constructor(tier = 'container_no_net', runner = runDockerCommand) {
        this.backend = tier;
        this.runner = runner;
    }
    isAvailable() {
        return __awaiter(this, void 0, void 0, function* () {
            return DOCKER_SOCKETS.some((socket) => existsSync(socket));
        });
    }
    run(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const spec = buildDockerRunSpec(this.backend, options);
            const result = yield this.runner(spec.args, {
                timeoutMs: options.timeoutMs,
                maxOutputBytes: options.maxOutputBytes,
            });
            return Object.assign(Object.assign({}, result), { backend: this.backend, artifactId: `sandbox:${randomUUID()}` });
        });
    }
}
export function buildDockerRunSpec(tier, options) {
    var _a, _b, _c, _d;
    const egressPolicy = validateContainerNetworkPolicy(tier, options);
    const networkMode = tier === 'container_full' ? 'bridge' : 'none';
    const image = (_a = options.image) !== null && _a !== void 0 ? _a : DEFAULT_IMAGE;
    const containerImplPath = toContainerPath(options.implPath, options.workdir);
    const args = [
        'run',
        '--rm',
        '--network',
        networkMode,
        '--workdir',
        CONTAINER_WORKDIR,
        '--volume',
        `${realpathSync(options.workdir)}:${CONTAINER_WORKDIR}:rw`,
        '--env',
        `PYRFOR_SANDBOX_TIER=${tier}`,
        '--env',
        `PYRFOR_EGRESS_ALLOWLIST=${((_b = options.networkAllowlist) !== null && _b !== void 0 ? _b : []).join(',')}`,
    ];
    if (options.containerUser)
        args.push('--user', options.containerUser);
    if ((_c = options.readonlyRootfs) !== null && _c !== void 0 ? _c : true)
        args.push('--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m');
    args.push(image, containerImplPath, ...((_d = options.args) !== null && _d !== void 0 ? _d : []));
    return { tier, args, networkMode, egressPolicy };
}
export function validateContainerNetworkPolicy(tier, options) {
    var _a, _b;
    const requested = (_a = options.requestedEgress) !== null && _a !== void 0 ? _a : [];
    if (tier === 'container_no_net') {
        if (options.networkEnabled || requested.length > 0) {
            throw new Error('DockerSandboxBackend: container_no_net forbids network egress');
        }
        return 'disabled';
    }
    if (tier === 'container_net_allowlist') {
        const allowlist = (_b = options.networkAllowlist) !== null && _b !== void 0 ? _b : [];
        for (const target of requested) {
            if (!isEgressTargetAllowed(target, allowlist)) {
                throw new Error(`DockerSandboxBackend: egress target outside allowlist: ${target}`);
            }
        }
        return 'allowlist_enforced';
    }
    return 'full';
}
function toContainerPath(implPath, workdir) {
    const realWorkdir = realpathSync(workdir);
    const resolvedImpl = realpathSync(implPath);
    const relative = path.relative(realWorkdir, resolvedImpl);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`DockerSandboxBackend: implPath must be inside workdir: ${implPath}`);
    }
    return path.posix.join(CONTAINER_WORKDIR, relative.split(path.sep).join('/'));
}
function isEgressTargetAllowed(target, allowlist) {
    if (allowlist.length === 0)
        return false;
    let host;
    try {
        host = new URL(target).host;
    }
    catch (_a) {
        host = target;
    }
    return allowlist.includes(host);
}
function runDockerCommand(args, options) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const startedAt = Date.now();
        const timeoutMs = (_a = options.timeoutMs) !== null && _a !== void 0 ? _a : DEFAULT_TIMEOUT_MS;
        const maxOutputBytes = (_b = options.maxOutputBytes) !== null && _b !== void 0 ? _b : DEFAULT_MAX_OUTPUT_BYTES;
        let stdout = Buffer.alloc(0);
        let stderr = Buffer.alloc(0);
        let timedOut = false;
        let killedForOutput = false;
        return new Promise((resolve) => {
            var _a, _b;
            const child = spawn('docker', args, {
                detached: true,
                shell: false,
            });
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
            const finish = (exitCode) => {
                resolve({
                    exitCode,
                    stdout: stdout.toString('utf8'),
                    stderr: stderr.toString('utf8'),
                    durationMs: Date.now() - startedAt,
                    timedOut,
                });
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
function appendCapped(current, chunk, maxBytes) {
    if (maxBytes <= 0)
        return Buffer.alloc(0);
    const remaining = maxBytes - current.byteLength;
    if (remaining <= 0)
        return current;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
}

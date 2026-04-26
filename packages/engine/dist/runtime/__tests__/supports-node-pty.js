import { spawn as ptySpawn } from 'node-pty';
function probeShell() {
    var _a;
    if (process.platform === 'win32') {
        return (_a = process.env['ComSpec']) !== null && _a !== void 0 ? _a : 'cmd.exe';
    }
    return '/bin/sh';
}
function probeCwd() {
    if (process.platform === 'win32') {
        return process.cwd();
    }
    return '/tmp';
}
export const nodePtySupported = (() => {
    try {
        const pty = ptySpawn(probeShell(), [], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: probeCwd(),
            env: process.env,
        });
        pty.kill();
        return true;
    }
    catch (_a) {
        return false;
    }
})();

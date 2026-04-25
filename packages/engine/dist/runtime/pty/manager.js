/**
 * PTY Manager — wraps node-pty IPty instances in a Map<id, session>.
 */
import { spawn as ptySpawn } from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
export class PtyManager extends EventEmitter {
    constructor() {
        super(...arguments);
        this.sessions = new Map();
    }
    spawn(opts) {
        var _a, _b, _c, _d, _e;
        const id = randomUUID();
        const shell = (_b = (_a = opts.shell) !== null && _a !== void 0 ? _a : process.env['SHELL']) !== null && _b !== void 0 ? _b : '/bin/zsh';
        const cols = (_c = opts.cols) !== null && _c !== void 0 ? _c : 80;
        const rows = (_d = opts.rows) !== null && _d !== void 0 ? _d : 24;
        const pty = ptySpawn(shell, [], {
            name: 'xterm-256color',
            cols,
            rows,
            cwd: opts.cwd,
            env: Object.assign(Object.assign({}, process.env), ((_e = opts.env) !== null && _e !== void 0 ? _e : {})),
        });
        const session = { id, pty, cwd: opts.cwd, shell, createdAt: new Date() };
        this.sessions.set(id, session);
        pty.onData((data) => {
            this.emit('data', id, data);
        });
        pty.onExit(({ exitCode, signal }) => {
            this.sessions.delete(id);
            this.emit('exit', id, exitCode, signal);
        });
        return id;
    }
    write(id, data) {
        const session = this.sessions.get(id);
        if (!session)
            throw new Error(`PTY ${id} not found`);
        session.pty.write(data);
    }
    resize(id, cols, rows) {
        const session = this.sessions.get(id);
        if (!session)
            throw new Error(`PTY ${id} not found`);
        session.pty.resize(cols, rows);
    }
    kill(id) {
        const session = this.sessions.get(id);
        if (!session)
            return;
        try {
            session.pty.kill();
        }
        catch (_a) {
            /* already dead */
        }
        this.sessions.delete(id);
    }
    list() {
        return Array.from(this.sessions.values()).map((s) => ({
            id: s.id,
            cwd: s.cwd,
            shell: s.shell,
            createdAt: s.createdAt.toISOString(),
        }));
    }
    killAll() {
        for (const id of Array.from(this.sessions.keys())) {
            this.kill(id);
        }
    }
}

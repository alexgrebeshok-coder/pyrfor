/**
 * PTY Manager — wraps node-pty IPty instances in a Map<id, session>.
 */
import { spawn as ptySpawn } from 'node-pty';
import type { IPty } from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

export interface PtySession {
  id: string;
  pty: IPty;
  cwd: string;
  shell: string;
  createdAt: Date;
}

export interface SpawnOptions {
  cwd: string;
  shell?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export class PtyManager extends EventEmitter {
  private sessions = new Map<string, PtySession>();

  spawn(opts: SpawnOptions): string {
    const id = randomUUID();
    const shell = opts.shell ?? process.env['SHELL'] ?? '/bin/zsh';
    const cols = opts.cols ?? 80;
    const rows = opts.rows ?? 24;

    const pty = ptySpawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: opts.cwd,
      env: { ...(process.env as Record<string, string>), ...(opts.env ?? {}) },
    });

    const session: PtySession = { id, pty, cwd: opts.cwd, shell, createdAt: new Date() };
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

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`PTY ${id} not found`);
    session.pty.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`PTY ${id} not found`);
    session.pty.resize(cols, rows);
  }

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.kill();
    } catch {
      /* already dead */
    }
    this.sessions.delete(id);
  }

  list(): Array<{ id: string; cwd: string; shell: string; createdAt: string }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cwd: s.cwd,
      shell: s.shell,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  killAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.kill(id);
    }
  }
}

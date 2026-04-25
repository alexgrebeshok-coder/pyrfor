import type { IPty } from 'node-pty';
import { EventEmitter } from 'events';
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
export declare class PtyManager extends EventEmitter {
    private sessions;
    spawn(opts: SpawnOptions): string;
    write(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    kill(id: string): void;
    list(): Array<{
        id: string;
        cwd: string;
        shell: string;
        createdAt: string;
    }>;
    killAll(): void;
}
//# sourceMappingURL=manager.d.ts.map
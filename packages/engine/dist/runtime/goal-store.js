import { mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
function ulid() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let t = Date.now();
    const ts = new Array(10);
    for (let i = 9; i >= 0; i--) {
        ts[i] = chars[t & 31];
        t = Math.floor(t / 32);
    }
    const rand = new Array(16);
    for (let i = 0; i < 16; i++)
        rand[i] = chars[Math.floor(Math.random() * 32)];
    return ts.join('') + rand.join('');
}
export class GoalStore {
    constructor(dir) {
        const d = dir !== null && dir !== void 0 ? dir : path.join(homedir(), '.pyrfor');
        mkdirSync(d, { recursive: true });
        this.filePath = path.join(d, 'goals.jsonl');
    }
    readAll() {
        if (!existsSync(this.filePath))
            return [];
        const lines = readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
        return lines.map((l) => JSON.parse(l));
    }
    writeAll(goals) {
        writeFileSync(this.filePath, goals.map((g) => JSON.stringify(g)).join('\n') + '\n', 'utf-8');
    }
    create(description) {
        const goal = {
            id: ulid(),
            description,
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        appendFileSync(this.filePath, JSON.stringify(goal) + '\n', 'utf-8');
        return goal;
    }
    list(status) {
        const all = this.readAll();
        return status ? all.filter((g) => g.status === status) : all;
    }
    get(id) {
        return this.readAll().find((g) => g.id === id);
    }
    updateStatus(id, status) {
        const goals = this.readAll();
        const idx = goals.findIndex((g) => g.id === id);
        if (idx === -1)
            return null;
        goals[idx] = Object.assign(Object.assign({}, goals[idx]), { status, updatedAt: new Date().toISOString() });
        this.writeAll(goals);
        return goals[idx];
    }
    markDone(id) {
        return this.updateStatus(id, 'done');
    }
    cancel(id) {
        return this.updateStatus(id, 'cancelled');
    }
}

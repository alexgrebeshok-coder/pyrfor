import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
export class JsonlToolRegistry {
    constructor(dir) {
        const root = dir !== null && dir !== void 0 ? dir : path.join(homedir(), '.pyrfor');
        mkdirSync(root, { recursive: true });
        this.filePath = path.join(root, 'tool-registry.jsonl');
    }
    register(input) {
        return this.registerWithDisposition(input).entry;
    }
    registerWithDisposition(input) {
        var _a, _b, _c;
        const all = this.readAll();
        const existing = all.find((entry) => entry.contentHash === input.contentHash);
        if (existing)
            return { entry: existing, created: false };
        const now = new Date().toISOString();
        const version = nextVersion(input.name, all);
        const status = (_a = input.status) !== null && _a !== void 0 ? _a : 'pending_validation';
        const entry = Object.assign(Object.assign({}, input), { id: makeId(), status,
            version, trustHistory: (_b = input.trustHistory) !== null && _b !== void 0 ? _b : [], failureScore: clampFailureScore((_c = input.failureScore) !== null && _c !== void 0 ? _c : 0), createdAt: now, updatedAt: now, tags: [...input.tags] });
        this.writeAll([...all, entry]);
        return { entry, created: true };
    }
    find(query = {}) {
        var _a, _b;
        const needle = (_a = query.q) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
        return this.readAll()
            .filter((entry) => query.kind === undefined || entry.kind === query.kind)
            .filter((entry) => {
            if (query.status === undefined)
                return true;
            if (query.status === 'active')
                return entry.status !== 'retired';
            return entry.status === query.status;
        })
            .filter((entry) => query.tags === undefined || query.tags.every((tag) => entry.tags.includes(tag)))
            .filter((entry) => {
            if (!needle)
                return true;
            const haystack = [
                entry.name,
                entry.capability.description,
                ...entry.capability.triggers,
            ].join(' ').toLowerCase();
            return haystack.includes(needle);
        })
            .slice(0, (_b = query.limit) !== null && _b !== void 0 ? _b : Number.POSITIVE_INFINITY);
    }
    get(id) {
        return this.readAll().find((entry) => entry.id === id);
    }
    getByName(name) {
        return this.readAll()
            .filter((entry) => entry.name === name)
            .sort((a, b) => b.version - a.version)[0];
    }
    retire(id, reason = 'retired') {
        const all = this.readAll();
        const index = all.findIndex((entry) => entry.id === id);
        if (index < 0)
            return undefined;
        const current = all[index];
        if (current.status === 'retired')
            return current;
        const now = new Date().toISOString();
        const updated = Object.assign(Object.assign({}, current), { status: 'retired', updatedAt: now, retiredAt: now, trustHistory: [
                ...current.trustHistory,
                { at: now, from: current.status, to: 'retired', reason },
            ] });
        all[index] = updated;
        this.writeAll(all);
        return updated;
    }
    loadAll() {
        return this.readAll();
    }
    readAll() {
        if (!existsSync(this.filePath))
            return [];
        const content = readFileSync(this.filePath, 'utf8');
        return content
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    }
    writeAll(entries) {
        const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
        const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
        writeFileSync(tmpPath, content ? `${content}\n` : '', 'utf8');
        renameSync(tmpPath, this.filePath);
    }
}
export function createToolRegistry(dir) {
    return new JsonlToolRegistry(dir);
}
function nextVersion(name, entries) {
    const versions = entries.filter((entry) => entry.name === name).map((entry) => entry.version);
    return versions.length === 0 ? 1 : Math.max(...versions) + 1;
}
function clampFailureScore(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function makeId() {
    const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let time = Date.now();
    const ts = new Array(10);
    for (let i = 9; i >= 0; i -= 1) {
        ts[i] = chars[time & 31];
        time = Math.floor(time / 32);
    }
    const rand = new Array(16);
    for (let i = 0; i < 16; i += 1)
        rand[i] = chars[Math.floor(Math.random() * 32)];
    return `${ts.join('')}${rand.join('')}`;
}

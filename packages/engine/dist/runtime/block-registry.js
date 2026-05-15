export class BlockRegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BlockRegistryError';
    }
}
export class BlockRegistry {
    constructor() {
        this.entries = new Map();
    }
    register(entry) {
        if (this.entries.has(entry.blockId)) {
            throw new BlockRegistryError(`BlockRegistry: duplicate block id "${entry.blockId}"`);
        }
        this.entries.set(entry.blockId, normalizeEntry(entry));
    }
    get(blockId) {
        const entry = this.entries.get(blockId);
        return entry ? normalizeEntry(entry) : undefined;
    }
    list(options = {}) {
        return [...this.entries.values()]
            .filter((entry) => options.status === undefined || entry.status === options.status)
            .map((entry) => normalizeEntry(entry));
    }
    updateStatus(blockId, status, error) {
        const entry = this.entries.get(blockId);
        if (!entry)
            throw new BlockRegistryError(`BlockRegistry: unknown block id "${blockId}"`);
        this.entries.set(blockId, normalizeEntry(Object.assign(Object.assign(Object.assign({}, entry), { status }), (error !== undefined ? { error } : {}))));
    }
    unregister(blockId) {
        return this.entries.delete(blockId);
    }
    size() {
        return this.entries.size;
    }
}
function normalizeEntry(entry) {
    var _a;
    return Object.assign(Object.assign({}, entry), { blockId: entry.blockId || entry.manifest.id, version: (_a = entry.version) !== null && _a !== void 0 ? _a : entry.manifest.version });
}

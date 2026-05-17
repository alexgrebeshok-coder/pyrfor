export class BlockRegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BlockRegistryError';
    }
}
const LOCAL_BLOCK_SCOPE_KEY = '\u0000local';
export class BlockRegistry {
    constructor() {
        this.entries = new Map();
    }
    register(entry) {
        const normalized = normalizeEntry(entry);
        const registryKey = toRegistryKey(normalized.blockId, normalized.projectId);
        if (this.entries.has(registryKey)) {
            throw new BlockRegistryError(`BlockRegistry: duplicate block id "${normalized.blockId}"${normalized.projectId ? ` for project "${normalized.projectId}"` : ''}`);
        }
        this.entries.set(registryKey, normalized);
    }
    get(blockId, projectId) {
        const entry = this.entries.get(toRegistryKey(blockId, projectId));
        return entry ? normalizeEntry(entry) : undefined;
    }
    list(options = {}) {
        return [...this.entries.values()]
            .filter((entry) => (options.status === undefined || entry.status === options.status) &&
            (options.projectId === undefined || entry.projectId === options.projectId))
            .map((entry) => normalizeEntry(entry));
    }
    updateStatus(blockId, status, error, projectId) {
        const registryKey = toRegistryKey(blockId, projectId);
        const entry = this.entries.get(registryKey);
        if (!entry) {
            throw new BlockRegistryError(`BlockRegistry: unknown block id "${blockId}"${projectId ? ` for project "${projectId}"` : ''}`);
        }
        this.entries.set(registryKey, normalizeEntry(Object.assign(Object.assign(Object.assign({}, entry), { status }), (error !== undefined ? { error } : {}))));
    }
    unregister(blockId, projectId) {
        return this.entries.delete(toRegistryKey(blockId, projectId));
    }
    size() {
        return this.entries.size;
    }
}
function normalizeEntry(entry) {
    var _a;
    return Object.assign(Object.assign(Object.assign(Object.assign({}, entry), { blockId: entry.blockId || entry.manifest.id }), (entry.projectId ? { projectId: entry.projectId } : {})), { version: (_a = entry.version) !== null && _a !== void 0 ? _a : entry.manifest.version });
}
function toRegistryKey(blockId, projectId) {
    return `${projectId !== null && projectId !== void 0 ? projectId : LOCAL_BLOCK_SCOPE_KEY}::${blockId}`;
}

export class ContractRegistryError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ContractRegistryError';
    }
}
const CONTRACT_REF_RE = /^([A-Z][A-Za-z0-9]*)@([1-9]\d*)$/;
export function parseContractRef(ref) {
    const match = CONTRACT_REF_RE.exec(ref);
    if (!match)
        return null;
    const major = Number(match[2]);
    if (!Number.isSafeInteger(major) || major < 1)
        return null;
    return { ref, name: match[1], major };
}
export class ContractRegistry {
    constructor() {
        this.entries = new Map();
    }
    register(entry) {
        var _a;
        const parsed = parseContractRef(entry.ref);
        if (!parsed)
            throw new ContractRegistryError(`ContractRegistry: invalid contract ref "${entry.ref}"`);
        const normalized = Object.assign(Object.assign({}, entry), { ref: parsed.ref, name: parsed.name, major: parsed.major });
        const entryKey = contractEntryKey(normalized);
        const bucket = (_a = this.entries.get(parsed.ref)) !== null && _a !== void 0 ? _a : new Map();
        if (bucket.has(entryKey)) {
            throw new ContractRegistryError(`ContractRegistry: duplicate contract ref "${parsed.ref}" for block "${normalized.blockId}" (${normalized.direction})`);
        }
        const stored = cloneContractRegistryEntry(normalized);
        bucket.set(entryKey, stored);
        this.entries.set(parsed.ref, bucket);
        return cloneContractRegistryEntry(stored);
    }
    get(ref, options = {}) {
        const parsed = parseContractRef(ref);
        if (!parsed)
            return undefined;
        const entry = this.findEntries(Object.assign({ ref: parsed.ref }, options))[0];
        return entry ? cloneContractRegistryEntry(entry) : undefined;
    }
    has(ref, options = {}) {
        return this.get(ref, options) !== undefined;
    }
    list(options = {}) {
        return this.findEntries(options)
            .map((entry) => cloneContractRegistryEntry(entry));
    }
    size() {
        return [...this.entries.values()].reduce((count, bucket) => count + bucket.size, 0);
    }
    findEntries(options) {
        const refs = options.ref ? [options.ref] : [...this.entries.keys()];
        const entries = [];
        for (const ref of refs) {
            const bucket = this.entries.get(ref);
            if (!bucket)
                continue;
            for (const entry of bucket.values()) {
                if (options.direction !== undefined && entry.direction !== options.direction)
                    continue;
                if (options.blockId !== undefined && entry.blockId !== options.blockId)
                    continue;
                entries.push(entry);
            }
        }
        return entries;
    }
}
function contractEntryKey(entry) {
    return `${entry.blockId}\u0000${entry.direction}`;
}
function cloneContractRegistryEntry(entry) {
    return Object.assign(Object.assign(Object.assign({}, entry), (entry.schema ? { schema: Object.assign({}, entry.schema) } : {})), (entry.provenance
        ? {
            provenance: Object.assign(Object.assign({}, entry.provenance), (entry.provenance.manifestRef ? { manifestRef: cloneArtifactRef(entry.provenance.manifestRef) } : {})),
        }
        : {}));
}
function cloneArtifactRef(ref) {
    return Object.assign(Object.assign({}, ref), (ref.meta ? { meta: cloneUnknown(ref.meta) } : {}));
}
function cloneUnknown(value) {
    return structuredClone(value);
}

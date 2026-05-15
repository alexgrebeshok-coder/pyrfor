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
        const parsed = parseContractRef(entry.ref);
        if (!parsed)
            throw new ContractRegistryError(`ContractRegistry: invalid contract ref "${entry.ref}"`);
        if (this.entries.has(parsed.ref))
            throw new ContractRegistryError(`ContractRegistry: duplicate contract ref "${parsed.ref}"`);
        const normalized = Object.assign(Object.assign({}, entry), { ref: parsed.ref, name: parsed.name, major: parsed.major });
        this.entries.set(parsed.ref, normalized);
        return Object.assign({}, normalized);
    }
    get(ref) {
        const parsed = parseContractRef(ref);
        if (!parsed)
            return undefined;
        const entry = this.entries.get(parsed.ref);
        return entry ? Object.assign({}, entry) : undefined;
    }
    has(ref) {
        return this.get(ref) !== undefined;
    }
    list(options = {}) {
        return [...this.entries.values()]
            .filter((entry) => options.direction === undefined || entry.direction === options.direction)
            .filter((entry) => options.blockId === undefined || entry.blockId === options.blockId)
            .map((entry) => (Object.assign({}, entry)));
    }
    size() {
        return this.entries.size;
    }
}

import { createHash } from 'node:crypto';
function normalizeStable(value) {
    if (value === null)
        return null;
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value))
        return value.map((item) => normalizeStable(item));
    const kind = typeof value;
    if (kind === 'string' || kind === 'number' || kind === 'boolean')
        return value;
    if (kind === 'undefined' || kind === 'function' || kind === 'symbol' || kind === 'bigint')
        return null;
    if (kind === 'object') {
        const object = value;
        const result = {};
        for (const key of Object.keys(object).sort()) {
            const normalized = normalizeStable(object[key]);
            if (normalized !== null || object[key] === null)
                result[key] = normalized;
        }
        return result;
    }
    return null;
}
export function stableStringify(value) {
    return JSON.stringify(normalizeStable(value));
}
export function hashContextPack(pack) {
    return createHash('sha256').update(stableStringify(pack)).digest('hex');
}
export function withContextPackHash(pack) {
    return Object.assign(Object.assign({}, pack), { hash: hashContextPack(pack) });
}

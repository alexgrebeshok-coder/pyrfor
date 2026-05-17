export class BlockMemoryNamespaceError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BlockMemoryNamespaceError';
    }
}
const TABLE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
export function resolveBlockMemoryScopes(manifest, projectId) {
    var _a;
    const result = new Map();
    const memoryScope = manifest.memory_scope;
    if (!memoryScope)
        return result;
    for (const tier of ['project_shared', 'block_private', 'global_shared']) {
        for (const tableName of (_a = memoryScope[tier]) !== null && _a !== void 0 ? _a : []) {
            const scope = scopeStringFor(tier, tableName, manifest.id, projectId, manifest.runtime.mode);
            result.set(`${tier}:${tableName}`, { tableName, tier, scope });
        }
    }
    return result;
}
export function scopeStringFor(tier, tableName, blockId, projectId, runtimeMode) {
    assertTableName(tableName);
    if (tier === 'project_shared') {
        if (!projectId)
            throw new BlockMemoryNamespaceError('project_shared memory scope requires projectId');
        return `prj:${projectId}:shared:${tableName}`;
    }
    if (tier === 'block_private')
        return `blk:${blockId}:private:${tableName}`;
    if (runtimeMode !== 'trusted-core')
        throw new BlockMemoryNamespaceError('global_shared memory scope requires trusted-core runtime');
    return `global:shared:${tableName}`;
}
export function hasMemoryCapabilityForTier(manifest, tier, access) {
    const expectedScope = tier === 'project_shared' ? 'project' : tier === 'block_private' ? 'block' : 'global';
    return manifest.capabilities.some((capability) => capability.token === `memory:${access}` && capability.scope === expectedScope);
}
export function isValidMemoryTableName(tableName) {
    return TABLE_NAME_RE.test(tableName);
}
function assertTableName(tableName) {
    if (!isValidMemoryTableName(tableName)) {
        throw new BlockMemoryNamespaceError(`invalid memory table name "${tableName}"`);
    }
}

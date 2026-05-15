/**
 * Durable persistence for the block catalog (registry entries + manifests).
 *
 * Design:
 * - One small JSON file: `<orchestrationDir>/block-catalog.json`
 * - Serializes every BlockRegistryEntry verbatim (manifest included) so
 *   hydration never needs to touch the filesystem or run any lifecycle code.
 * - memoryScopeMap is persisted as an array of [key, value] pairs so it
 *   round-trips through JSON without loss.
 * - On hydration, entries are injected directly into the BlockRegistry.
 *   Capability tools and contracts are rebuilt from the stored manifests.
 * - Safety invariants preserved:
 *   - no lifecycle/entrypoint execution
 *   - revoked stays revoked
 *   - no signing verification
 *   - no cloud behaviour
 */
import { existsSync, mkdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BlockRegistryError, } from './block-registry.js';
import { ContractRegistryError } from './contract-registry.js';
import { deriveSideEffect } from './block-loader.js';
// ── Store ─────────────────────────────────────────────────────────────────────
export class BlockCatalogStore {
    constructor(filePath) {
        this.filePath = filePath;
    }
    /**
     * Write the current block registry state to disk atomically.
     */
    flush(registry) {
        const blocks = registry.list().map(serializeEntry);
        const snapshot = {
            version: 1,
            savedAt: new Date().toISOString(),
            blocks,
        };
        const dir = dirname(this.filePath);
        mkdirSync(dir, { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
        renameSync(tmp, this.filePath);
    }
    /**
     * Hydrate a BlockRegistry (and optionally capability-tool / contract
     * registries) from the persisted catalog.
     *
     * Safe: does not execute lifecycle hooks, entrypoints, or perform signing
     * verification.  Revoked blocks are restored with status `revoked`.
     * Capability tools and contracts are rebuilt from stored manifest data.
     */
    hydrate(registry, options = {}) {
        var _a;
        if (!existsSync(this.filePath)) {
            return { restored: 0, skipped: 0, warnings: [] };
        }
        let snapshot;
        try {
            const raw = readFileSync(this.filePath, 'utf8');
            snapshot = JSON.parse(raw);
        }
        catch (_b) {
            return { restored: 0, skipped: 0, warnings: [`block-catalog: failed to read ${this.filePath}`] };
        }
        if (!isValidSnapshot(snapshot)) {
            return { restored: 0, skipped: 0, warnings: [`block-catalog: unrecognised snapshot format in ${this.filePath}`] };
        }
        let restored = 0;
        let skipped = 0;
        const warnings = [];
        for (const persisted of snapshot.blocks) {
            try {
                const entry = deserializeEntry(persisted);
                registry.register(entry);
                if (entry.status !== 'revoked') {
                    rebuildCapabilityTools(options.capabilityToolRegistry, entry.manifest);
                    rebuildContracts(options.contractRegistry, entry.manifest, (_a = entry.manifestPath) !== null && _a !== void 0 ? _a : '', warnings, entry.manifestRef);
                }
                restored++;
            }
            catch (err) {
                if (err instanceof BlockRegistryError) {
                    // Duplicate – already registered (e.g. loaded programmatically before hydration)
                    skipped++;
                    continue;
                }
                warnings.push(`block-catalog: failed to restore ${persisted.blockId}: ${err instanceof Error ? err.message : String(err)}`);
                skipped++;
            }
        }
        return { restored, skipped, warnings };
    }
    /** Path to the catalog file (useful for logging). */
    get path() {
        return this.filePath;
    }
}
// ── Serialisation helpers ─────────────────────────────────────────────────────
function serializeEntry(entry) {
    const out = {
        blockId: entry.blockId,
        status: entry.status,
        registeredAt: entry.registeredAt,
        manifest: entry.manifest,
    };
    if (entry.projectId !== undefined)
        out.projectId = entry.projectId;
    if (entry.version !== undefined)
        out.version = entry.version;
    if (entry.rootDir !== undefined)
        out.rootDir = entry.rootDir;
    if (entry.manifestPath !== undefined)
        out.manifestPath = entry.manifestPath;
    if (entry.dataDir !== undefined)
        out.dataDir = entry.dataDir;
    if (entry.manifestRef !== undefined)
        out.manifestRef = entry.manifestRef;
    if (entry.error !== undefined)
        out.error = entry.error;
    if (entry.memoryScopeMap && entry.memoryScopeMap.size > 0) {
        out.memoryScopeMap = [...entry.memoryScopeMap.entries()].map(([k, v]) => [k, { tier: v.tier, tableName: v.tableName, scope: v.scope }]);
    }
    return out;
}
function deserializeEntry(p) {
    let memoryScopeMap;
    if (p.memoryScopeMap && p.memoryScopeMap.length > 0) {
        memoryScopeMap = new Map(p.memoryScopeMap.map(([k, v]) => [
            k,
            { tier: v.tier, tableName: v.tableName, scope: v.scope },
        ]));
    }
    const entry = {
        blockId: p.blockId,
        manifest: p.manifest,
        status: p.status,
        registeredAt: p.registeredAt,
    };
    if (p.projectId !== undefined)
        entry.projectId = p.projectId;
    if (p.version !== undefined)
        entry.version = p.version;
    if (p.rootDir !== undefined)
        entry.rootDir = p.rootDir;
    if (p.manifestPath !== undefined)
        entry.manifestPath = p.manifestPath;
    if (p.dataDir !== undefined)
        entry.dataDir = p.dataDir;
    if (p.manifestRef !== undefined)
        entry.manifestRef = p.manifestRef;
    if (p.error !== undefined)
        entry.error = p.error;
    if (memoryScopeMap !== undefined)
        entry.memoryScopeMap = memoryScopeMap;
    return entry;
}
function isValidSnapshot(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value['version'] === 1 &&
        Array.isArray(value['blocks']));
}
// ── Registry rebuilders (no execution, no validation) ─────────────────────────
function rebuildCapabilityTools(toolRegistry, manifest) {
    if (!toolRegistry)
        return;
    for (const capability of manifest.capabilities) {
        const name = `block:${manifest.id}:${capability.token}`;
        if (toolRegistry.get(name))
            continue;
        toolRegistry.register(toToolSpec(name, capability.token, capability.reason, manifest.security.sandbox));
    }
}
function rebuildContracts(contractRegistry, manifest, manifestPath, warnings, manifestRef) {
    if (!contractRegistry)
        return;
    for (const direction of ['consumes', 'produces']) {
        for (const contract of manifest.contracts[direction]) {
            if (contractRegistry.get(contract.ref, { blockId: manifest.id, direction }))
                continue;
            try {
                const entryInput = Object.assign(Object.assign({ ref: contract.ref, blockId: manifest.id, direction, registeredAt: new Date().toISOString() }, (contract.from ? { from: contract.from } : {})), (contract.optional !== undefined ? { optional: contract.optional } : {}));
                if (direction === 'produces') {
                    const producedContract = contract;
                    if (producedContract.schema)
                        entryInput.schema = Object.assign({}, producedContract.schema);
                    entryInput.provenance = Object.assign({ source: 'block-manifest', manifestPath, blockVersion: manifest.version }, (manifestRef ? { manifestRef } : {}));
                }
                contractRegistry.register(entryInput);
            }
            catch (err) {
                if (err instanceof ContractRegistryError) {
                    warnings.push(`contracts.${direction}.${contract.ref}: ${err.message}`);
                }
                else {
                    throw err;
                }
            }
        }
    }
}
function toToolSpec(name, token, reason, sandbox) {
    const sideEffect = deriveSideEffect(token);
    return {
        name,
        description: reason,
        inputSchema: {},
        outputSchema: {},
        sideEffect,
        defaultPermission: 'ask_once',
        timeoutMs: 30000,
        sandbox,
        idempotent: sideEffect === 'read',
        requiresApproval: sideEffect !== 'read',
    };
}

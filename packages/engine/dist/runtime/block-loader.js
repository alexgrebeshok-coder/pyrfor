var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadBlockManifest, validateBlockPackage } from './block-manifest.js';
import { BlockRegistry, BlockRegistryError } from './block-registry.js';
export function loadBlock(blockPath_1) {
    return __awaiter(this, arguments, void 0, function* (blockPath, options = {}) {
        var _a, _b, _c, _d;
        const report = yield validateBlockPackage(blockPath);
        const warnings = report.warnings.map((warning) => `${warning.path}: ${warning.message}`);
        const blockId = (_a = report.summary.id) !== null && _a !== void 0 ? _a : 'unknown';
        if (report.status !== 'valid' || !report.manifest) {
            const error = report.errors[0] ? `${report.errors[0].path}: ${report.errors[0].message}` : 'block manifest validation failed';
            const resultRef = yield writeLoadResultArtifact(options, { ok: false, blockId, status: 'error', error, warnings, report });
            yield appendBlockEvent(options, 'block.error', blockId, { status: 'error', error, warnings, resultRef });
            return { ok: false, blockId, status: 'error', report, resultRef, error, warnings, registeredCapabilityTools: [] };
        }
        const registry = (_b = options.registry) !== null && _b !== void 0 ? _b : new BlockRegistry();
        const loaded = yield loadBlockManifest(blockPath);
        const manifestRef = yield writeManifestArtifact(options, loaded.manifest);
        const dataDir = path.join((_c = options.dataRootDir) !== null && _c !== void 0 ? _c : path.join(tmpdir(), 'pyrfor-blocks'), sanitizeBlockId(loaded.manifest.id));
        yield mkdir(dataDir, { recursive: true });
        const entry = Object.assign({ blockId: loaded.manifest.id, version: loaded.manifest.version, manifest: loaded.manifest, status: 'inactive', registeredAt: new Date().toISOString(), rootDir: loaded.rootDir, manifestPath: loaded.manifestPath, dataDir }, (manifestRef ? { manifestRef } : {}));
        try {
            registry.register(entry);
        }
        catch (err) {
            const error = err instanceof BlockRegistryError ? err.message : formatError(err);
            const resultRef = yield writeLoadResultArtifact(options, {
                ok: false,
                blockId: loaded.manifest.id,
                status: 'error',
                version: loaded.manifest.version,
                error,
                warnings,
                manifestRef,
                report,
            });
            yield appendBlockEvent(options, 'block.error', loaded.manifest.id, {
                status: 'error',
                version: loaded.manifest.version,
                error,
                warnings,
                manifestRef,
                resultRef,
            });
            return {
                ok: false,
                blockId: loaded.manifest.id,
                status: 'error',
                manifest: loaded.manifest,
                report,
                manifestRef,
                resultRef,
                error,
                warnings,
                registeredCapabilityTools: [],
            };
        }
        const registeredCapabilityTools = registerCapabilityTools(options.toolRegistry, loaded.manifest);
        const resultRef = yield writeLoadResultArtifact(options, {
            ok: true,
            blockId: loaded.manifest.id,
            status: 'inactive',
            version: loaded.manifest.version,
            warnings,
            manifestRef,
            registeredCapabilityTools,
            report,
        });
        yield appendBlockEvent(options, 'block.loaded', loaded.manifest.id, {
            status: 'inactive',
            version: loaded.manifest.version,
            manifestRef,
            resultRef,
            warnings,
            registeredCapabilityTools,
        });
        return {
            ok: true,
            blockId: loaded.manifest.id,
            status: 'inactive',
            manifest: loaded.manifest,
            entry: (_d = registry.get(loaded.manifest.id)) !== null && _d !== void 0 ? _d : entry,
            report,
            manifestRef,
            resultRef,
            warnings,
            registeredCapabilityTools,
        };
    });
}
export function activateBlock(blockId_1, registry_1) {
    return __awaiter(this, arguments, void 0, function* (blockId, registry, options = {}) {
        var _a;
        const entry = registry.get(blockId);
        if (!entry)
            return blockStatusFailure(blockId, 'unknown block id');
        registry.updateStatus(blockId, 'active');
        const updated = registry.get(blockId);
        yield appendBlockEvent(options, 'block.activated', blockId, {
            status: 'active',
            version: entry.version,
            manifestRef: entry.manifestRef,
        });
        return {
            ok: true,
            blockId,
            status: 'active',
            manifest: (_a = updated === null || updated === void 0 ? void 0 : updated.manifest) !== null && _a !== void 0 ? _a : entry.manifest,
            entry: updated,
            warnings: [],
            registeredCapabilityTools: [],
        };
    });
}
export function deactivateBlock(blockId_1, registry_1) {
    return __awaiter(this, arguments, void 0, function* (blockId, registry, options = {}) {
        var _a;
        const entry = registry.get(blockId);
        if (!entry)
            return blockStatusFailure(blockId, 'unknown block id');
        registry.updateStatus(blockId, 'inactive');
        const updated = registry.get(blockId);
        yield appendBlockEvent(options, 'block.deactivated', blockId, {
            status: 'inactive',
            version: entry.version,
            manifestRef: entry.manifestRef,
        });
        return {
            ok: true,
            blockId,
            status: 'inactive',
            manifest: (_a = updated === null || updated === void 0 ? void 0 : updated.manifest) !== null && _a !== void 0 ? _a : entry.manifest,
            entry: updated,
            warnings: [],
            registeredCapabilityTools: [],
        };
    });
}
function writeManifestArtifact(options, manifest) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!options.artifactStore)
            return undefined;
        return options.artifactStore.writeJSON('block_manifest', manifest, {
            runId: options.runId,
            meta: { blockId: manifest.id, version: manifest.version },
        });
    });
}
function writeLoadResultArtifact(options, value) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (!options.artifactStore)
            return undefined;
        return options.artifactStore.writeJSON('block_load_result', value, {
            runId: options.runId,
            meta: { blockId: String((_a = value.blockId) !== null && _a !== void 0 ? _a : 'unknown'), status: String((_b = value.status) !== null && _b !== void 0 ? _b : 'unknown') },
        });
    });
}
function registerCapabilityTools(toolRegistry, manifest) {
    if (!toolRegistry)
        return [];
    const registered = [];
    for (const capability of manifest.capabilities) {
        const name = `block:${manifest.id}:${capability.token}`;
        if (toolRegistry.get(name))
            continue;
        toolRegistry.register(toToolSpec(name, capability.token, capability.reason, manifest.security.sandbox));
        registered.push(name);
    }
    return registered;
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
function deriveSideEffect(token) {
    if (/\b(delete|destroy|remove|rollback|uninstall)\b/.test(token))
        return 'destructive';
    if (/\b(exec|execute|spawn|process|run|install|activate|deactivate|upgrade)\b/.test(token))
        return 'execute';
    if (/\b(net|network|http|fetch|remote|mcp|a2a)\b/.test(token))
        return 'network';
    if (/\b(write|create|update|mutate|publish|propose|notify)\b/.test(token))
        return 'write';
    return 'read';
}
function appendBlockEvent(options, type, blockId, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!options.ledger)
            return;
        yield options.ledger.append(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ type, run_id: (_a = options.runId) !== null && _a !== void 0 ? _a : `block:${blockId}`, block_id: blockId, status: payload.status }, (payload.version ? { version: payload.version } : {})), (payload.error ? { error: payload.error } : {})), (payload.warnings ? { warnings: payload.warnings } : {})), (payload.manifestRef ? { manifest_ref: payload.manifestRef } : {})), (payload.resultRef ? { result_ref: payload.resultRef } : {})), (payload.registeredCapabilityTools ? { registered_capability_tools: payload.registeredCapabilityTools } : {})));
    });
}
function blockStatusFailure(blockId, error) {
    return { ok: false, blockId, status: 'error', error, warnings: [], registeredCapabilityTools: [] };
}
function sanitizeBlockId(blockId) {
    return blockId.replace(/[^a-zA-Z0-9._-]/g, '_');
}
function formatError(err) {
    return err instanceof Error ? err.message : String(err);
}

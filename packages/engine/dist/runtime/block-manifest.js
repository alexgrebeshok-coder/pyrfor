var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isValidMemoryTableName } from './block-memory-namespace.js';
export const BLOCK_MANIFEST_VERSION = '1';
export const BLOCK_MANIFEST_FILENAME = 'block.json';
export class BlockManifestError extends Error {
    constructor(message, code, manifestPath) {
        super(message);
        this.code = code;
        this.manifestPath = manifestPath;
        this.name = 'BlockManifestError';
    }
}
const RUNTIME_MODES = new Set(['trusted-core', 'local-worker', 'wasm', 'container', 'remote']);
const SANDBOXES = new Set(['none', 'process-isolated', 'wasm-wasi', 'container-oci']);
const PANEL_SLOTS = new Set(['left', 'center', 'right', 'bottom', 'modal', 'sidebar']);
const CERTIFICATION_STATES = new Set(['dev', 'internal', 'pilot', 'certified', 'revoked']);
const REQUIRED_NEVER_EDITABLE = ['id', 'version', 'capabilities', 'security', 'signing'];
const REQUIRED_HUMAN_APPROVAL = ['runtime', 'entrypoints', 'scripts'];
const SHA256_HEX_RE = /^[A-Fa-f0-9]{64}$/;
export function loadBlockManifest(inputPath) {
    return __awaiter(this, void 0, void 0, function* () {
        const resolved = path.resolve(inputPath);
        let manifestPath = resolved;
        let rootDir = path.dirname(resolved);
        const inputStat = yield stat(resolved).catch((err) => {
            throw new BlockManifestError(`block path is not readable: ${formatError(err)}`, 'block_path_unreadable', resolved);
        });
        if (inputStat.isDirectory()) {
            rootDir = resolved;
            manifestPath = path.join(resolved, BLOCK_MANIFEST_FILENAME);
        }
        let raw;
        try {
            raw = yield readFile(manifestPath, 'utf8');
        }
        catch (err) {
            throw new BlockManifestError(`cannot read ${BLOCK_MANIFEST_FILENAME}: ${formatError(err)}`, 'manifest_unreadable', manifestPath);
        }
        try {
            return { rootDir, manifestPath, manifest: JSON.parse(raw) };
        }
        catch (err) {
            throw new BlockManifestError(`invalid JSON in ${BLOCK_MANIFEST_FILENAME}: ${formatError(err)}`, 'manifest_invalid_json', manifestPath);
        }
    });
}
export function validateBlockPackage(inputPath) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        let loaded;
        try {
            loaded = yield loadBlockManifest(inputPath);
        }
        catch (err) {
            const loadIssue = issue('.', err instanceof BlockManifestError ? err.code : 'manifest_load_failed', formatError(err));
            return {
                status: 'invalid',
                rootDir: path.resolve(inputPath),
                manifestPath: err instanceof BlockManifestError && err.manifestPath ? err.manifestPath : path.join(path.resolve(inputPath), BLOCK_MANIFEST_FILENAME),
                errors: [loadIssue],
                warnings: [],
                summary: emptySummary(),
            };
        }
        const errors = [];
        const warnings = [];
        validateManifestShape(loaded.manifest, errors, warnings);
        yield validatePackageFiles(loaded.rootDir, loaded.manifest, errors, warnings);
        return {
            status: errors.length === 0 ? 'valid' : 'invalid',
            rootDir: loaded.rootDir,
            manifestPath: loaded.manifestPath,
            manifest: loaded.manifest,
            errors,
            warnings,
            summary: {
                id: stringValue(loaded.manifest.id),
                version: stringValue(loaded.manifest.version),
                capabilityCount: Array.isArray(loaded.manifest.capabilities) ? loaded.manifest.capabilities.length : 0,
                consumedContractCount: Array.isArray((_a = loaded.manifest.contracts) === null || _a === void 0 ? void 0 : _a.consumes) ? loaded.manifest.contracts.consumes.length : 0,
                producedContractCount: Array.isArray((_b = loaded.manifest.contracts) === null || _b === void 0 ? void 0 : _b.produces) ? loaded.manifest.contracts.produces.length : 0,
                panelCount: Array.isArray(loaded.manifest.panels) ? loaded.manifest.panels.length : 0,
                certificationState: isCertificationState((_c = loaded.manifest.certification) === null || _c === void 0 ? void 0 : _c.state) ? loaded.manifest.certification.state : undefined,
            },
        };
    });
}
function validateManifestShape(manifest, errors, warnings) {
    const root = manifest;
    if (!isRecord(root)) {
        errors.push(issue('.', 'manifest_not_object', 'block manifest must be a JSON object'));
        return;
    }
    requireEquals(root, 'pyrfor_manifest_version', BLOCK_MANIFEST_VERSION, errors);
    requirePattern(root, 'id', /^[a-z][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/, 'block id must be reverse-DNS lowercase identifier', errors);
    requireString(root, 'name', errors);
    requirePattern(root, 'version', /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'version must be SemVer (x.y.z)', errors);
    requireString(root, 'description', errors);
    requireString(root, 'author', errors);
    requireString(root, 'license', errors);
    const runtime = requireObject(root, 'runtime', errors);
    if (runtime) {
        requireEnum(runtime, 'mode', RUNTIME_MODES, errors);
        if (runtime.mode === 'trusted-core') {
            errors.push(issue('runtime.mode', 'trusted_core_reserved', 'runtime.mode "trusted-core" is reserved for first-party Engine components; external blocks must use local-worker, wasm, container, or remote'));
        }
        requireString(runtime, 'engine_version_range', errors);
        if ('node_version_range' in runtime)
            requireString(runtime, 'node_version_range', errors);
        requireEnum(runtime, 'sandbox', SANDBOXES, errors);
    }
    const entrypoints = requireObject(root, 'entrypoints', errors);
    if (entrypoints)
        requireString(entrypoints, 'main', errors);
    const scripts = requireObject(root, 'scripts', errors);
    if (scripts) {
        requireString(scripts, 'test', errors);
        for (const [name, command] of Object.entries(scripts)) {
            if (typeof command !== 'string' || command.trim() === '') {
                errors.push(issue(`scripts.${name}`, 'script_empty', `scripts.${name} must be a non-empty command string`));
            }
        }
    }
    validateCapabilities(root.capabilities, errors);
    validateContracts(root.contracts, errors);
    validateEvents(root.events, errors);
    validatePanels(root.panels, errors);
    validateStringArrayObject(root.memory_scope, 'memory_scope', ['project_shared', 'block_private', 'global_shared'], errors);
    validateMemoryScopeCapabilities(root.memory_scope, root.capabilities, errors, warnings);
    validateStringArray(root.artifact_types, 'artifact_types', errors, false);
    validateOptimizerPolicy(root.optimizer_policy, errors);
    validateSecurity(root.security, root.runtime, errors, warnings);
    validateSigning(root.signing, root.certification, errors, warnings);
    validateCertification(root.certification, errors);
}
function validatePackageFiles(rootDir, manifest, errors, warnings) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const packageJson = yield readPackageJson(rootDir, errors);
        const packageScripts = isRecord(packageJson === null || packageJson === void 0 ? void 0 : packageJson.scripts) ? packageJson.scripts : undefined;
        if (((_a = manifest.runtime) === null || _a === void 0 ? void 0 : _a.mode) === 'local-worker' && !packageJson) {
            errors.push(issue('package.json', 'package_json_required', 'local-worker blocks require package.json'));
        }
        if (packageScripts) {
            for (const scriptName of Object.keys((_b = manifest.scripts) !== null && _b !== void 0 ? _b : {})) {
                if (typeof packageScripts[scriptName] !== 'string' || !packageScripts[scriptName].trim()) {
                    errors.push(issue(`package.json.scripts.${scriptName}`, 'package_script_missing', `package.json must define scripts.${scriptName}`));
                }
            }
        }
        else if (manifest.scripts) {
            warnings.push(issue('package.json.scripts', 'package_scripts_unchecked', 'package scripts could not be checked because package.json is missing or invalid'));
        }
        if ((((_c = manifest.certification) === null || _c === void 0 ? void 0 : _c.state) === 'pilot' || ((_d = manifest.certification) === null || _d === void 0 ? void 0 : _d.state) === 'certified') && manifest.certification.sbom) {
            const sbomPath = path.join(rootDir, manifest.certification.sbom);
            const sbom = yield stat(sbomPath).catch(() => undefined);
            if (!(sbom === null || sbom === void 0 ? void 0 : sbom.isFile())) {
                errors.push(issue('certification.sbom', 'sbom_missing', `${manifest.certification.state} blocks require an existing sbom file`));
            }
        }
    });
}
function validateCapabilities(value, errors) {
    if (!Array.isArray(value)) {
        errors.push(issue('capabilities', 'capabilities_required', 'capabilities must be an array'));
        return;
    }
    const seen = new Set();
    for (const [index, item] of value.entries()) {
        const pathPrefix = `capabilities.${index}`;
        if (!isRecord(item)) {
            errors.push(issue(pathPrefix, 'capability_not_object', 'capability must be an object'));
            continue;
        }
        const token = requireString(item, 'token', errors, pathPrefix);
        requireString(item, 'reason', errors, pathPrefix);
        if (token) {
            if (token.includes('*'))
                errors.push(issue(`${pathPrefix}.token`, 'capability_wildcard', 'capability tokens must not contain wildcards'));
            if (!/^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)+$/.test(token)) {
                errors.push(issue(`${pathPrefix}.token`, 'capability_token_invalid', 'capability token must use lowercase namespace:action syntax'));
            }
            if (seen.has(token))
                errors.push(issue(`${pathPrefix}.token`, 'capability_duplicate', `duplicate capability token: ${token}`));
            seen.add(token);
        }
    }
}
function validateContracts(value, errors) {
    const contracts = requireObject({ contracts: value }, 'contracts', errors);
    if (!contracts)
        return;
    validateContractRefs(contracts.consumes, 'contracts.consumes', errors);
    validateContractRefs(contracts.produces, 'contracts.produces', errors, { allowSchema: true });
}
function validateContractRefs(value, pathPrefix, errors, options = {}) {
    if (!Array.isArray(value)) {
        errors.push(issue(pathPrefix, 'contract_refs_required', `${pathPrefix} must be an array`));
        return;
    }
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)) {
            errors.push(issue(`${pathPrefix}.${index}`, 'contract_ref_not_object', 'contract reference must be an object'));
            continue;
        }
        requirePattern(item, 'ref', /^[A-Z][A-Za-z0-9]*@[1-9]\d*$/, 'contract ref must match <Name>@<major>', errors, `${pathPrefix}.${index}`);
        if ('from' in item)
            requireString(item, 'from', errors, `${pathPrefix}.${index}`);
        if ('optional' in item)
            requireBoolean(item, 'optional', errors, `${pathPrefix}.${index}`);
        if (options.allowSchema && 'schema' in item)
            validateContractSchema(item.schema, `${pathPrefix}.${index}.schema`, errors);
    }
}
function validateContractSchema(value, pathPrefix, errors) {
    const schema = requireObject({ [pathPrefix]: value }, pathPrefix, errors);
    if (!schema)
        return;
    const pathValue = 'path' in schema ? requireString(schema, 'path', errors, pathPrefix) : undefined;
    const uriValue = 'uri' in schema ? requireString(schema, 'uri', errors, pathPrefix) : undefined;
    if ('mediaType' in schema)
        requireString(schema, 'mediaType', errors, pathPrefix);
    if ('sha256' in schema) {
        const sha256 = requireString(schema, 'sha256', errors, pathPrefix);
        if (sha256 && !SHA256_HEX_RE.test(sha256)) {
            errors.push(issue(`${pathPrefix}.sha256`, 'sha256_invalid', `${pathPrefix}.sha256 must be a 64-character hex SHA-256 digest`));
        }
    }
    if ('validate' in schema)
        requireBoolean(schema, 'validate', errors, pathPrefix);
    if (!('path' in schema) && !('uri' in schema)) {
        errors.push(issue(pathPrefix, 'contract_schema_location_required', `${pathPrefix} must include at least one of path or uri`));
    }
}
function validateEvents(value, errors) {
    if (value === undefined)
        return;
    const events = requireObject({ events: value }, 'events', errors);
    if (!events)
        return;
    validateEventArray(events.publishes, 'events.publishes', errors);
    validateEventArray(events.subscribes, 'events.subscribes', errors);
}
function validateEventArray(value, pathPrefix, errors) {
    if (value === undefined)
        return;
    if (!Array.isArray(value)) {
        errors.push(issue(pathPrefix, 'events_array_required', `${pathPrefix} must be an array`));
        return;
    }
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string' || !/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){1,}$/.test(item)) {
            errors.push(issue(`${pathPrefix}.${index}`, 'event_name_invalid', 'event names must use dot-separated lowercase syntax'));
        }
    }
}
function validatePanels(value, errors) {
    if (value === undefined)
        return;
    if (!Array.isArray(value)) {
        errors.push(issue('panels', 'panels_array_required', 'panels must be an array'));
        return;
    }
    const seen = new Set();
    for (const [index, item] of value.entries()) {
        const pathPrefix = `panels.${index}`;
        if (!isRecord(item)) {
            errors.push(issue(pathPrefix, 'panel_not_object', 'panel must be an object'));
            continue;
        }
        const id = requireString(item, 'id', errors, pathPrefix);
        requireEnum(item, 'slot', PANEL_SLOTS, errors, pathPrefix);
        requireString(item, 'label', errors, pathPrefix);
        requireString(item, 'entry', errors, pathPrefix);
        validateStringArray(item.requires_capabilities, `${pathPrefix}.requires_capabilities`, errors, false);
        if (id) {
            if (seen.has(id))
                errors.push(issue(`${pathPrefix}.id`, 'panel_duplicate', `duplicate panel id: ${id}`));
            seen.add(id);
        }
    }
}
function validateMemoryScopeCapabilities(memoryScopeRaw, capabilitiesRaw, errors, warnings) {
    if (memoryScopeRaw === undefined)
        return;
    const memoryScope = requireObject({ memory_scope: memoryScopeRaw }, 'memory_scope', errors);
    if (!memoryScope)
        return;
    const capabilities = Array.isArray(capabilitiesRaw) ? capabilitiesRaw.filter(isRecord) : [];
    for (const tier of ['project_shared', 'block_private', 'global_shared']) {
        const tables = memoryScope[tier];
        if (tables === undefined || !Array.isArray(tables))
            continue;
        for (const [index, tableName] of tables.entries()) {
            if (typeof tableName === 'string' && !isValidMemoryTableName(tableName)) {
                errors.push(issue(`memory_scope.${tier}.${index}`, 'memory_table_name_invalid', 'memory table names must match /^[a-z][a-z0-9_]{0,63}$/'));
            }
        }
    }
    const projectShared = Array.isArray(memoryScope.project_shared) && memoryScope.project_shared.length > 0;
    const blockPrivate = Array.isArray(memoryScope.block_private) && memoryScope.block_private.length > 0;
    const globalShared = Array.isArray(memoryScope.global_shared) && memoryScope.global_shared.length > 0;
    if (projectShared && !hasMemoryCapability(capabilities, 'project')) {
        warnings.push(issue('memory_scope.project_shared', 'memory_capability_missing', 'project_shared memory scopes should declare memory:read or memory:write with scope "project"'));
    }
    if (blockPrivate && !hasMemoryCapability(capabilities, 'block', 'write')) {
        warnings.push(issue('memory_scope.block_private', 'memory_capability_missing', 'block_private memory scopes should declare memory:write with scope "block"'));
    }
    if (globalShared) {
        errors.push(issue('memory_scope.global_shared', 'global_shared_requires_review', 'global_shared memory scopes require trusted-core manual review and are disabled in Manifest v1 package validation'));
    }
}
function hasMemoryCapability(capabilities, scope, access) {
    return capabilities.some((capability) => {
        if (capability.scope !== scope)
            return false;
        if (access)
            return capability.token === `memory:${access}`;
        return capability.token === 'memory:read' || capability.token === 'memory:write';
    });
}
function validateOptimizerPolicy(value, errors) {
    const policy = requireObject({ optimizer_policy: value }, 'optimizer_policy', errors);
    if (!policy)
        return;
    if (typeof policy.editable !== 'boolean') {
        errors.push(issue('optimizer_policy.editable', 'optimizer_editable_required', 'optimizer_policy.editable must be boolean'));
    }
    validateStringArray(policy.editable_fields, 'optimizer_policy.editable_fields', errors, false);
    const neverEditable = validateStringArray(policy.never_editable, 'optimizer_policy.never_editable', errors, true);
    const humanApproval = validateStringArray(policy.requires_human_approval, 'optimizer_policy.requires_human_approval', errors, true);
    for (const field of REQUIRED_NEVER_EDITABLE) {
        if (!(neverEditable === null || neverEditable === void 0 ? void 0 : neverEditable.includes(field))) {
            errors.push(issue('optimizer_policy.never_editable', 'optimizer_never_editable_missing', `never_editable must include ${field}`));
        }
    }
    for (const field of REQUIRED_HUMAN_APPROVAL) {
        if (!(humanApproval === null || humanApproval === void 0 ? void 0 : humanApproval.includes(field))) {
            errors.push(issue('optimizer_policy.requires_human_approval', 'optimizer_human_approval_missing', `requires_human_approval must include ${field}`));
        }
    }
}
function validateSecurity(value, runtime, errors, warnings) {
    const security = requireObject({ security: value }, 'security', errors);
    if (!security)
        return;
    requireEnum(security, 'sandbox', SANDBOXES, errors, 'security');
    validateStringArray(security.allow_fs_read, 'security.allow_fs_read', errors, true);
    validateStringArray(security.allow_fs_write, 'security.allow_fs_write', errors, true);
    validateSafeBlockPaths(security.allow_fs_read, 'security.allow_fs_read', errors);
    validateSafeBlockPaths(security.allow_fs_write, 'security.allow_fs_write', errors);
    validateStringArray(security.secrets_access, 'security.secrets_access', errors, true);
    requireBoolean(security, 'allow_network', errors, 'security');
    requireBoolean(security, 'allow_child_process', errors, 'security');
    requirePositiveNumber(security, 'max_memory_mb', errors, 'security');
    requirePositiveNumber(security, 'max_cpu_pct', errors, 'security', 100);
    if (isRecord(runtime) && typeof runtime.sandbox === 'string' && typeof security.sandbox === 'string' && runtime.sandbox !== security.sandbox) {
        errors.push(issue('security.sandbox', 'security_sandbox_mismatch', 'security.sandbox must match runtime.sandbox'));
    }
    if (security.allow_network === true) {
        warnings.push(issue('security.allow_network', 'network_requires_review', 'network-enabled blocks require explicit operator review before pilot/certification'));
    }
    if (security.allow_child_process === true) {
        warnings.push(issue('security.allow_child_process', 'child_process_requires_review', 'child_process-enabled blocks require explicit operator review before pilot/certification'));
    }
}
function validateSafeBlockPaths(value, pathPrefix, errors) {
    if (!Array.isArray(value))
        return;
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string')
            continue;
        const normalized = item.replace(/\\/g, '/');
        if (path.isAbsolute(normalized) || normalized.startsWith('~')) {
            errors.push(issue(`${pathPrefix}.${index}`, 'fs_path_absolute', `${pathPrefix}.${index} must be a relative path within the block root`));
        }
        if (normalized.split('/').includes('..')) {
            errors.push(issue(`${pathPrefix}.${index}`, 'fs_path_traversal', `${pathPrefix}.${index} must not contain ".." path traversal`));
        }
    }
}
function validateSigning(value, certification, errors, warnings) {
    const state = isRecord(certification) && typeof certification.state === 'string' ? certification.state : undefined;
    if (value === undefined) {
        if (state === 'pilot' || state === 'certified') {
            errors.push(issue('signing', 'signing_required', `${state} blocks require signing metadata`));
        }
        else {
            warnings.push(issue('signing', 'signing_missing', 'dev/internal blocks may omit signing metadata, but publishing requires it'));
        }
        return;
    }
    const signing = requireObject({ signing: value }, 'signing', errors);
    if (!signing)
        return;
    if (signing.algorithm !== 'ed25519') {
        errors.push(issue('signing.algorithm', 'signing_algorithm_invalid', 'signing.algorithm must be ed25519 for Manifest v1'));
    }
    requireString(signing, 'key_id', errors, 'signing');
    requireString(signing, 'signature_file', errors, 'signing');
}
function validateCertification(value, errors) {
    const certification = requireObject({ certification: value }, 'certification', errors);
    if (!certification)
        return;
    requireEnum(certification, 'state', CERTIFICATION_STATES, errors, 'certification');
    const state = certification.state;
    if ((state === 'pilot' || state === 'certified') && typeof certification.sbom !== 'string') {
        errors.push(issue('certification.sbom', 'certification_sbom_required', `${state} blocks require certification.sbom`));
    }
}
function validateStringArrayObject(value, pathPrefix, keys, errors) {
    if (value === undefined)
        return;
    const object = requireObject({ [pathPrefix]: value }, pathPrefix, errors);
    if (!object)
        return;
    for (const key of keys)
        validateStringArray(object[key], `${pathPrefix}.${key}`, errors, false);
}
function validateStringArray(value, pathPrefix, errors, required) {
    if (value === undefined) {
        if (required)
            errors.push(issue(pathPrefix, 'string_array_required', `${pathPrefix} must be an array`));
        return undefined;
    }
    if (!Array.isArray(value)) {
        errors.push(issue(pathPrefix, 'string_array_invalid', `${pathPrefix} must be an array of strings`));
        return undefined;
    }
    const result = [];
    for (const [index, item] of value.entries()) {
        if (typeof item !== 'string' || item.trim() === '') {
            errors.push(issue(`${pathPrefix}.${index}`, 'string_array_item_invalid', `${pathPrefix}.${index} must be a non-empty string`));
            continue;
        }
        result.push(item);
    }
    return result;
}
function readPackageJson(rootDir, errors) {
    return __awaiter(this, void 0, void 0, function* () {
        const packageJsonPath = path.join(rootDir, 'package.json');
        let raw;
        try {
            raw = yield readFile(packageJsonPath, 'utf8');
        }
        catch (_a) {
            return undefined;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!isRecord(parsed)) {
                errors.push(issue('package.json', 'package_json_not_object', 'package.json must contain a JSON object'));
                return undefined;
            }
            return parsed;
        }
        catch (err) {
            errors.push(issue('package.json', 'package_json_invalid', `package.json is invalid JSON: ${formatError(err)}`));
            return undefined;
        }
    });
}
function requireObject(object, key, errors) {
    const value = object[key];
    if (!isRecord(value)) {
        errors.push(issue(key, 'object_required', `${key} must be an object`));
        return undefined;
    }
    return value;
}
function requireString(object, key, errors, prefix) {
    const value = object[key];
    const pathPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string' || value.trim() === '') {
        errors.push(issue(pathPrefix, 'string_required', `${pathPrefix} must be a non-empty string`));
        return undefined;
    }
    return value;
}
function requirePattern(object, key, re, message, errors, prefix) {
    const value = requireString(object, key, errors, prefix);
    if (value && !re.test(value))
        errors.push(issue(prefix ? `${prefix}.${key}` : key, 'pattern_mismatch', message));
    return value;
}
function requireEnum(object, key, allowed, errors, prefix) {
    const value = object[key];
    const pathPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'string' || !allowed.has(value)) {
        errors.push(issue(pathPrefix, 'enum_invalid', `${pathPrefix} must be one of: ${[...allowed].join(', ')}`));
        return undefined;
    }
    return value;
}
function requireEquals(object, key, expected, errors) {
    if (object[key] !== expected)
        errors.push(issue(key, 'value_invalid', `${key} must be "${expected}"`));
}
function requireBoolean(object, key, errors, prefix) {
    const pathPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof object[key] !== 'boolean')
        errors.push(issue(pathPrefix, 'boolean_required', `${pathPrefix} must be boolean`));
}
function requirePositiveNumber(object, key, errors, prefix, max) {
    const value = object[key];
    const pathPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (max !== undefined && value > max)) {
        errors.push(issue(pathPrefix, 'number_invalid', `${pathPrefix} must be a positive number${max !== undefined ? ` <= ${max}` : ''}`));
    }
}
function issue(pathValue, code, message) {
    return { path: pathValue, code, message };
}
function emptySummary() {
    return {
        capabilityCount: 0,
        consumedContractCount: 0,
        producedContractCount: 0,
        panelCount: 0,
    };
}
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function stringValue(value) {
    return typeof value === 'string' ? value : undefined;
}
function isCertificationState(value) {
    return typeof value === 'string' && CERTIFICATION_STATES.has(value);
}
function formatError(err) {
    return err instanceof Error ? err.message : String(err);
}

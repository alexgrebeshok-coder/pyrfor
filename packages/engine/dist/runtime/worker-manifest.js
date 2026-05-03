import { WORKER_PROTOCOL_VERSION, } from './worker-protocol.js';
export const WORKER_MANIFEST_SCHEMA_VERSION = 'worker_manifest.v1';
const PERMISSION_CLASSES = new Set([
    'auto_allow',
    'ask_once',
    'ask_every_time',
    'deny',
]);
const PROFILE_ORDER = {
    autonomous: 0,
    standard: 1,
    strict: 2,
};
const PERMISSION_ORDER = {
    auto_allow: 0,
    ask_once: 1,
    ask_every_time: 2,
    deny: 3,
};
const WORKER_FRAME_TYPES = new Set([
    'plan_fragment',
    'proposed_patch',
    'proposed_command',
    'request_capability',
    'checkpoint',
    'heartbeat',
    'artifact_reference',
    'warning',
    'final_report',
    'failure_report',
]);
export function validateWorkerManifest(value) {
    if (!isRecord(value))
        throw new Error('WorkerManifest: manifest must be an object');
    if (value['schemaVersion'] !== WORKER_MANIFEST_SCHEMA_VERSION) {
        throw new Error(`WorkerManifest: schemaVersion must be ${WORKER_MANIFEST_SCHEMA_VERSION}`);
    }
    const id = requireNonEmptyString(value, 'id');
    const version = requireNonEmptyString(value, 'version');
    const title = requireNonEmptyString(value, 'title');
    const transport = value['transport'];
    if (transport !== 'acp' && transport !== 'freeclaude') {
        throw new Error('WorkerManifest: transport must be acp or freeclaude');
    }
    if (value['protocolVersion'] !== WORKER_PROTOCOL_VERSION) {
        throw new Error(`WorkerManifest: protocolVersion must be ${WORKER_PROTOCOL_VERSION}`);
    }
    const permissionProfile = value['permissionProfile'];
    if (permissionProfile !== undefined
        && permissionProfile !== 'strict'
        && permissionProfile !== 'standard'
        && permissionProfile !== 'autonomous') {
        throw new Error('WorkerManifest: permissionProfile must be strict, standard, or autonomous');
    }
    const domainIds = optionalStringArray(value['domainIds'], 'domainIds');
    const requiredFrameTypes = optionalFrameTypeArray(value['requiredFrameTypes']);
    const toolPermissionOverrides = optionalPermissionOverrides(value['toolPermissionOverrides']);
    return Object.assign(Object.assign(Object.assign(Object.assign({ schemaVersion: WORKER_MANIFEST_SCHEMA_VERSION, id,
        version,
        title,
        transport, protocolVersion: WORKER_PROTOCOL_VERSION }, (domainIds ? { domainIds } : {})), (permissionProfile ? { permissionProfile } : {})), (toolPermissionOverrides ? { toolPermissionOverrides } : {})), (requiredFrameTypes ? { requiredFrameTypes } : {}));
}
export function materializeWorkerManifest(manifest) {
    const validated = validateWorkerManifest(manifest);
    return Object.assign(Object.assign(Object.assign(Object.assign({ transport: validated.transport }, (validated.domainIds ? { domainIds: [...validated.domainIds] } : {})), (validated.permissionProfile ? { permissionProfile: validated.permissionProfile } : {})), (validated.toolPermissionOverrides ? { permissionOverrides: Object.assign({}, validated.toolPermissionOverrides) } : {})), (validated.requiredFrameTypes ? { requiredFrameTypes: [...validated.requiredFrameTypes] } : {}));
}
export function mergePermissionProfiles(...profiles) {
    let strongest;
    for (const profile of profiles) {
        if (!profile)
            continue;
        if (!strongest || PROFILE_ORDER[profile] > PROFILE_ORDER[strongest])
            strongest = profile;
    }
    return strongest;
}
export function mergePermissionOverrides(...overrides) {
    const merged = {};
    for (const source of overrides) {
        if (!source)
            continue;
        for (const [toolName, permissionClass] of Object.entries(source)) {
            const current = merged[toolName];
            if (!current || PERMISSION_ORDER[permissionClass] > PERMISSION_ORDER[current]) {
                merged[toolName] = permissionClass;
            }
        }
    }
    return merged;
}
export function mergeWorkerDomainScopes(...scopes) {
    const merged = [];
    const seen = new Set();
    for (const scope of scopes) {
        if (!scope)
            continue;
        for (const domainId of scope) {
            if (seen.has(domainId))
                continue;
            seen.add(domainId);
            merged.push(domainId);
        }
    }
    return merged.length > 0 ? merged : undefined;
}
export function assertWorkerManifestDomainScope(manifestDomainIds, allowedDomainIds) {
    if (!manifestDomainIds || manifestDomainIds.length === 0)
        return;
    const allowed = new Set(allowedDomainIds);
    const outOfScope = manifestDomainIds.filter((domainId) => !allowed.has(domainId));
    if (outOfScope.length > 0) {
        throw new Error(`WorkerManifest: domainIds out of run scope: ${outOfScope.join(', ')}`);
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireNonEmptyString(record, key) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`WorkerManifest: ${key} must be a non-empty string`);
    }
    return value;
}
function optionalStringArray(value, key) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
        throw new Error(`WorkerManifest: ${key} must be an array of non-empty strings`);
    }
    return [...value];
}
function optionalFrameTypeArray(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !WORKER_FRAME_TYPES.has(item))) {
        throw new Error('WorkerManifest: requiredFrameTypes must contain supported worker frame types');
    }
    return [...value];
}
function optionalPermissionOverrides(value) {
    if (value === undefined)
        return undefined;
    if (!isRecord(value))
        throw new Error('WorkerManifest: toolPermissionOverrides must be an object');
    const overrides = {};
    for (const [toolName, permissionClass] of Object.entries(value)) {
        if (typeof toolName !== 'string' || toolName.length === 0 || !PERMISSION_CLASSES.has(permissionClass)) {
            throw new Error('WorkerManifest: toolPermissionOverrides must map tool names to valid permission classes');
        }
        overrides[toolName] = permissionClass;
    }
    return overrides;
}

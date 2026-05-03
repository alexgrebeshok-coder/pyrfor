import {
  type PermissionClass,
  type PermissionEngineOptions,
} from './permission-engine';
import {
  WORKER_PROTOCOL_VERSION,
  type WorkerFrameType,
  type WorkerProtocolVersion,
} from './worker-protocol';

export const WORKER_MANIFEST_SCHEMA_VERSION = 'worker_manifest.v1' as const;

export type WorkerManifestSchemaVersion = typeof WORKER_MANIFEST_SCHEMA_VERSION;
export type WorkerManifestTransport = 'acp' | 'freeclaude';

export interface WorkerManifest {
  schemaVersion: WorkerManifestSchemaVersion;
  id: string;
  version: string;
  title: string;
  transport: WorkerManifestTransport;
  protocolVersion: WorkerProtocolVersion;
  domainIds?: string[];
  permissionProfile?: PermissionEngineOptions['profile'];
  toolPermissionOverrides?: Record<string, PermissionClass>;
  requiredFrameTypes?: WorkerFrameType[];
}

export interface WorkerManifestRuntimeOptions {
  transport: WorkerManifestTransport;
  domainIds?: string[];
  permissionProfile?: PermissionEngineOptions['profile'];
  permissionOverrides?: Record<string, PermissionClass>;
  requiredFrameTypes?: WorkerFrameType[];
}

const PERMISSION_CLASSES: ReadonlySet<PermissionClass> = new Set([
  'auto_allow',
  'ask_once',
  'ask_every_time',
  'deny',
]);

const PROFILE_ORDER: Record<NonNullable<PermissionEngineOptions['profile']>, number> = {
  autonomous: 0,
  standard: 1,
  strict: 2,
};

const PERMISSION_ORDER: Record<PermissionClass, number> = {
  auto_allow: 0,
  ask_once: 1,
  ask_every_time: 2,
  deny: 3,
};

const WORKER_FRAME_TYPES: ReadonlySet<WorkerFrameType> = new Set([
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

export function validateWorkerManifest(value: unknown): WorkerManifest {
  if (!isRecord(value)) throw new Error('WorkerManifest: manifest must be an object');
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
  if (
    permissionProfile !== undefined
    && permissionProfile !== 'strict'
    && permissionProfile !== 'standard'
    && permissionProfile !== 'autonomous'
  ) {
    throw new Error('WorkerManifest: permissionProfile must be strict, standard, or autonomous');
  }

  const domainIds = optionalStringArray(value['domainIds'], 'domainIds');
  const requiredFrameTypes = optionalFrameTypeArray(value['requiredFrameTypes']);
  const toolPermissionOverrides = optionalPermissionOverrides(value['toolPermissionOverrides']);

  return {
    schemaVersion: WORKER_MANIFEST_SCHEMA_VERSION,
    id,
    version,
    title,
    transport,
    protocolVersion: WORKER_PROTOCOL_VERSION,
    ...(domainIds ? { domainIds } : {}),
    ...(permissionProfile ? { permissionProfile } : {}),
    ...(toolPermissionOverrides ? { toolPermissionOverrides } : {}),
    ...(requiredFrameTypes ? { requiredFrameTypes } : {}),
  };
}

export function materializeWorkerManifest(manifest: WorkerManifest): WorkerManifestRuntimeOptions {
  const validated = validateWorkerManifest(manifest);
  return {
    transport: validated.transport,
    ...(validated.domainIds ? { domainIds: [...validated.domainIds] } : {}),
    ...(validated.permissionProfile ? { permissionProfile: validated.permissionProfile } : {}),
    ...(validated.toolPermissionOverrides ? { permissionOverrides: { ...validated.toolPermissionOverrides } } : {}),
    ...(validated.requiredFrameTypes ? { requiredFrameTypes: [...validated.requiredFrameTypes] } : {}),
  };
}

export function mergePermissionProfiles(
  ...profiles: Array<PermissionEngineOptions['profile'] | undefined>
): PermissionEngineOptions['profile'] | undefined {
  let strongest: NonNullable<PermissionEngineOptions['profile']> | undefined;
  for (const profile of profiles) {
    if (!profile) continue;
    if (!strongest || PROFILE_ORDER[profile] > PROFILE_ORDER[strongest]) strongest = profile;
  }
  return strongest;
}

export function mergePermissionOverrides(
  ...overrides: Array<Record<string, PermissionClass> | undefined>
): Record<string, PermissionClass> {
  const merged: Record<string, PermissionClass> = {};
  for (const source of overrides) {
    if (!source) continue;
    for (const [toolName, permissionClass] of Object.entries(source)) {
      const current = merged[toolName];
      if (!current || PERMISSION_ORDER[permissionClass] > PERMISSION_ORDER[current]) {
        merged[toolName] = permissionClass;
      }
    }
  }
  return merged;
}

export function mergeWorkerDomainScopes(
  ...scopes: Array<readonly string[] | undefined>
): string[] | undefined {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (!scope) continue;
    for (const domainId of scope) {
      if (seen.has(domainId)) continue;
      seen.add(domainId);
      merged.push(domainId);
    }
  }
  return merged.length > 0 ? merged : undefined;
}

export function assertWorkerManifestDomainScope(
  manifestDomainIds: readonly string[] | undefined,
  allowedDomainIds: readonly string[],
): void {
  if (!manifestDomainIds || manifestDomainIds.length === 0) return;
  const allowed = new Set(allowedDomainIds);
  const outOfScope = manifestDomainIds.filter((domainId) => !allowed.has(domainId));
  if (outOfScope.length > 0) {
    throw new Error(`WorkerManifest: domainIds out of run scope: ${outOfScope.join(', ')}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`WorkerManifest: ${key} must be a non-empty string`);
  }
  return value;
}

function optionalStringArray(value: unknown, key: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`WorkerManifest: ${key} must be an array of non-empty strings`);
  }
  return [...value];
}

function optionalFrameTypeArray(value: unknown): WorkerFrameType[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !WORKER_FRAME_TYPES.has(item as WorkerFrameType))) {
    throw new Error('WorkerManifest: requiredFrameTypes must contain supported worker frame types');
  }
  return [...value] as WorkerFrameType[];
}

function optionalPermissionOverrides(value: unknown): Record<string, PermissionClass> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('WorkerManifest: toolPermissionOverrides must be an object');
  const overrides: Record<string, PermissionClass> = {};
  for (const [toolName, permissionClass] of Object.entries(value)) {
    if (typeof toolName !== 'string' || toolName.length === 0 || !PERMISSION_CLASSES.has(permissionClass as PermissionClass)) {
      throw new Error('WorkerManifest: toolPermissionOverrides must map tool names to valid permission classes');
    }
    overrides[toolName] = permissionClass as PermissionClass;
  }
  return overrides;
}

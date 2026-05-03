import { type PermissionClass, type PermissionEngineOptions } from './permission-engine';
import { type WorkerFrameType, type WorkerProtocolVersion } from './worker-protocol';
export declare const WORKER_MANIFEST_SCHEMA_VERSION: "worker_manifest.v1";
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
export declare function validateWorkerManifest(value: unknown): WorkerManifest;
export declare function materializeWorkerManifest(manifest: WorkerManifest): WorkerManifestRuntimeOptions;
export declare function mergePermissionProfiles(...profiles: Array<PermissionEngineOptions['profile'] | undefined>): PermissionEngineOptions['profile'] | undefined;
export declare function mergePermissionOverrides(...overrides: Array<Record<string, PermissionClass> | undefined>): Record<string, PermissionClass>;
export declare function mergeWorkerDomainScopes(...scopes: Array<readonly string[] | undefined>): string[] | undefined;
export declare function assertWorkerManifestDomainScope(manifestDomainIds: readonly string[] | undefined, allowedDomainIds: readonly string[]): void;
//# sourceMappingURL=worker-manifest.d.ts.map
import type { ConnectorAdapter, ConnectorManifest } from './types';
type RuntimeEnv = NodeJS.ProcessEnv;
type ConnectorFetch = typeof fetch;
export declare const CONNECTOR_MANIFESTS_ENV = "CEOCLAW_CONNECTOR_MANIFESTS";
export declare function loadConnectorManifestsFromEnv(env?: RuntimeEnv): ConnectorManifest[];
export declare function createManifestConnector(manifest: ConnectorManifest, env?: RuntimeEnv, fetchImpl?: ConnectorFetch): ConnectorAdapter;
export {};
//# sourceMappingURL=manifests.d.ts.map
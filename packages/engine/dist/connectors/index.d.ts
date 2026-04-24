export { createEmailConnector } from './adapters/email';
export { createGpsConnector } from './adapters/gps';
export { createOneCConnector } from './adapters/one-c';
export { createTelegramConnector } from './adapters/telegram';
export { CONNECTOR_MANIFESTS_ENV, createManifestConnector, loadConnectorManifestsFromEnv, } from './manifests';
export { ConnectorRegistry, createConnectorRegistry, getConnectorRegistry, summarizeConnectorStatuses, } from './registry';
export type { ConnectorAdapter, ConnectorApiSurface, ConnectorCredentialRequirement, ConnectorManifest, ConnectorDescriptor, ConnectorDirection, ConnectorProbeExpectation, ConnectorProbeDefinition, ConnectorId, BuiltinConnectorId, ConnectorStatus, ConnectorStatusLevel, ConnectorStatusSummary, } from './types';
//# sourceMappingURL=index.d.ts.map
export { createEmailConnector } from "@/lib/connectors/adapters/email";
export { createGpsConnector } from "@/lib/connectors/adapters/gps";
export { createOneCConnector } from "@/lib/connectors/adapters/one-c";
export { createTelegramConnector } from "@/lib/connectors/adapters/telegram";
export {
  CONNECTOR_MANIFESTS_ENV,
  createManifestConnector,
  loadConnectorManifestsFromEnv,
} from "@/lib/connectors/manifests";
export {
  ConnectorRegistry,
  createConnectorRegistry,
  getConnectorRegistry,
  summarizeConnectorStatuses,
} from "@/lib/connectors/registry";
export type {
  ConnectorAdapter,
  ConnectorApiSurface,
  ConnectorCredentialRequirement,
  ConnectorManifest,
  ConnectorDescriptor,
  ConnectorDirection,
  ConnectorProbeExpectation,
  ConnectorProbeDefinition,
  ConnectorId,
  BuiltinConnectorId,
  ConnectorStatus,
  ConnectorStatusLevel,
  ConnectorStatusSummary,
} from "@/lib/connectors/types";

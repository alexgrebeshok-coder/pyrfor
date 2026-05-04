import type { ConnectorAdapter, ConnectorDescriptor } from './types';
import type { ConnectorRegistry } from './registry';

export interface ConnectorInventoryItem extends ConnectorDescriptor {
  configured: boolean;
  missingSecrets: string[];
  hasProbe: boolean;
  liveProbeSkipped: true;
  statusSource: 'local-config';
}

export interface ConnectorInventorySummary {
  total: number;
  configured: number;
  pending: number;
  stubs: number;
  liveProbeSkipped: number;
}

export interface ConnectorInventorySnapshot {
  checkedAt: string;
  statusSource: 'local-config';
  connectors: ConnectorInventoryItem[];
  summary: ConnectorInventorySummary;
}

type RuntimeEnv = NodeJS.ProcessEnv;

function missingSecretsFor(connector: ConnectorAdapter, env: RuntimeEnv): string[] {
  return connector.credentials
    .filter((credential) => credential.required !== false)
    .map((credential) => credential.envVar)
    .filter((envVar) => !env[envVar]?.trim());
}

function hasProbe(connector: ConnectorAdapter): boolean {
  return (connector as ConnectorAdapter & { probe?: unknown }).probe !== undefined || connector.stub === false;
}

export function buildConnectorInventorySnapshot(
  registry: ConnectorRegistry,
  env: RuntimeEnv = process.env,
  now: () => Date = () => new Date(),
): ConnectorInventorySnapshot {
  const connectors = registry.list().map((connector): ConnectorInventoryItem => {
    const missingSecrets = missingSecretsFor(connector, env);
    return {
      id: connector.id,
      name: connector.name,
      description: connector.description,
      direction: connector.direction,
      sourceSystem: connector.sourceSystem,
      operations: [...connector.operations],
      credentials: connector.credentials.map((credential) => ({ ...credential })),
      apiSurface: connector.apiSurface.map((surface) => ({ ...surface })),
      stub: connector.stub,
      configured: missingSecrets.length === 0,
      missingSecrets,
      hasProbe: hasProbe(connector),
      liveProbeSkipped: true,
      statusSource: 'local-config',
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return {
    checkedAt: now().toISOString(),
    statusSource: 'local-config',
    connectors,
    summary: {
      total: connectors.length,
      configured: connectors.filter((connector) => connector.configured).length,
      pending: connectors.filter((connector) => !connector.configured).length,
      stubs: connectors.filter((connector) => connector.stub).length,
      liveProbeSkipped: connectors.length,
    },
  };
}

import type { ConnectorAdapter, ConnectorDescriptor, ConnectorProbeDefinition, ConnectorProbeExpectation } from './types';
import type { ConnectorRegistry } from './registry';

export type ConnectorReadinessState = 'configured' | 'pending' | 'stub';

export interface ConnectorReadiness {
  state: ConnectorReadinessState;
  reasons: string[];
  nextStep: string;
}

export interface ConnectorProbePreview {
  mode: 'manifest-probe' | 'descriptor-status';
  requiresApproval: true;
  method?: 'GET' | 'POST';
  path?: string;
  baseUrlEnvVar?: string;
  authEnvVar?: string;
  authHeaderName?: string;
  expectedStatus?: number;
  expectation?: ConnectorProbeExpectation;
  requiredEnvVars: string[];
  headerNames: string[];
  bodyConfigured: boolean;
  note: string;
}

export interface ConnectorInventoryItem extends ConnectorDescriptor {
  configured: boolean;
  missingSecrets: string[];
  hasProbe: boolean;
  readiness: ConnectorReadiness;
  probePreview?: ConnectorProbePreview;
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
  const credentialSecrets = connector.credentials
    .filter((credential) => credential.required !== false)
    .map((credential) => credential.envVar)
    .filter((envVar) => !env[envVar]?.trim());
  const probe = probeFor(connector);
  const probeSecrets = probe
    ? [probe.baseUrlEnvVar, probe.authEnvVar].filter((envVar): envVar is string => Boolean(envVar?.trim() && !env[envVar]?.trim()))
    : [];
  return unique([...credentialSecrets, ...probeSecrets]);
}

function hasProbe(connector: ConnectorAdapter): boolean {
  return (connector as ConnectorAdapter & { probe?: unknown }).probe !== undefined || connector.stub === false;
}

function probeFor(connector: ConnectorAdapter): ConnectorProbeDefinition | undefined {
  const probe = (connector as ConnectorAdapter & { probe?: ConnectorProbeDefinition }).probe;
  return probe && typeof probe === 'object' ? probe : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function safeProbePath(path: string | undefined): string | undefined {
  if (!path?.trim()) return undefined;
  const trimmed = path.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.pathname || '/';
  } catch {
    const pathOnly = trimmed.split(/[?#]/, 1)[0]?.trim();
    if (!pathOnly) return undefined;
    if (
      pathOnly.startsWith('~') ||
      /^[A-Za-z]:[\\/]/.test(pathOnly) ||
      pathOnly.includes('\\') ||
      /^\/(Users|home|private|var|tmp|etc|opt|Volumes)\//.test(pathOnly)
    ) {
      return undefined;
    }
    return pathOnly.slice(0, 160);
  }
}

function buildReadiness(connector: ConnectorAdapter, missingSecrets: string[], connectorHasProbe: boolean): ConnectorReadiness {
  if (missingSecrets.length > 0) {
    return {
      state: 'pending',
      reasons: [`Missing required env: ${missingSecrets.join(', ')}`],
      nextStep: `Set ${missingSecrets.join(', ')} and refresh Connector Doctor.`,
    };
  }
  if (connector.stub) {
    return {
      state: 'stub',
      reasons: ['Stub connector: no live implementation is installed.'],
      nextStep: 'Install or enable a non-stub connector implementation before live use.',
    };
  }
  return {
    state: 'configured',
    reasons: [
      'Required env names are present in local configuration.',
      connectorHasProbe
        ? 'Live health check requires explicit Trust approval.'
        : 'No live probe is declared for this connector.',
    ],
    nextStep: connectorHasProbe
      ? 'Request live probe approval to verify remote health.'
      : 'Use supported local workflows; no live health probe is available.',
  };
}

function buildProbePreview(
  connector: ConnectorAdapter,
  missingSecrets: string[],
  connectorHasProbe: boolean,
): ConnectorProbePreview | undefined {
  if (!connectorHasProbe) return undefined;
  const probe = probeFor(connector);
  if (!probe) {
    return {
      mode: 'descriptor-status',
      requiresApproval: true,
      requiredEnvVars: [...missingSecrets],
      headerNames: [],
      bodyConfigured: false,
      note: 'Live status comes from the connector adapter and is not executed by inventory.',
    };
  }
  return {
    mode: 'manifest-probe',
    requiresApproval: true,
    method: probe.method ?? 'GET',
    path: safeProbePath(probe.path ?? '/health'),
    baseUrlEnvVar: probe.baseUrlEnvVar,
    authEnvVar: probe.authEnvVar,
    authHeaderName: probe.authHeaderName,
    expectedStatus: probe.expectedStatus,
    expectation: probe.expectation,
    requiredEnvVars: unique([...missingSecrets, probe.baseUrlEnvVar, probe.authEnvVar]),
    headerNames: Object.keys(probe.headers ?? {}),
    bodyConfigured: probe.body !== undefined,
    note: 'Dry-run preview only: no network request is made until Trust approval is granted.',
  };
}

export function buildConnectorInventorySnapshot(
  registry: ConnectorRegistry,
  env: RuntimeEnv = process.env,
  now: () => Date = () => new Date(),
): ConnectorInventorySnapshot {
  const connectors = registry.list().map((connector): ConnectorInventoryItem => {
    const missingSecrets = missingSecretsFor(connector, env);
    const connectorHasProbe = hasProbe(connector);
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
      hasProbe: connectorHasProbe,
      readiness: buildReadiness(connector, missingSecrets, connectorHasProbe),
      probePreview: buildProbePreview(connector, missingSecrets, connectorHasProbe),
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

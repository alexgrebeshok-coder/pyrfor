import { createEmailConnector } from './adapters/email';
import { createGpsConnector } from './adapters/gps';
import { createOneCConnector } from './adapters/one-c';
import { createTelegramConnector } from './adapters/telegram';
import { createManifestConnector, loadConnectorManifestsFromEnv } from './manifests';
import type {
  ConnectorAdapter,
  ConnectorStatus,
  ConnectorStatusSummary,
} from './types';
import { logger } from '../observability/logger';

type RuntimeEnv = NodeJS.ProcessEnv;

export class ConnectorRegistry {
  private readonly connectors = new Map<string, ConnectorAdapter>();

  register(connector: ConnectorAdapter): this {
    if (this.connectors.has(connector.id)) {
      throw new Error(`Connector '${connector.id}' is already registered.`);
    }

    this.connectors.set(connector.id, connector);
    return this;
  }

  get(id: string): ConnectorAdapter | undefined {
    return this.connectors.get(id);
  }

  list(): ConnectorAdapter[] {
    return Array.from(this.connectors.values());
  }

  async getStatus(id: string): Promise<ConnectorStatus | null> {
    const connector = this.get(id);
    if (!connector) {
      return null;
    }

    return connector.getStatus();
  }

  async getStatuses(): Promise<ConnectorStatus[]> {
    return Promise.all(this.list().map((connector) => connector.getStatus()));
  }
}

export function createConnectorRegistry(env: RuntimeEnv = process.env): ConnectorRegistry {
  const registry = new ConnectorRegistry()
    .register(createTelegramConnector(env))
    .register(createEmailConnector(env))
    .register(createGpsConnector(env))
    .register(createOneCConnector(env));

  for (const manifest of loadConnectorManifestsFromEnv(env)) {
    try {
      registry.register(createManifestConnector(manifest, env));
    } catch (error) {
      logger.warn("Skipping connector manifest", {
        connector: manifest.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return registry;
}

export function summarizeConnectorStatuses(
  statuses: ConnectorStatus[]
): ConnectorStatusSummary {
  const summary = statuses.reduce(
    (accumulator, connector) => {
      accumulator.total += 1;
      if (connector.configured) {
        accumulator.configured += 1;
      }

      if (connector.status === "ok") {
        accumulator.ok += 1;
      } else if (connector.status === "degraded") {
        accumulator.degraded += 1;
      } else {
        accumulator.pending += 1;
      }

      return accumulator;
    },
    {
      total: 0,
      configured: 0,
      ok: 0,
      pending: 0,
      degraded: 0,
    }
  );

  const status =
    summary.degraded > 0 ? "degraded" : summary.pending > 0 ? "pending" : "ok";

  return {
    status,
    ...summary,
  };
}

const defaultRegistry = createConnectorRegistry();

export function getConnectorRegistry(): ConnectorRegistry {
  return defaultRegistry;
}

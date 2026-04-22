import type {
  ConnectorAdapter,
  ConnectorDescriptor,
  ConnectorStatus,
} from '../types';
import {
  getOneCApiKey,
  getOneCApiUrl,
  probeOneCApi,
} from '../one-c-client';

type RuntimeEnv = NodeJS.ProcessEnv;
type OneCFetch = typeof fetch;

const descriptor: ConnectorDescriptor = {
  id: "one-c",
  name: "1C",
  description:
    "Enterprise finance connector for 1C ERP and PM data. It now exposes a live read-only financial probe and sample path without pretending write-back readiness.",
  direction: "inbound",
  sourceSystem: "1C:ERP / 1C:PM HTTP or OData APIs",
  operations: [
    "Probe live 1C financial-read readiness via project finance sample",
    "Read sample project financial status through a live 1C API path",
    "Read normalized project finance truth with deterministic deltas and portfolio rollups",
  ],
  credentials: [
    {
      envVar: "ONE_C_BASE_URL",
      description: "Base URL or direct read URL for the 1C HTTP or OData endpoint.",
    },
    {
      envVar: "ONE_C_API_KEY",
      description: "Service API key or equivalent auth token for 1C.",
    },
  ],
  apiSurface: [
    {
      method: "GET",
      path: "/api/connectors/one-c",
      description: "Connector status for 1C financial integration.",
    },
    {
      method: "GET",
      path: "/api/connectors/one-c/sample",
      description: "Read one normalized 1C project finance sample from the live API.",
    },
    {
      method: "GET",
      path: "/api/connectors/one-c/finance",
      description:
        "Read normalized 1C financial truth with project deltas and aggregate budget rollups.",
    },
  ],
  stub: false,
};

export function createOneCConnector(
  env: RuntimeEnv = process.env,
  fetchImpl?: OneCFetch
): ConnectorAdapter {
  return {
    ...descriptor,
    async getStatus(): Promise<ConnectorStatus> {
      const checkedAt = new Date().toISOString();
      const apiUrl = getOneCApiUrl(env);
      const apiKey = getOneCApiKey(env);
      const missingSecrets = [
        ...(apiUrl ? [] : ["ONE_C_BASE_URL"]),
        ...(apiKey ? [] : ["ONE_C_API_KEY"]),
      ];

      if (missingSecrets.length > 0) {
        return {
          ...descriptor,
          status: "pending",
          configured: false,
          checkedAt,
          missingSecrets,
          message: "1C live read probe is waiting for ONE_C_BASE_URL and ONE_C_API_KEY.",
        };
      }

      try {
        const probeResult = await probeOneCApi(
          {
            baseUrl: apiUrl!,
            apiKey: apiKey!,
          },
          fetchImpl ?? fetch
        );

        if (!probeResult.ok) {
          return {
            ...descriptor,
            status: "degraded",
            configured: true,
            checkedAt,
            missingSecrets: [],
            message: `1C probe failed: ${probeResult.message}`,
            metadata: probeResult.metadata,
          };
        }

        return {
          ...descriptor,
          status: probeResult.remoteStatus,
          configured: true,
          checkedAt,
          missingSecrets: [],
          message: probeResult.message,
          metadata: probeResult.metadata,
        };
      } catch (error) {
        return {
          ...descriptor,
          status: "degraded",
          configured: true,
          checkedAt,
          missingSecrets: [],
          message:
            error instanceof Error
              ? `1C probe failed: ${error.message}`
              : "1C probe failed with an unknown error.",
        };
      }
    },
  };
}

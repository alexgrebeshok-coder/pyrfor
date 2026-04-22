import type {
  ConnectorAdapter,
  ConnectorDescriptor,
  ConnectorStatus,
} from "@/lib/connectors/types";
import {
  getGpsApiKey,
  getGpsApiUrl,
  probeGpsApi,
} from "@/lib/connectors/gps-client";

type RuntimeEnv = NodeJS.ProcessEnv;
type GpsFetch = typeof fetch;

const descriptor: ConnectorDescriptor = {
  id: "gps",
  name: "GPS/GLONASS",
  description:
    "Inbound telemetry connector for equipment position, geofence events, and utilization evidence. It now performs a live readiness probe against the GPS API.",
  direction: "inbound",
  sourceSystem: "GPS/GLONASS tracking platform REST API",
  operations: [
    "Probe live telemetry readiness via GPS session stats",
    "Read sample telemetry sessions via a live GPS API path",
    "Read normalized telemetry truth grouped by sessions, equipment, and geofences",
  ],
  credentials: [
    {
      envVar: "GPS_API_URL",
      description: "Base URL or direct probe URL for the tracking platform REST API.",
    },
    {
      envVar: "GPS_API_KEY",
      description: "API key used in bearer or X-API-Key style requests.",
    },
  ],
  apiSurface: [
    {
      method: "GET",
      path: "/api/connectors/gps",
      description: "Connector status for GPS/GLONASS telemetry.",
    },
    {
      method: "GET",
      path: "/api/connectors/gps/sample",
      description: "Read one normalized GPS telemetry sample from the live sessions endpoint.",
    },
    {
      method: "GET",
      path: "/api/connectors/gps/telemetry",
      description:
        "Read normalized GPS telemetry truth with deterministic session, equipment, and geofence rollups.",
    },
  ],
  stub: false,
};

export function createGpsConnector(
  env: RuntimeEnv = process.env,
  fetchImpl?: GpsFetch
): ConnectorAdapter {
  return {
    ...descriptor,
    async getStatus(): Promise<ConnectorStatus> {
      const checkedAt = new Date().toISOString();
      const apiUrl = getGpsApiUrl(env);
      const apiKey = getGpsApiKey(env);
      const missingSecrets = [
        ...(apiUrl ? [] : ["GPS_API_URL"]),
        ...(apiKey ? [] : ["GPS_API_KEY"]),
      ];

      if (missingSecrets.length > 0) {
        return {
          ...descriptor,
          status: "pending",
          configured: false,
          checkedAt,
          missingSecrets,
          message: "GPS live probe is waiting for GPS_API_URL and GPS_API_KEY.",
        };
      }

      try {
        const probeResult = await probeGpsApi(
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
            message: `GPS probe failed: ${probeResult.message}`,
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
              ? `GPS probe failed: ${error.message}`
              : "GPS probe failed with an unknown error.",
        };
      }
    },
  };
}

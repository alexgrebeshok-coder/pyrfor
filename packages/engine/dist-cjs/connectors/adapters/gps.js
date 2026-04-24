"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGpsConnector = createGpsConnector;
const gps_client_1 = require("../gps-client");
const descriptor = {
    id: "gps",
    name: "GPS/GLONASS",
    description: "Inbound telemetry connector for equipment position, geofence events, and utilization evidence. It now performs a live readiness probe against the GPS API.",
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
            description: "Read normalized GPS telemetry truth with deterministic session, equipment, and geofence rollups.",
        },
    ],
    stub: false,
};
function createGpsConnector(env = process.env, fetchImpl) {
    return {
        ...descriptor,
        async getStatus() {
            const checkedAt = new Date().toISOString();
            const apiUrl = (0, gps_client_1.getGpsApiUrl)(env);
            const apiKey = (0, gps_client_1.getGpsApiKey)(env);
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
                const probeResult = await (0, gps_client_1.probeGpsApi)({
                    baseUrl: apiUrl,
                    apiKey: apiKey,
                }, fetchImpl ?? fetch);
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
            }
            catch (error) {
                return {
                    ...descriptor,
                    status: "degraded",
                    configured: true,
                    checkedAt,
                    missingSecrets: [],
                    message: error instanceof Error
                        ? `GPS probe failed: ${error.message}`
                        : "GPS probe failed with an unknown error.",
                };
            }
        },
    };
}

import { logger } from "@/lib/logger";
import type {
  ConnectorAdapter,
  ConnectorCredentialRequirement,
  ConnectorManifest,
  ConnectorProbeDefinition,
  ConnectorStatus,
  ConnectorStatusLevel,
} from "@/lib/connectors/types";

type RuntimeEnv = NodeJS.ProcessEnv;
type ConnectorFetch = typeof fetch;

export const CONNECTOR_MANIFESTS_ENV = "CEOCLAW_CONNECTOR_MANIFESTS";

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, string>>((accumulator, [key, entry]) => {
    if (typeof entry === "string") {
      accumulator[key] = entry;
    }
    return accumulator;
  }, {});
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeCredentials(value: unknown): ConnectorCredentialRequirement[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const credentials: ConnectorCredentialRequirement[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const envVar = typeof record.envVar === "string" ? record.envVar.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!envVar || !description) {
      continue;
    }

    credentials.push({
      envVar,
      description,
      required: record.required !== false,
    });
  }

  return credentials;
}

function normalizeProbe(value: unknown): ConnectorProbeDefinition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const baseUrlEnvVar = typeof record.baseUrlEnvVar === "string" ? record.baseUrlEnvVar.trim() : "";
  if (!baseUrlEnvVar) {
    return null;
  }

  const probe: ConnectorProbeDefinition = {
    baseUrlEnvVar,
    path: typeof record.path === "string" && record.path.trim().length > 0 ? record.path.trim() : undefined,
    method:
      record.method === "POST" || record.method === "GET"
        ? (record.method as "GET" | "POST")
        : undefined,
    authEnvVar:
      typeof record.authEnvVar === "string" && record.authEnvVar.trim().length > 0
        ? record.authEnvVar.trim()
        : undefined,
    authHeaderName:
      typeof record.authHeaderName === "string" && record.authHeaderName.trim().length > 0
        ? record.authHeaderName.trim()
        : undefined,
    authScheme:
      typeof record.authScheme === "string" && record.authScheme.trim().length > 0
        ? record.authScheme.trim()
        : undefined,
    expectedStatus:
      typeof record.expectedStatus === "number" && Number.isFinite(record.expectedStatus)
        ? record.expectedStatus
        : undefined,
    expectation:
      record.expectation === "status-only" ||
      record.expectation === "json-object" ||
      record.expectation === "json-array" ||
      record.expectation === "json-field"
        ? record.expectation
        : undefined,
    responseField:
      typeof record.responseField === "string" && record.responseField.trim().length > 0
        ? record.responseField.trim()
        : undefined,
    headers: toStringRecord(record.headers),
    body: record.body,
  };

  return probe;
}

function normalizeConnectorManifest(
  value: unknown,
  index: number
): ConnectorManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    logger.warn("Skipping invalid connector manifest entry", { index, reason: "not an object" });
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const direction =
    record.direction === "inbound" ||
    record.direction === "outbound" ||
    record.direction === "bidirectional"
      ? (record.direction as "inbound" | "outbound" | "bidirectional")
      : null;
  const sourceSystem = typeof record.sourceSystem === "string" ? record.sourceSystem.trim() : "";
  const operations = normalizeStringArray(record.operations);
  const credentials = normalizeCredentials(record.credentials);
  const apiSurface = Array.isArray(record.apiSurface)
    ? record.apiSurface
        .map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return null;
          }

          const itemRecord = item as Record<string, unknown>;
          const method =
            itemRecord.method === "GET" ||
            itemRecord.method === "POST" ||
            itemRecord.method === "WEBHOOK"
              ? (itemRecord.method as "GET" | "POST" | "WEBHOOK")
              : null;
          const path = typeof itemRecord.path === "string" ? itemRecord.path.trim() : "";
          const surfaceDescription =
            typeof itemRecord.description === "string" ? itemRecord.description.trim() : "";

          if (!method || !path || !surfaceDescription) {
            return null;
          }

          return {
            method,
            path,
            description: surfaceDescription,
          };
        })
        .filter(
          (item): item is { method: "GET" | "POST" | "WEBHOOK"; path: string; description: string } =>
            Boolean(item)
        )
    : [];
  const probe = normalizeProbe(record.probe);

  if (!id || !name || !description || !direction || !sourceSystem || operations.length === 0) {
    logger.warn("Skipping invalid connector manifest entry", {
      index,
      id: id || null,
      name: name || null,
      reason: "missing required fields",
    });
    return null;
  }

  return {
    id,
    name,
    description,
    direction,
    sourceSystem,
    operations,
    credentials,
    apiSurface,
    stub: record.stub === true,
    probe: probe ?? undefined,
  };
}

export function loadConnectorManifestsFromEnv(
  env: RuntimeEnv = process.env
): ConnectorManifest[] {
  const raw = env[CONNECTOR_MANIFESTS_ENV];
  if (!raw?.trim()) {
    return [];
  }

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed)) {
    logger.warn("CONNECTOR_MANIFESTS must be a JSON array", {
      envVar: CONNECTOR_MANIFESTS_ENV,
    });
    return [];
  }

  return parsed
    .map((item, index) => normalizeConnectorManifest(item, index))
    .filter((item): item is ConnectorManifest => Boolean(item));
}

function getProbeMissingSecrets(
  manifest: ConnectorManifest,
  probe: ConnectorProbeDefinition | undefined,
  env: RuntimeEnv
): string[] {
  const missing = manifest.credentials
    .filter((credential) => credential.required !== false)
    .map((credential) => credential.envVar)
    .filter((envVar) => !env[envVar]?.trim());

  if (probe) {
    if (!env[probe.baseUrlEnvVar]?.trim()) {
      missing.push(probe.baseUrlEnvVar);
    }

    if (probe.authEnvVar && !env[probe.authEnvVar]?.trim()) {
      missing.push(probe.authEnvVar);
    }
  }

  return Array.from(new Set(missing));
}

function getProbeUrl(baseUrl: string, path?: string) {
  const url = new URL(baseUrl);
  const normalizedPath = path?.trim();

  if (!normalizedPath) {
    return url.toString();
  }

  const joinedPath = normalizedPath.startsWith("/")
    ? normalizedPath
    : `/${normalizedPath}`;
  url.pathname = `${url.pathname.replace(/\/$/, "")}${joinedPath}`;
  return url.toString();
}

function getJsonShape(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function readJsonField(value: unknown, fieldPath?: string): unknown {
  if (!fieldPath) {
    return value;
  }

  const segments = fieldPath.split(".").filter(Boolean);
  let current: unknown = value;

  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function evaluateProbeExpectation(
  expectation: ConnectorProbeDefinition["expectation"],
  parsedPayload: unknown,
  responseStatus: number,
  responseField?: string,
  expectedStatus?: number
): { ok: boolean; reason?: string } {
  if (expectedStatus !== undefined && responseStatus !== expectedStatus) {
    return {
      ok: false,
      reason: `expected HTTP ${expectedStatus} but received ${responseStatus}`,
    };
  }

  if (!expectation || expectation === "status-only") {
    return { ok: true };
  }

  const fieldValue = readJsonField(parsedPayload, responseField);

  if (expectation === "json-object") {
    const isObject = Boolean(parsedPayload) && typeof parsedPayload === "object" && !Array.isArray(parsedPayload);
    return isObject
      ? { ok: true }
      : { ok: false, reason: `expected a JSON object, received ${getJsonShape(parsedPayload)}` };
  }

  if (expectation === "json-array") {
    return Array.isArray(parsedPayload)
      ? { ok: true }
      : { ok: false, reason: `expected a JSON array, received ${getJsonShape(parsedPayload)}` };
  }

  if (expectation === "json-field") {
    return fieldValue !== undefined && fieldValue !== null
      ? { ok: true }
      : {
          ok: false,
          reason: responseField
            ? `expected JSON field "${responseField}" to be present`
            : `expected JSON field to be present`,
        };
  }

  return {
    ok: false,
    reason: `unsupported probe expectation: ${String(expectation)}`,
  };
}

async function probeConnector(
  manifest: ConnectorManifest,
  probe: ConnectorProbeDefinition,
  env: RuntimeEnv,
  fetchImpl: ConnectorFetch
): Promise<
  | {
      ok: true;
      remoteStatus: ConnectorStatusLevel;
      message: string;
      metadata: Record<string, string | number | boolean | null>;
    }
  | {
      ok: false;
      message: string;
      metadata: Record<string, string | number | boolean | null>;
    }
> {
  const baseUrl = env[probe.baseUrlEnvVar]?.trim();
  const authSecret = probe.authEnvVar ? env[probe.authEnvVar]?.trim() : null;

  if (!baseUrl) {
    return {
      ok: false,
      message: `${manifest.name} probe cannot start because ${probe.baseUrlEnvVar} is missing.`,
      metadata: {
        probeUrl: null,
        responseShape: null,
      },
    };
  }

  let probeUrl: string;
  try {
    probeUrl = getProbeUrl(baseUrl, probe.path ?? "/health");
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `${manifest.name} probe failed to build URL: ${error.message}`
          : `${manifest.name} probe failed to build URL.`,
      metadata: {
        probeUrl: baseUrl,
        responseShape: null,
      },
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...probe.headers,
  };

  if (authSecret) {
    headers[probe.authHeaderName ?? "Authorization"] = probe.authScheme
      ? `${probe.authScheme} ${authSecret}`
      : authSecret;
  }

  if (probe.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetchImpl(probeUrl, {
    method: probe.method ?? "GET",
    headers,
    body: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  const parsedPayload = tryParseJson(text);
  const expectation = evaluateProbeExpectation(
    probe.expectation,
    parsedPayload,
    response.status,
    probe.responseField,
    probe.expectedStatus
  );

  if (!response.ok || !expectation.ok) {
    return {
      ok: false,
      message: expectation.ok
        ? `HTTP ${response.status} while probing ${manifest.name}`
        : `${manifest.name} probe returned HTTP ${response.status}: ${expectation.reason ?? "unexpected response"}`,
      metadata: {
        probeUrl,
        statusCode: response.status,
        responseShape: getJsonShape(parsedPayload),
        contentLength: text.length,
      },
    };
  }

  return {
    ok: true,
    remoteStatus: response.status >= 400 ? "degraded" : "ok",
    message:
      response.status >= 400
        ? `${manifest.name} probe reached the API but it reported HTTP ${response.status}.`
        : `${manifest.name} probe succeeded at ${probeUrl}.`,
    metadata: {
      probeUrl,
      statusCode: response.status,
      responseShape: getJsonShape(parsedPayload),
      contentLength: text.length,
    },
  };
}

export function createManifestConnector(
  manifest: ConnectorManifest,
  env: RuntimeEnv = process.env,
  fetchImpl: ConnectorFetch = fetch
): ConnectorAdapter {
  const probe = manifest.probe;
  const stub = manifest.stub === true;

  return {
    ...manifest,
    stub,
    async getStatus(): Promise<ConnectorStatus> {
      const checkedAt = new Date().toISOString();
      const missingSecrets = getProbeMissingSecrets(manifest, probe, env);

      if (missingSecrets.length > 0) {
        return {
          ...manifest,
          stub,
          status: "pending",
          configured: false,
          checkedAt,
          missingSecrets,
          message: probe
            ? `${manifest.name} live probe is waiting for ${missingSecrets.join(", ")}.`
            : `${manifest.name} connector is waiting for credentials: ${missingSecrets.join(", ")}.`,
        };
      }

      if (!probe) {
        return {
          ...manifest,
          stub,
          status: manifest.stub ? "pending" : "ok",
          configured: missingSecrets.length === 0,
          checkedAt,
          missingSecrets,
          message: manifest.stub
            ? `${manifest.name} manifest is configured and ready for deeper implementation.`
            : `${manifest.name} manifest is configured.`,
        };
      }

      try {
        const probeResult = await probeConnector(manifest, probe, env, fetchImpl);

        if (!probeResult.ok) {
          return {
            ...manifest,
            stub,
            status: "degraded",
            configured: true,
            checkedAt,
            missingSecrets: [],
            message: probeResult.message,
            metadata: probeResult.metadata,
          };
        }

        return {
          ...manifest,
          stub,
          status: probeResult.remoteStatus,
          configured: true,
          checkedAt,
          missingSecrets: [],
          message: probeResult.message,
          metadata: probeResult.metadata,
        };
    } catch (error) {
      return {
        ...manifest,
        stub,
        status: "degraded",
        configured: true,
        checkedAt,
          missingSecrets: [],
          message:
            error instanceof Error
              ? `${manifest.name} probe failed: ${error.message}`
              : `${manifest.name} probe failed with an unknown error.`,
        };
      }
    },
  };
}

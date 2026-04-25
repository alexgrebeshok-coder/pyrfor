var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { logger } from '../observability/logger.js';
export const CONNECTOR_MANIFESTS_ENV = "CEOCLAW_CONNECTOR_MANIFESTS";
function tryParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch (_a) {
        return undefined;
    }
}
function toStringRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return Object.entries(value).reduce((accumulator, [key, entry]) => {
        if (typeof entry === "string") {
            accumulator[key] = entry;
        }
        return accumulator;
    }, {});
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}
function normalizeCredentials(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const credentials = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }
        const record = item;
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
function normalizeProbe(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value;
    const baseUrlEnvVar = typeof record.baseUrlEnvVar === "string" ? record.baseUrlEnvVar.trim() : "";
    if (!baseUrlEnvVar) {
        return null;
    }
    const probe = {
        baseUrlEnvVar,
        path: typeof record.path === "string" && record.path.trim().length > 0 ? record.path.trim() : undefined,
        method: record.method === "POST" || record.method === "GET"
            ? record.method
            : undefined,
        authEnvVar: typeof record.authEnvVar === "string" && record.authEnvVar.trim().length > 0
            ? record.authEnvVar.trim()
            : undefined,
        authHeaderName: typeof record.authHeaderName === "string" && record.authHeaderName.trim().length > 0
            ? record.authHeaderName.trim()
            : undefined,
        authScheme: typeof record.authScheme === "string" && record.authScheme.trim().length > 0
            ? record.authScheme.trim()
            : undefined,
        expectedStatus: typeof record.expectedStatus === "number" && Number.isFinite(record.expectedStatus)
            ? record.expectedStatus
            : undefined,
        expectation: record.expectation === "status-only" ||
            record.expectation === "json-object" ||
            record.expectation === "json-array" ||
            record.expectation === "json-field"
            ? record.expectation
            : undefined,
        responseField: typeof record.responseField === "string" && record.responseField.trim().length > 0
            ? record.responseField.trim()
            : undefined,
        headers: toStringRecord(record.headers),
        body: record.body,
    };
    return probe;
}
function normalizeConnectorManifest(value, index) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        logger.warn("Skipping invalid connector manifest entry", { index, reason: "not an object" });
        return null;
    }
    const record = value;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    const direction = record.direction === "inbound" ||
        record.direction === "outbound" ||
        record.direction === "bidirectional"
        ? record.direction
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
            const itemRecord = item;
            const method = itemRecord.method === "GET" ||
                itemRecord.method === "POST" ||
                itemRecord.method === "WEBHOOK"
                ? itemRecord.method
                : null;
            const path = typeof itemRecord.path === "string" ? itemRecord.path.trim() : "";
            const surfaceDescription = typeof itemRecord.description === "string" ? itemRecord.description.trim() : "";
            if (!method || !path || !surfaceDescription) {
                return null;
            }
            return {
                method,
                path,
                description: surfaceDescription,
            };
        })
            .filter((item) => Boolean(item))
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
        probe: probe !== null && probe !== void 0 ? probe : undefined,
    };
}
export function loadConnectorManifestsFromEnv(env = process.env) {
    const raw = env[CONNECTOR_MANIFESTS_ENV];
    if (!(raw === null || raw === void 0 ? void 0 : raw.trim())) {
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
        .filter((item) => Boolean(item));
}
function getProbeMissingSecrets(manifest, probe, env) {
    var _a, _b;
    const missing = manifest.credentials
        .filter((credential) => credential.required !== false)
        .map((credential) => credential.envVar)
        .filter((envVar) => { var _a; return !((_a = env[envVar]) === null || _a === void 0 ? void 0 : _a.trim()); });
    if (probe) {
        if (!((_a = env[probe.baseUrlEnvVar]) === null || _a === void 0 ? void 0 : _a.trim())) {
            missing.push(probe.baseUrlEnvVar);
        }
        if (probe.authEnvVar && !((_b = env[probe.authEnvVar]) === null || _b === void 0 ? void 0 : _b.trim())) {
            missing.push(probe.authEnvVar);
        }
    }
    return Array.from(new Set(missing));
}
function getProbeUrl(baseUrl, path) {
    const url = new URL(baseUrl);
    const normalizedPath = path === null || path === void 0 ? void 0 : path.trim();
    if (!normalizedPath) {
        return url.toString();
    }
    const joinedPath = normalizedPath.startsWith("/")
        ? normalizedPath
        : `/${normalizedPath}`;
    url.pathname = `${url.pathname.replace(/\/$/, "")}${joinedPath}`;
    return url.toString();
}
function getJsonShape(value) {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "array";
    }
    return typeof value;
}
function readJsonField(value, fieldPath) {
    if (!fieldPath) {
        return value;
    }
    const segments = fieldPath.split(".").filter(Boolean);
    let current = value;
    for (const segment of segments) {
        if (!current || typeof current !== "object" || Array.isArray(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return current;
}
function evaluateProbeExpectation(expectation, parsedPayload, responseStatus, responseField, expectedStatus) {
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
function probeConnector(manifest, probe, env, fetchImpl) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        const baseUrl = (_a = env[probe.baseUrlEnvVar]) === null || _a === void 0 ? void 0 : _a.trim();
        const authSecret = probe.authEnvVar ? (_b = env[probe.authEnvVar]) === null || _b === void 0 ? void 0 : _b.trim() : null;
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
        let probeUrl;
        try {
            probeUrl = getProbeUrl(baseUrl, (_c = probe.path) !== null && _c !== void 0 ? _c : "/health");
        }
        catch (error) {
            return {
                ok: false,
                message: error instanceof Error
                    ? `${manifest.name} probe failed to build URL: ${error.message}`
                    : `${manifest.name} probe failed to build URL.`,
                metadata: {
                    probeUrl: baseUrl,
                    responseShape: null,
                },
            };
        }
        const headers = Object.assign({ Accept: "application/json" }, probe.headers);
        if (authSecret) {
            headers[(_d = probe.authHeaderName) !== null && _d !== void 0 ? _d : "Authorization"] = probe.authScheme
                ? `${probe.authScheme} ${authSecret}`
                : authSecret;
        }
        if (probe.body !== undefined) {
            headers["Content-Type"] = "application/json";
        }
        const response = yield fetchImpl(probeUrl, {
            method: (_e = probe.method) !== null && _e !== void 0 ? _e : "GET",
            headers,
            body: probe.body !== undefined ? JSON.stringify(probe.body) : undefined,
            cache: "no-store",
        });
        const text = yield response.text();
        const parsedPayload = tryParseJson(text);
        const expectation = evaluateProbeExpectation(probe.expectation, parsedPayload, response.status, probe.responseField, probe.expectedStatus);
        if (!response.ok || !expectation.ok) {
            return {
                ok: false,
                message: expectation.ok
                    ? `HTTP ${response.status} while probing ${manifest.name}`
                    : `${manifest.name} probe returned HTTP ${response.status}: ${(_f = expectation.reason) !== null && _f !== void 0 ? _f : "unexpected response"}`,
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
            message: response.status >= 400
                ? `${manifest.name} probe reached the API but it reported HTTP ${response.status}.`
                : `${manifest.name} probe succeeded at ${probeUrl}.`,
            metadata: {
                probeUrl,
                statusCode: response.status,
                responseShape: getJsonShape(parsedPayload),
                contentLength: text.length,
            },
        };
    });
}
export function createManifestConnector(manifest, env = process.env, fetchImpl = fetch) {
    const probe = manifest.probe;
    const stub = manifest.stub === true;
    return Object.assign(Object.assign({}, manifest), { stub,
        getStatus() {
            return __awaiter(this, void 0, void 0, function* () {
                const checkedAt = new Date().toISOString();
                const missingSecrets = getProbeMissingSecrets(manifest, probe, env);
                if (missingSecrets.length > 0) {
                    return Object.assign(Object.assign({}, manifest), { stub, status: "pending", configured: false, checkedAt,
                        missingSecrets, message: probe
                            ? `${manifest.name} live probe is waiting for ${missingSecrets.join(", ")}.`
                            : `${manifest.name} connector is waiting for credentials: ${missingSecrets.join(", ")}.` });
                }
                if (!probe) {
                    return Object.assign(Object.assign({}, manifest), { stub, status: manifest.stub ? "pending" : "ok", configured: missingSecrets.length === 0, checkedAt,
                        missingSecrets, message: manifest.stub
                            ? `${manifest.name} manifest is configured and ready for deeper implementation.`
                            : `${manifest.name} manifest is configured.` });
                }
                try {
                    const probeResult = yield probeConnector(manifest, probe, env, fetchImpl);
                    if (!probeResult.ok) {
                        return Object.assign(Object.assign({}, manifest), { stub, status: "degraded", configured: true, checkedAt, missingSecrets: [], message: probeResult.message, metadata: probeResult.metadata });
                    }
                    return Object.assign(Object.assign({}, manifest), { stub, status: probeResult.remoteStatus, configured: true, checkedAt, missingSecrets: [], message: probeResult.message, metadata: probeResult.metadata });
                }
                catch (error) {
                    return Object.assign(Object.assign({}, manifest), { stub, status: "degraded", configured: true, checkedAt, missingSecrets: [], message: error instanceof Error
                            ? `${manifest.name} probe failed: ${error.message}`
                            : `${manifest.name} probe failed with an unknown error.` });
                }
            });
        } });
}

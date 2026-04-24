"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGpsApiUrl = getGpsApiUrl;
exports.getGpsApiKey = getGpsApiKey;
exports.buildGpsProbeUrl = buildGpsProbeUrl;
exports.buildGpsSessionsUrl = buildGpsSessionsUrl;
exports.buildGpsSampleUrl = buildGpsSampleUrl;
exports.probeGpsApi = probeGpsApi;
exports.fetchGpsTelemetrySample = fetchGpsTelemetrySample;
exports.getGpsTelemetrySampleSnapshot = getGpsTelemetrySampleSnapshot;
exports.getGpsTelemetryTruthSnapshot = getGpsTelemetryTruthSnapshot;
exports.buildGpsTelemetryTruthSnapshot = buildGpsTelemetryTruthSnapshot;
function getGpsApiUrl(env = process.env) {
    return env.GPS_API_URL?.trim() || null;
}
function getGpsApiKey(env = process.env) {
    return env.GPS_API_KEY?.trim() || null;
}
function buildGpsProbeUrl(baseUrl) {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/$/, "");
    if (!url.search && !hasExplicitProbePath(normalizedPath)) {
        url.pathname = `${normalizedPath}/session-stats`;
    }
    return url.toString();
}
function buildGpsSessionsUrl(baseUrl, pageSize = 3) {
    const url = new URL(baseUrl);
    const normalizedPath = url.pathname.replace(/\/$/, "");
    if (!url.search) {
        if (normalizedPath.endsWith("/sessions")) {
            url.pathname = normalizedPath;
        }
        else if (normalizedPath.endsWith("/session-stats")) {
            url.pathname = normalizedPath.replace(/\/session-stats$/, "/sessions");
        }
        else if (normalizedPath.endsWith("/health") || normalizedPath.endsWith("/status")) {
            url.pathname = normalizedPath.replace(/\/(health|status)$/, "/sessions");
        }
        else {
            url.pathname = `${normalizedPath}/sessions`;
        }
    }
    if (!url.searchParams.has("page_size")) {
        url.searchParams.set("page_size", String(sanitizePageSize(pageSize, 3, 24)));
    }
    return url.toString();
}
function buildGpsSampleUrl(baseUrl) {
    return buildGpsSessionsUrl(baseUrl, 3);
}
async function probeGpsApi(input, fetchImpl = fetch) {
    const probeUrl = buildGpsProbeUrl(input.baseUrl);
    const response = await fetchImpl(probeUrl, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${input.apiKey}`,
            "X-API-Key": input.apiKey,
        },
        cache: "no-store",
    });
    const text = await response.text();
    const parsedPayload = parseJson(text);
    if (!response.ok) {
        return {
            ok: false,
            probeUrl,
            status: response.status,
            message: `HTTP ${response.status} while calling GPS probe`,
            metadata: {
                probeUrl,
                responseShape: describePayloadShape(parsedPayload),
            },
        };
    }
    if (parsedPayload === undefined || parsedPayload === null) {
        return {
            ok: false,
            probeUrl,
            message: parsedPayload === null
                ? "GPS probe returned an empty payload."
                : "GPS probe returned a non-JSON payload.",
            metadata: {
                probeUrl,
                contentLength: text.length,
            },
        };
    }
    const interpretation = interpretGpsPayload(parsedPayload, probeUrl);
    return {
        ok: true,
        probeUrl,
        remoteStatus: interpretation.remoteStatus,
        message: interpretation.message,
        metadata: interpretation.metadata,
    };
}
async function fetchGpsTelemetrySample(input, fetchImpl = fetch) {
    const sampleUrl = buildGpsSessionsUrl(input.baseUrl, input.pageSize ?? 3);
    const response = await fetchImpl(sampleUrl, {
        method: "GET",
        headers: buildGpsHeaders(input.apiKey),
        cache: "no-store",
    });
    const text = await response.text();
    const parsedPayload = parseJson(text);
    if (!response.ok) {
        return {
            ok: false,
            sampleUrl,
            status: response.status,
            message: `HTTP ${response.status} while calling GPS telemetry sample`,
            metadata: {
                sampleUrl,
                responseShape: describePayloadShape(parsedPayload),
            },
        };
    }
    if (parsedPayload === undefined || parsedPayload === null) {
        return {
            ok: false,
            sampleUrl,
            message: parsedPayload === null
                ? "GPS telemetry sample returned an empty payload."
                : "GPS telemetry sample returned a non-JSON payload.",
            metadata: {
                sampleUrl,
                contentLength: text.length,
            },
        };
    }
    const samples = normalizeGpsTelemetrySamples(parsedPayload);
    if (samples.length === 0) {
        return {
            ok: false,
            sampleUrl,
            message: "GPS telemetry sample returned JSON, but no session-like records were found.",
            metadata: {
                sampleUrl,
                responseShape: describePayloadShape(parsedPayload),
            },
        };
    }
    const provider = readStringField(parsedPayload, ["provider", "source", "vendor", "platform"]);
    return {
        ok: true,
        sampleUrl,
        message: `GPS telemetry sample returned ${samples.length} session record${samples.length === 1 ? "" : "s"} from ${new URL(sampleUrl).pathname}.`,
        samples,
        metadata: {
            sampleUrl,
            responseShape: describePayloadShape(parsedPayload),
            sampleCount: samples.length,
            requestedPageSize: sanitizePageSize(input.pageSize, 3, 24),
            ...(provider ? { provider } : {}),
        },
    };
}
async function getGpsTelemetrySampleSnapshot(env = process.env, fetchImpl = fetch) {
    return getGpsTelemetryBaseSnapshot({
        env,
        fetchImpl,
        pageSize: 3,
    });
}
async function getGpsTelemetryTruthSnapshot(options = {}) {
    const snapshot = await getGpsTelemetryBaseSnapshot({
        env: options.env,
        fetchImpl: options.fetchImpl,
        pageSize: options.pageSize ?? 12,
    });
    return buildGpsTelemetryTruthSnapshot(snapshot);
}
function buildGpsTelemetryTruthSnapshot(snapshot) {
    const sessions = buildNormalizedGpsSessions(snapshot.samples);
    const equipment = buildGpsEquipmentTruth(sessions);
    const geofences = buildGpsGeofenceTruth(sessions);
    return {
        ...snapshot,
        summary: {
            sessionCount: sessions.length,
            equipmentCount: equipment.length,
            geofenceCount: geofences.length,
            totalDurationSeconds: sessions.reduce((total, session) => total + (session.durationSeconds ?? 0), 0),
            openEndedSessionCount: sessions.filter((session) => session.hasOpenEndedRange).length,
            equipmentLinkedSessions: sessions.filter((session) => session.equipmentKey !== null).length,
            geofenceLinkedSessions: sessions.filter((session) => session.geofenceKey !== null).length,
        },
        sessions,
        equipment,
        geofences,
    };
}
async function getGpsTelemetryBaseSnapshot(input) {
    const checkedAt = new Date().toISOString();
    const env = input.env ?? process.env;
    const fetchImpl = input.fetchImpl ?? fetch;
    const apiUrl = getGpsApiUrl(env);
    const apiKey = getGpsApiKey(env);
    const missingSecrets = [
        ...(apiUrl ? [] : ["GPS_API_URL"]),
        ...(apiKey ? [] : ["GPS_API_KEY"]),
    ];
    if (missingSecrets.length > 0) {
        return {
            id: "gps",
            checkedAt,
            configured: false,
            status: "pending",
            message: "GPS telemetry sample is waiting for GPS_API_URL and GPS_API_KEY.",
            missingSecrets,
            samples: [],
        };
    }
    try {
        const result = await fetchGpsTelemetrySample({
            baseUrl: apiUrl,
            apiKey: apiKey,
            pageSize: input.pageSize,
        }, fetchImpl);
        if (!result.ok) {
            return {
                id: "gps",
                checkedAt,
                configured: true,
                status: "degraded",
                message: `GPS telemetry sample failed: ${result.message}`,
                missingSecrets: [],
                sampleUrl: result.sampleUrl,
                samples: [],
                metadata: result.metadata,
            };
        }
        return {
            id: "gps",
            checkedAt,
            configured: true,
            status: "ok",
            message: result.message,
            missingSecrets: [],
            sampleUrl: result.sampleUrl,
            samples: result.samples,
            metadata: result.metadata,
        };
    }
    catch (error) {
        return {
            id: "gps",
            checkedAt,
            configured: true,
            status: "degraded",
            message: error instanceof Error
                ? `GPS telemetry sample failed: ${error.message}`
                : "GPS telemetry sample failed with an unknown error.",
            missingSecrets: [],
            samples: [],
        };
    }
}
function buildNormalizedGpsSessions(samples) {
    return samples
        .map((sample, index) => {
        const equipmentKey = buildGpsEntityKey("equipment", sample.equipmentId);
        const geofenceKey = buildGpsEntityKey("geofence", sample.geofenceId ?? sample.geofenceName);
        const observedAt = sample.endedAt ?? sample.startedAt ?? null;
        return {
            ...sample,
            sessionKey: buildGpsEntityKey("session", sample.sessionId ??
                [sample.equipmentId, sample.startedAt, sample.endedAt, String(index)]
                    .filter(Boolean)
                    .join(":")) ?? `gps-session:${index}`,
            equipmentKey,
            geofenceKey,
            observedAt,
            hasOpenEndedRange: sample.startedAt !== null && sample.endedAt === null,
        };
    })
        .sort((left, right) => compareTimestamps(right.observedAt, left.observedAt));
}
function buildGpsEquipmentTruth(sessions) {
    const equipmentMap = new Map();
    for (const session of sessions) {
        if (!session.equipmentKey) {
            continue;
        }
        const existing = equipmentMap.get(session.equipmentKey) ?? {
            equipmentKey: session.equipmentKey,
            equipmentId: session.equipmentId,
            equipmentType: session.equipmentType,
            sessionCount: 0,
            totalDurationSeconds: 0,
            latestObservedAt: null,
            latestStatus: null,
            latestGeofenceKey: null,
            latestGeofenceName: null,
        };
        existing.sessionCount += 1;
        existing.totalDurationSeconds += session.durationSeconds ?? 0;
        existing.equipmentId = existing.equipmentId ?? session.equipmentId;
        existing.equipmentType = existing.equipmentType ?? session.equipmentType;
        if (compareTimestamps(session.observedAt, existing.latestObservedAt) > 0) {
            existing.latestObservedAt = session.observedAt;
            existing.latestStatus = session.status;
            existing.latestGeofenceKey = session.geofenceKey;
            existing.latestGeofenceName = session.geofenceName;
        }
        equipmentMap.set(session.equipmentKey, existing);
    }
    return Array.from(equipmentMap.values()).sort((left, right) => {
        const observedDiff = compareTimestamps(right.latestObservedAt, left.latestObservedAt);
        if (observedDiff !== 0) {
            return observedDiff;
        }
        return right.sessionCount - left.sessionCount;
    });
}
function buildGpsGeofenceTruth(sessions) {
    const geofenceMap = new Map();
    for (const session of sessions) {
        if (!session.geofenceKey) {
            continue;
        }
        const existing = geofenceMap.get(session.geofenceKey) ?? {
            geofenceKey: session.geofenceKey,
            geofenceId: session.geofenceId,
            geofenceName: session.geofenceName,
            sessionCount: 0,
            equipmentCount: 0,
            totalDurationSeconds: 0,
            latestObservedAt: null,
            equipmentIds: [],
            equipmentKeySet: new Set(),
        };
        existing.sessionCount += 1;
        existing.totalDurationSeconds += session.durationSeconds ?? 0;
        existing.geofenceId = existing.geofenceId ?? session.geofenceId;
        existing.geofenceName = existing.geofenceName ?? session.geofenceName;
        if (session.equipmentKey && !existing.equipmentKeySet.has(session.equipmentKey)) {
            existing.equipmentKeySet.add(session.equipmentKey);
            existing.equipmentCount += 1;
        }
        if (session.equipmentId && !existing.equipmentIds.includes(session.equipmentId)) {
            existing.equipmentIds.push(session.equipmentId);
        }
        if (compareTimestamps(session.observedAt, existing.latestObservedAt) > 0) {
            existing.latestObservedAt = session.observedAt;
        }
        geofenceMap.set(session.geofenceKey, existing);
    }
    return Array.from(geofenceMap.values(), (entry) => ({
        geofenceKey: entry.geofenceKey,
        geofenceId: entry.geofenceId,
        geofenceName: entry.geofenceName,
        sessionCount: entry.sessionCount,
        equipmentCount: entry.equipmentCount,
        totalDurationSeconds: entry.totalDurationSeconds,
        latestObservedAt: entry.latestObservedAt,
        equipmentIds: entry.equipmentIds,
    }))
        .sort((left, right) => {
        const observedDiff = compareTimestamps(right.latestObservedAt, left.latestObservedAt);
        if (observedDiff !== 0) {
            return observedDiff;
        }
        return right.sessionCount - left.sessionCount;
    });
}
function interpretGpsPayload(payload, probeUrl) {
    const metadata = {
        probeUrl,
        responseShape: describePayloadShape(payload),
    };
    const statusValue = readStringField(payload, ["status", "health"]);
    const provider = readStringField(payload, ["provider", "source", "vendor", "platform"]);
    const equipmentCount = readNumberField(payload, [
        "total_equipment",
        "equipment_count",
        "totalEquipment",
    ]);
    const onlineEquipment = readNumberField(payload, [
        "online_equipment",
        "onlineEquipment",
    ]);
    const offlineEquipment = readNumberField(payload, [
        "offline_equipment",
        "offlineEquipment",
    ]);
    const activeAlerts = readNumberField(payload, ["active_alerts", "activeAlerts"]);
    const activeGeofences = readNumberField(payload, [
        "active_geofences",
        "activeGeofences",
    ]);
    const healthy = readBooleanField(payload, ["healthy", "ok"]);
    if (provider)
        metadata.provider = provider;
    if (statusValue)
        metadata.remoteStatus = statusValue;
    if (equipmentCount !== null)
        metadata.equipmentCount = equipmentCount;
    if (onlineEquipment !== null)
        metadata.onlineEquipment = onlineEquipment;
    if (offlineEquipment !== null)
        metadata.offlineEquipment = offlineEquipment;
    if (activeAlerts !== null)
        metadata.activeAlerts = activeAlerts;
    if (activeGeofences !== null)
        metadata.activeGeofences = activeGeofences;
    const remoteStatus = healthy === false || isDegradedStatus(statusValue) ? "degraded" : "ok";
    const message = remoteStatus === "degraded"
        ? `GPS API responded from ${new URL(probeUrl).pathname}, but reported degraded health${statusValue ? `: ${statusValue}` : ""}.`
        : `GPS API responded from ${new URL(probeUrl).pathname}.`;
    return {
        remoteStatus,
        message,
        metadata,
    };
}
function normalizeGpsTelemetrySamples(payload) {
    const { entries, defaults } = extractSessionEntries(payload);
    return entries
        .map((entry) => normalizeGpsTelemetrySample(entry, defaults))
        .filter((entry) => entry !== null);
}
function extractSessionEntries(payload) {
    if (Array.isArray(payload)) {
        return {
            entries: payload,
            defaults: null,
        };
    }
    if (!payload || typeof payload !== "object") {
        return {
            entries: [],
            defaults: null,
        };
    }
    const record = payload;
    if (Array.isArray(record.sessions)) {
        return {
            entries: record.sessions,
            defaults: record,
        };
    }
    if (Array.isArray(record.items)) {
        return {
            entries: record.items,
            defaults: record,
        };
    }
    if (looksLikeSessionRecord(record)) {
        return {
            entries: [record],
            defaults: record,
        };
    }
    return {
        entries: [],
        defaults: record,
    };
}
function normalizeGpsTelemetrySample(payload, defaults) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    const record = payload;
    const sessionId = readStringField(record, ["session_id", "sessionId", "id"]) ??
        readStringField(defaults, ["session_id", "sessionId", "id"]);
    const equipmentId = readStringField(record, ["equipment_id", "equipmentId"]) ??
        readStringField(defaults, ["equipment_id", "equipmentId"]);
    const equipmentType = readStringField(record, ["equipment_type", "equipmentType"]) ??
        readStringField(defaults, ["equipment_type", "equipmentType"]);
    const status = readStringField(record, ["session_type", "sessionType", "status", "type"]) ?? "session";
    const startedAt = readStringField(record, ["started_at", "startedAt", "start_time", "startTime"]) ??
        readStringField(defaults, ["started_at", "startedAt", "start_time", "startTime"]);
    const endedAt = readStringField(record, ["ended_at", "endedAt", "end_time", "endTime"]) ??
        readStringField(defaults, ["ended_at", "endedAt", "end_time", "endTime"]);
    const durationSeconds = readNumberField(record, ["duration_seconds", "durationSeconds", "duration"]) ??
        deriveDurationSeconds(startedAt, endedAt);
    const geofenceId = readStringField(record, ["geofence_id", "geofenceId"]) ??
        readStringField(defaults, ["geofence_id", "geofenceId"]);
    const geofenceName = readStringField(record, ["geofence_name", "geofenceName"]) ??
        readStringField(defaults, ["geofence_name", "geofenceName"]);
    if (!sessionId &&
        !equipmentId &&
        !startedAt &&
        !endedAt &&
        durationSeconds === null &&
        status === "session") {
        return null;
    }
    return {
        source: "gps",
        sessionId,
        equipmentId,
        equipmentType,
        status,
        startedAt,
        endedAt,
        durationSeconds,
        geofenceId,
        geofenceName,
    };
}
function looksLikeSessionRecord(record) {
    return Boolean(readStringField(record, ["session_id", "sessionId"]) ||
        readStringField(record, ["equipment_id", "equipmentId"]) ||
        readStringField(record, ["started_at", "startedAt", "start_time", "startTime"]) ||
        readStringField(record, ["ended_at", "endedAt", "end_time", "endTime"]));
}
function deriveDurationSeconds(startedAt, endedAt) {
    if (!startedAt || !endedAt) {
        return null;
    }
    const startedMs = Date.parse(startedAt);
    const endedMs = Date.parse(endedAt);
    if (!Number.isFinite(startedMs) || !Number.isFinite(endedMs) || endedMs < startedMs) {
        return null;
    }
    return Math.round((endedMs - startedMs) / 1000);
}
function sanitizePageSize(value, fallback, max) {
    if (!Number.isFinite(value) || value === undefined) {
        return fallback;
    }
    const rounded = Math.round(value);
    if (rounded < 1) {
        return 1;
    }
    return Math.min(rounded, max);
}
function buildGpsEntityKey(prefix, value) {
    if (!value) {
        return null;
    }
    const normalized = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized ? `gps-${prefix}:${normalized}` : null;
}
function compareTimestamps(left, right) {
    const leftMs = left ? Date.parse(left) : Number.NEGATIVE_INFINITY;
    const rightMs = right ? Date.parse(right) : Number.NEGATIVE_INFINITY;
    if (!Number.isFinite(leftMs) && !Number.isFinite(rightMs)) {
        return 0;
    }
    if (!Number.isFinite(leftMs)) {
        return -1;
    }
    if (!Number.isFinite(rightMs)) {
        return 1;
    }
    return leftMs - rightMs;
}
function hasExplicitProbePath(pathname) {
    return (pathname.endsWith("/session-stats") ||
        pathname.endsWith("/sessions") ||
        pathname.endsWith("/health") ||
        pathname.endsWith("/status"));
}
function isDegradedStatus(value) {
    if (!value) {
        return false;
    }
    const normalized = value.trim().toLowerCase();
    return (normalized === "degraded" ||
        normalized === "error" ||
        normalized === "down" ||
        normalized === "offline" ||
        normalized === "unhealthy");
}
function parseJson(value) {
    if (!value.trim()) {
        return null;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return undefined;
    }
}
function describePayloadShape(payload) {
    if (Array.isArray(payload)) {
        return "array";
    }
    if (payload && typeof payload === "object") {
        return "object";
    }
    if (payload === null) {
        return "null";
    }
    return typeof payload;
}
function buildGpsHeaders(apiKey) {
    return {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
    };
}
function readStringField(payload, keys) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return null;
}
function readNumberField(payload, keys) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    return null;
}
function readBooleanField(payload, keys) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return null;
    }
    for (const key of keys) {
        const value = payload[key];
        if (typeof value === "boolean") {
            return value;
        }
    }
    return null;
}

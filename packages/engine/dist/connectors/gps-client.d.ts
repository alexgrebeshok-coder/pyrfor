type GpsFetch = typeof fetch;
type GpsProbeMetadata = Record<string, string | number | boolean | null>;
type GpsSampleMetadata = Record<string, string | number | boolean | null>;
export interface GpsTelemetrySample {
    source: "gps";
    sessionId: string | null;
    equipmentId: string | null;
    equipmentType: string | null;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
    geofenceId: string | null;
    geofenceName: string | null;
}
export interface GpsTelemetrySampleSnapshot {
    id: "gps";
    checkedAt: string;
    configured: boolean;
    status: "ok" | "pending" | "degraded";
    message: string;
    missingSecrets: string[];
    sampleUrl?: string;
    samples: GpsTelemetrySample[];
    metadata?: GpsSampleMetadata;
}
export interface GpsTelemetryNormalizedSession extends GpsTelemetrySample {
    sessionKey: string;
    equipmentKey: string | null;
    geofenceKey: string | null;
    observedAt: string | null;
    hasOpenEndedRange: boolean;
}
export interface GpsTelemetryEquipmentTruth {
    equipmentKey: string;
    equipmentId: string | null;
    equipmentType: string | null;
    sessionCount: number;
    totalDurationSeconds: number;
    latestObservedAt: string | null;
    latestStatus: string | null;
    latestGeofenceKey: string | null;
    latestGeofenceName: string | null;
}
export interface GpsTelemetryGeofenceTruth {
    geofenceKey: string;
    geofenceId: string | null;
    geofenceName: string | null;
    sessionCount: number;
    equipmentCount: number;
    totalDurationSeconds: number;
    latestObservedAt: string | null;
    equipmentIds: string[];
}
export interface GpsTelemetryTruthSummary {
    sessionCount: number;
    equipmentCount: number;
    geofenceCount: number;
    totalDurationSeconds: number;
    openEndedSessionCount: number;
    equipmentLinkedSessions: number;
    geofenceLinkedSessions: number;
}
export interface GpsTelemetryTruthSnapshot extends GpsTelemetrySampleSnapshot {
    summary: GpsTelemetryTruthSummary;
    sessions: GpsTelemetryNormalizedSession[];
    equipment: GpsTelemetryEquipmentTruth[];
    geofences: GpsTelemetryGeofenceTruth[];
}
export declare function getGpsApiUrl(env?: NodeJS.ProcessEnv): string | null;
export declare function getGpsApiKey(env?: NodeJS.ProcessEnv): string | null;
export declare function buildGpsProbeUrl(baseUrl: string): string;
export declare function buildGpsSessionsUrl(baseUrl: string, pageSize?: number): string;
export declare function buildGpsSampleUrl(baseUrl: string): string;
export declare function probeGpsApi(input: {
    baseUrl: string;
    apiKey: string;
}, fetchImpl?: GpsFetch): Promise<{
    ok: true;
    probeUrl: string;
    remoteStatus: "ok" | "degraded";
    message: string;
    metadata: GpsProbeMetadata;
} | {
    ok: false;
    probeUrl: string;
    message: string;
    status?: number;
    metadata?: GpsProbeMetadata;
}>;
export declare function fetchGpsTelemetrySample(input: {
    baseUrl: string;
    apiKey: string;
    pageSize?: number;
}, fetchImpl?: GpsFetch): Promise<{
    ok: true;
    sampleUrl: string;
    message: string;
    samples: GpsTelemetrySample[];
    metadata: GpsSampleMetadata;
} | {
    ok: false;
    sampleUrl: string;
    message: string;
    status?: number;
    metadata?: GpsSampleMetadata;
}>;
export declare function getGpsTelemetrySampleSnapshot(env?: NodeJS.ProcessEnv, fetchImpl?: GpsFetch): Promise<GpsTelemetrySampleSnapshot>;
export declare function getGpsTelemetryTruthSnapshot(options?: {
    pageSize?: number;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: GpsFetch;
}): Promise<GpsTelemetryTruthSnapshot>;
export declare function buildGpsTelemetryTruthSnapshot(snapshot: GpsTelemetrySampleSnapshot): GpsTelemetryTruthSnapshot;
export {};
//# sourceMappingURL=gps-client.d.ts.map
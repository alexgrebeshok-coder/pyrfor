"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerDataMode = getServerDataMode;
exports.isDatabaseConfigured = isDatabaseConfigured;
exports.shouldServeMockData = shouldServeMockData;
exports.getServerRuntimeState = getServerRuntimeState;
exports.getLiveOperatorDataBlockReason = getLiveOperatorDataBlockReason;
exports.canReadLiveOperatorData = canReadLiveOperatorData;
function normalizeMode(value) {
    switch (value?.trim().toLowerCase()) {
        case "demo":
            return "demo";
        case "live":
            return "live";
        default:
            return "auto";
    }
}
/**
 * Legacy compatibility for `APP_DATA_MODE`. Production should treat live DB configuration
 * as the source of truth and stop relying on this variable.
 */
function getServerDataMode(env = process.env) {
    return normalizeMode(env.APP_DATA_MODE);
}
function getNormalizedDatabaseUrl(env = process.env) {
    // Active runtime paths are Postgres-only.
    const postgresUrl = env.POSTGRES_PRISMA_URL?.trim();
    if (postgresUrl)
        return postgresUrl;
    const databaseUrl = env.DATABASE_URL?.trim();
    if (databaseUrl)
        return databaseUrl;
    const postgresFallback = env.POSTGRES_URL?.trim();
    return postgresFallback || null;
}
function isDatabaseConfigured(env = process.env) {
    const databaseUrl = getNormalizedDatabaseUrl(env);
    if (!databaseUrl)
        return false;
    // The Prisma datasource is PostgreSQL (Neon). The URL must include a database segment (e.g., /db) so we avoid fake placeholders.
    const postgresPattern = /^postgres(?:ql)?:\/\/[^/]+\/.+$/;
    return postgresPattern.test(databaseUrl);
}
function shouldServeMockData() {
    // Mock data mode has been retired; always require a live database.
    return false;
}
function getServerRuntimeState(env = process.env) {
    const dataMode = getServerDataMode(env);
    const databaseConfigured = isDatabaseConfigured(env);
    const healthStatus = databaseConfigured ? "ok" : "degraded";
    return {
        dataMode,
        databaseConfigured,
        healthStatus,
    };
}
function getLiveOperatorDataBlockReason(runtime) {
    if (!runtime.databaseConfigured) {
        return "database_unavailable";
    }
    return null;
}
function canReadLiveOperatorData(runtime) {
    return getLiveOperatorDataBlockReason(runtime) === null;
}

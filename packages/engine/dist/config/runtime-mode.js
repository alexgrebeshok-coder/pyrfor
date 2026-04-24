function normalizeMode(value) {
    switch (value === null || value === void 0 ? void 0 : value.trim().toLowerCase()) {
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
export function getServerDataMode(env = process.env) {
    return normalizeMode(env.APP_DATA_MODE);
}
function getNormalizedDatabaseUrl(env = process.env) {
    var _a, _b, _c;
    // Active runtime paths are Postgres-only.
    const postgresUrl = (_a = env.POSTGRES_PRISMA_URL) === null || _a === void 0 ? void 0 : _a.trim();
    if (postgresUrl)
        return postgresUrl;
    const databaseUrl = (_b = env.DATABASE_URL) === null || _b === void 0 ? void 0 : _b.trim();
    if (databaseUrl)
        return databaseUrl;
    const postgresFallback = (_c = env.POSTGRES_URL) === null || _c === void 0 ? void 0 : _c.trim();
    return postgresFallback || null;
}
export function isDatabaseConfigured(env = process.env) {
    const databaseUrl = getNormalizedDatabaseUrl(env);
    if (!databaseUrl)
        return false;
    // The Prisma datasource is PostgreSQL (Neon). The URL must include a database segment (e.g., /db) so we avoid fake placeholders.
    const postgresPattern = /^postgres(?:ql)?:\/\/[^/]+\/.+$/;
    return postgresPattern.test(databaseUrl);
}
export function shouldServeMockData() {
    // Mock data mode has been retired; always require a live database.
    return false;
}
export function getServerRuntimeState(env = process.env) {
    const dataMode = getServerDataMode(env);
    const databaseConfigured = isDatabaseConfigured(env);
    const healthStatus = databaseConfigured ? "ok" : "degraded";
    return {
        dataMode,
        databaseConfigured,
        healthStatus,
    };
}
export function getLiveOperatorDataBlockReason(runtime) {
    if (!runtime.databaseConfigured) {
        return "database_unavailable";
    }
    return null;
}
export function canReadLiveOperatorData(runtime) {
    return getLiveOperatorDataBlockReason(runtime) === null;
}

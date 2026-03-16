export type ServerDataMode = "auto" | "demo" | "live";
export type LiveOperatorDataBlockReason = "database_unavailable" | "demo_mode";
export interface ServerRuntimeState {
  dataMode: ServerDataMode;
  databaseConfigured: boolean;
  usingMockData: boolean;
  healthStatus: "degraded" | "ok";
}

type RuntimeEnv = NodeJS.ProcessEnv;

function normalizeMode(value: string | undefined): ServerDataMode {
  switch (value?.trim().toLowerCase()) {
    case "demo":
      return "demo";
    case "live":
      return "live";
    default:
      return "auto";
  }
}

export function getServerDataMode(env: RuntimeEnv = process.env): ServerDataMode {
  return normalizeMode(env.APP_DATA_MODE);
}

function getNormalizedDatabaseUrl(env: RuntimeEnv = process.env): string | null {
  // Check for Turso (libsql) first - recommended for RF
  const tursoUrl = env.TURSO_DATABASE_URL?.trim();
  if (tursoUrl) return tursoUrl;
  
  // Prefer POSTGRES_PRISMA_URL for Neon PostgreSQL, fallback to DATABASE_URL
  const postgresUrl = env.POSTGRES_PRISMA_URL?.trim();
  if (postgresUrl) return postgresUrl;
  
  const databaseUrl = env.DATABASE_URL?.trim();
  return databaseUrl ? databaseUrl : null;
}

export function isDatabaseConfigured(env: RuntimeEnv = process.env): boolean {
  const databaseUrl = getNormalizedDatabaseUrl(env);
  if (!databaseUrl) return false;

  // Turso uses libsql:// protocol
  if (databaseUrl.startsWith("libsql://")) {
    // Also need auth token for Turso
    return !!env.TURSO_AUTH_TOKEN;
  }

  // The Prisma datasource is PostgreSQL (Neon), so the URL must start with postgresql:// or postgres://
  // For development (SQLite), allow file: uri scheme
  return databaseUrl.startsWith("postgresql://") || databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("file:");
}

export function shouldServeMockData(env: RuntimeEnv = process.env): boolean {
  const mode = getServerDataMode(env);
  if (mode === "demo") return true;
  return !isDatabaseConfigured(env);
}

export function getServerRuntimeState(env: RuntimeEnv = process.env): ServerRuntimeState {
  const dataMode = getServerDataMode(env);
  const databaseConfigured = isDatabaseConfigured(env);
  const usingMockData = shouldServeMockData(env);
  const healthStatus =
    dataMode === "live" && !databaseConfigured ? "degraded" : "ok";

  return {
    dataMode,
    databaseConfigured,
    usingMockData,
    healthStatus,
  };
}

export function getLiveOperatorDataBlockReason(
  runtime: ServerRuntimeState
): LiveOperatorDataBlockReason | null {
  if (runtime.usingMockData) {
    return runtime.dataMode === "demo" ? "demo_mode" : "database_unavailable";
  }

  if (!runtime.databaseConfigured) {
    return "database_unavailable";
  }

  return null;
}

export function canReadLiveOperatorData(runtime: ServerRuntimeState): boolean {
  return getLiveOperatorDataBlockReason(runtime) === null;
}

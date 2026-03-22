export type ServerDataMode = "auto" | "demo" | "live";
export type LiveOperatorDataBlockReason = "database_unavailable";
export interface ServerRuntimeState {
  dataMode: ServerDataMode;
  databaseConfigured: boolean;
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

function isLocalAppUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const url = new URL(value);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".local")
    );
  } catch {
    return /localhost|127\.0\.0\.1/.test(value);
  }
}

/**
 * Legacy compatibility for `APP_DATA_MODE`. Production should treat live DB configuration
 * as the source of truth and stop relying on this variable.
 */
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
  
  // Check DATABASE_URL (standard Prisma variable)
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) return databaseUrl;
  
  // Also check POSTGRES_URL as fallback
  const postgresFallback = env.POSTGRES_URL?.trim();
  return postgresFallback || null;
}

export function isDatabaseConfigured(env: RuntimeEnv = process.env): boolean {
  const databaseUrl = getNormalizedDatabaseUrl(env);
  if (!databaseUrl) return false;

  if (databaseUrl.startsWith("file:")) {
    return (
      env.NODE_ENV !== "production" ||
      isLocalAppUrl(env.NEXT_PUBLIC_APP_URL) ||
      isLocalAppUrl(env.NEXTAUTH_URL)
    );
  }

  // Turso uses libsql:// protocol
  if (databaseUrl.startsWith("libsql://")) {
    // Also need auth token for Turso
    return !!env.TURSO_AUTH_TOKEN;
  }

  // The Prisma datasource is PostgreSQL (Neon). The URL must include a database segment (e.g., /db) so we avoid fake placeholders.
  const postgresPattern = /^postgres(?:ql)?:\/\/[^/]+\/.+$/;
  return postgresPattern.test(databaseUrl);
}

export function shouldServeMockData(): boolean {
  // Mock data mode has been retired; always require a live database.
  return false;
}

export function getServerRuntimeState(env: RuntimeEnv = process.env): ServerRuntimeState {
  const dataMode = getServerDataMode(env);
  const databaseConfigured = isDatabaseConfigured(env);
  const healthStatus = databaseConfigured ? "ok" : "degraded";

  return {
    dataMode,
    databaseConfigured,
    healthStatus,
  };
}

export function getLiveOperatorDataBlockReason(
  runtime: ServerRuntimeState
): LiveOperatorDataBlockReason | null {
  if (!runtime.databaseConfigured) {
    return "database_unavailable";
  }

  return null;
}

export function canReadLiveOperatorData(runtime: ServerRuntimeState): boolean {
  return getLiveOperatorDataBlockReason(runtime) === null;
}

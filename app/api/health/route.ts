/**
 * Health Check API
 * 
 * Provides system health status for monitoring and debugging.
 */

import { NextResponse } from "next/server";
import { browserStorage, getPersistenceStats } from "@/lib/persistence/storage";
import { hasAvailableProvider, getProviderName } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthCheckResult {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: "ok" | "degraded" | "error";
      mode: "demo" | "production";
      message?: string;
    };
    ai: {
      status: "ok" | "degraded" | "error";
      provider: string | null;
      available: boolean;
      message?: string;
    };
    storage: {
      status: "ok" | "degraded" | "error";
      keys: number;
      size: number;
      message?: string;
    };
    onboarding: {
      status: "ok" | "degraded" | "error";
      completed: boolean;
      message?: string;
    };
  };
}

const START_TIME = Date.now();

export async function GET() {
  const result: HealthCheckResult = {
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    uptime: Date.now() - START_TIME,
    checks: {
      database: {
        status: "ok",
        mode: "demo",
      },
      ai: {
        status: "ok",
        provider: null,
        available: false,
      },
      storage: {
        status: "ok",
        keys: 0,
        size: 0,
      },
      onboarding: {
        status: "ok",
        completed: false,
      },
    },
  };

  let hasErrors = false;
  let hasDegraded = false;

  // Check 1: Database
  const hasTurso = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
  const hasPostgres = !!(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const isDemoMode = process.env.APP_DATA_MODE === "demo" || (!hasTurso && !hasPostgres);
  result.checks.database.mode = isDemoMode ? "demo" : "production";
  
  if (!isDemoMode) {
    // In production mode, database should be available
    const hasDb = hasTurso || hasPostgres;
    if (!hasDb) {
      result.checks.database.status = "error";
      result.checks.database.message = "Database URL not configured";
      hasErrors = true;
    } else if (hasTurso) {
      result.checks.database.message = "Turso/libsql";
    } else {
      result.checks.database.message = "PostgreSQL";
    }
  }

  // Check 2: AI Provider
  try {
    const providerAvailable = await hasAvailableProvider();
    const providerName = getProviderName();
    
    result.checks.ai.available = providerAvailable;
    result.checks.ai.provider = providerName;
    
    if (!providerAvailable) {
      result.checks.ai.status = "degraded";
      result.checks.ai.message = "No AI provider configured, using mock mode";
      hasDegraded = true;
    }
  } catch (error) {
    result.checks.ai.status = "error";
    result.checks.ai.message = error instanceof Error ? error.message : "AI check failed";
    hasErrors = true;
  }

  // Check 3: Storage
  try {
    const stats = getPersistenceStats();
    result.checks.storage.keys = stats.keys.length;
    result.checks.storage.size = stats.size;
    
    // Check if storage is too large (> 4MB)
    if (stats.size > 4 * 1024 * 1024) {
      result.checks.storage.status = "degraded";
      result.checks.storage.message = "Storage usage high, consider cleanup";
      hasDegraded = true;
    }
  } catch (error) {
    result.checks.storage.status = "error";
    result.checks.storage.message = error instanceof Error ? error.message : "Storage check failed";
    hasErrors = true;
  }

  // Check 4: Onboarding
  try {
    const onboardingComplete = browserStorage.get("ceoclaw-onboarding-complete", false) ?? false;
    result.checks.onboarding.completed = onboardingComplete;
    
    if (!onboardingComplete) {
      result.checks.onboarding.status = "degraded";
      result.checks.onboarding.message = "Onboarding not completed";
      // Don't mark as degraded, this is normal for new users
    }
  } catch (error) {
    result.checks.onboarding.status = "error";
    result.checks.onboarding.message = error instanceof Error ? error.message : "Onboarding check failed";
  }

  // Overall status
  if (hasErrors) {
    result.status = "error";
  } else if (hasDegraded) {
    result.status = "degraded";
  }

  const statusCode = result.status === "error" ? 503 : 200;
  
  return NextResponse.json(result, { status: statusCode });
}

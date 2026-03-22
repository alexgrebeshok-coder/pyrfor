/**
 * Health Check API
 * 
 * Provides system health status for monitoring and debugging.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasAvailableProviders } from "@/lib/ai/provider-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    database: {
      status: "connected" | "error";
      message?: string;
    };
    ai: {
      status: "available" | "no providers" | "unknown";
      message?: string;
    };
    storage: {
      status: "ok" | "degraded" | "error";
      keys: number;
      size: number;
      message?: string;
    };
  };
}

const START_TIME = Date.now();

export async function GET() {
  const result: HealthCheckResult = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "0.2.1",
    uptime: Date.now() - START_TIME,
    checks: {
      database: {
        status: "connected",
      },
      ai: {
        status: "available",
      },
      storage: {
        status: "ok",
        keys: 0,
        size: 0,
      },
    },
  };

  let hasErrors = false;
  let hasDegraded = false;

  // Check 1: Database (Prisma)
  try {
    await prisma.$queryRaw`SELECT 1`;
    result.checks.database.status = "connected";
  } catch (error) {
    result.checks.database.status = "error";
    result.checks.database.message = error instanceof Error ? error.message : "Database check failed";
    hasErrors = true;
  }

  // Check 2: AI Provider
  try {
    const aiOk = hasAvailableProviders();
    result.checks.ai.status = aiOk ? "available" : "no providers";
    
    if (!aiOk) {
      result.checks.ai.message = "No AI provider configured";
      hasDegraded = true;
    }
  } catch (error) {
    result.checks.ai.status = "unknown";
    result.checks.ai.message = error instanceof Error ? error.message : "AI check failed";
    hasDegraded = true;
  }

  // Check 3: Storage (browser storage stats - may not be available in server context)
  try {
    // Import dynamically to avoid issues in server context
    const { getPersistenceStats } = await import("@/lib/persistence/storage");
    const stats = getPersistenceStats();
    result.checks.storage.keys = stats.keys.length;
    result.checks.storage.size = stats.size;
    
    if (stats.size > 4 * 1024 * 1024) {
      result.checks.storage.status = "degraded";
      result.checks.storage.message = "Storage usage high";
      hasDegraded = true;
    }
  } catch {
    // Storage may not be available in server context - that's OK
    result.checks.storage.status = "ok";
    result.checks.storage.keys = 0;
    result.checks.storage.size = 0;
  }

  // Overall status
  if (hasErrors) {
    result.status = "unhealthy";
  } else if (hasDegraded) {
    result.status = "degraded";
  }

  const statusCode = hasErrors ? 503 : 200;
  
  return NextResponse.json(result, { status: statusCode });
}

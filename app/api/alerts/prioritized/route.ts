import { NextRequest, NextResponse } from "next/server";

import { buildAlertFeed } from "@/lib/alerts/scoring";
import { resolveBriefLocale } from "@/lib/briefs/locale";
import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import {
  badRequest,
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const runtimeState = getServerRuntimeState();

    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") || undefined;
    const limitParam = searchParams.get("limit");
    const locale = resolveBriefLocale(searchParams.get("locale"));
    const limit = limitParam ? Number(limitParam) : undefined;

    if (limitParam && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
      return badRequest("Query parameter \"limit\" must be a positive number.");
    }

    const snapshot = await loadExecutiveSnapshot();
    const alertFeed = buildAlertFeed(snapshot, {
      projectId,
      limit,
      locale,
    });

    return NextResponse.json(alertFeed);
  } catch (error) {
    return serverError(error, "Failed to generate prioritized alerts.");
  }
}

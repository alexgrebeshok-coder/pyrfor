import { NextRequest, NextResponse } from "next/server";

import { loadExecutiveSnapshot } from "@/lib/briefs/snapshot";
import {
  buildPortfolioPlanFactSummary,
  buildProjectPlanFactSummary,
} from "@/lib/plan-fact/service";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const runtimeState = getServerRuntimeState();

    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId") ?? undefined;
    const snapshot = await loadExecutiveSnapshot({ projectId });

    if (projectId) {
      return NextResponse.json(
        buildProjectPlanFactSummary(snapshot, projectId, {
          referenceDate: snapshot.generatedAt,
        })
      );
    }

    return NextResponse.json(
      buildPortfolioPlanFactSummary(snapshot, {
        referenceDate: snapshot.generatedAt,
      })
    );
  } catch (error) {
    return serverError(error, "Failed to build plan-vs-fact summary.");
  }
}

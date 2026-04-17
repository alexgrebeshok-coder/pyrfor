import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  badRequest,
  liveOperatorDataUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import {
  getLiveOperatorDataBlockReason,
  getServerRuntimeState,
} from "@/lib/server/runtime-mode";
import { createVideoFact, getVideoFactOverview } from "@/lib/video-facts/service";
import { createVideoFactSchema } from "@/lib/validators/video-fact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "VIEW_WORK_REPORTS",
      workspaceId: "delivery",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();

    if (getLiveOperatorDataBlockReason(runtimeState)) {
      return liveOperatorDataUnavailable(runtimeState);
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;

    if (limitParam && (!Number.isFinite(limit) || (limit ?? 0) <= 0)) {
      return badRequest('Query parameter "limit" must be a positive number.');
    }

    const overview = await getVideoFactOverview({
      ...(limit !== undefined ? { limit } : {}),
      ...(searchParams.get("projectId") ? { projectId: searchParams.get("projectId")! } : {}),
    });

    return NextResponse.json(overview);
  } catch (error) {
    return serverError(error, "Failed to load video facts.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "CREATE_WORK_REPORTS",
      workspaceId: "delivery",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();

    if (getLiveOperatorDataBlockReason(runtimeState)) {
      return liveOperatorDataUnavailable(runtimeState);
    }

    const parsed = await validateBody(request, createVideoFactSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const fact = await createVideoFact(parsed);
    return NextResponse.json(fact, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /work report not found/i.test(error.message)) {
      return badRequest(error.message, "RELATION_NOT_FOUND");
    }

    return serverError(error, "Failed to create video fact.");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { generateProjectBrief } from "@/lib/briefs/generate";
import { resolveBriefLocale } from "@/lib/briefs/locale";
import { databaseUnavailable, notFound, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function GET(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const authResult = await authorizeRequest(request, {
      permission: "VIEW_EXECUTIVE_BRIEFS",
      workspaceId: "executive",
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const runtimeState = getServerRuntimeState();
    const { searchParams } = new URL(request.url);
    const locale = resolveBriefLocale(searchParams.get("locale"));

    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const { projectId } = await params;
    const brief = await generateProjectBrief(projectId, { locale });
    return NextResponse.json(brief);
  } catch (error) {
    if (error instanceof Error && /was not found/u.test(error.message)) {
      return notFound("Project not found");
    }

    return serverError(error, "Failed to generate project brief.");
  }
}

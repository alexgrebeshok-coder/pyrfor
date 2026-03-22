import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { generatePortfolioBrief } from "@/lib/briefs/generate";
import { resolveBriefLocale } from "@/lib/briefs/locale";
import { databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    const brief = await generatePortfolioBrief({ locale });
    return NextResponse.json(brief);
  } catch (error) {
    return serverError(error, "Failed to generate portfolio brief.");
  }
}

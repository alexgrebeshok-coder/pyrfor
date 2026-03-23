import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { serverError } from "@/lib/server/api-utils";
import { getBillingOverview } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await authorizeRequest(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { organizationSlug, workspaceId } = authResult.accessProfile;
    if (!organizationSlug || !workspaceId) {
      return NextResponse.json(
        {
          error: "Billing context is not available for this account.",
          code: "BILLING_CONTEXT_MISSING",
        },
        { status: 400 }
      );
    }

    const overview = await getBillingOverview({
      organizationSlug,
      workspaceId,
    });

    return NextResponse.json(overview);
  } catch (error) {
    return serverError(error, "Failed to load billing overview.");
  }
}

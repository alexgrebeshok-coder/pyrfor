/**
 * OAuth authorize — redirects user to provider's consent page
 * GET /api/connectors/oauth/authorize?provider=google&connectorId=google-calendar&workspaceId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getOAuthAuthorizeUrl } from "@/lib/connectors/oauth/oauth-service";
import { OAUTH_PROVIDERS } from "@/lib/connectors/oauth/providers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const connectorId = searchParams.get("connectorId");
  const workspaceId =
    searchParams.get("workspaceId") ||
    authResult.accessProfile.workspaceId;

  if (!provider || !connectorId) {
    return NextResponse.json(
      { error: "Missing provider or connectorId" },
      { status: 400 }
    );
  }

  if (!(provider in OAUTH_PROVIDERS)) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}` },
      { status: 400 }
    );
  }

  try {
    const url = getOAuthAuthorizeUrl(
      provider,
      connectorId,
      workspaceId
    );
    return NextResponse.redirect(url);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OAuth setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

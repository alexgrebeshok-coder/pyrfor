/**
 * Connector credentials API — list/revoke workspace credentials
 * GET  /api/connectors/[id]/credentials — list credentials for this connector
 * DELETE /api/connectors/[id]/credentials — revoke credential
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  listWorkspaceCredentials,
  revokeCredential,
} from "@/lib/connectors/oauth/oauth-service";
import { serverError } from "@/lib/server/api-utils";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id: connectorId } = await params;
  const workspaceId = authResult.accessProfile.workspaceId;

  try {
    const credentials = await listWorkspaceCredentials(workspaceId);
    const filtered = connectorId === "all"
      ? credentials
      : credentials.filter((c) => c.connectorId === connectorId);

    return NextResponse.json({ credentials: filtered });
  } catch (error) {
    return serverError(error, "Failed to list credentials");
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  await params; // consume params to prevent Next.js warning

  try {
    const body = (await request.json()) as { credentialId: string };
    if (!body.credentialId) {
      return NextResponse.json(
        { error: "Missing credentialId" },
        { status: 400 }
      );
    }

    const result = await revokeCredential(body.credentialId);
    return NextResponse.json({ revoked: true, id: result.id });
  } catch (error) {
    return serverError(error, "Failed to revoke credential");
  }
}

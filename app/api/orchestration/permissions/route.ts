import { NextRequest, NextResponse } from "next/server";
import { resolveActor, requireUser } from "@/lib/orchestration/actor";
import {
  grantPermission,
  revokePermission,
  listPermissions,
  setPermissions,
} from "@/lib/orchestration/permission-grants";

/**
 * GET /api/orchestration/permissions?agentId=X
 * List all permission grants for an agent.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const grants = await listPermissions(agentId);
  return NextResponse.json({ grants });
}

/**
 * POST /api/orchestration/permissions
 * Body: { agentId, resource, action, scope? }
 * OR bulk: { agentId, grants: [{ resource, action, scope? }] }
 */
export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const body = await req.json();
  const { agentId } = body;

  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  // Bulk mode
  if (Array.isArray(body.grants)) {
    await setPermissions(agentId, body.grants);
    return NextResponse.json({ set: body.grants.length }, { status: 201 });
  }

  // Single grant
  const { resource, action, scope } = body;
  if (!resource || !action) {
    return NextResponse.json({ error: "resource and action required" }, { status: 400 });
  }

  const grant = await grantPermission(agentId, resource, action, scope);
  return NextResponse.json({ grant }, { status: 201 });
}

/**
 * DELETE /api/orchestration/permissions
 * Body: { id }
 */
export async function DELETE(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await revokePermission(id);
  return NextResponse.json({ revoked: true });
}

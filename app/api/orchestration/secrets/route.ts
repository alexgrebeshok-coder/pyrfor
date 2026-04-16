import { NextRequest, NextResponse } from "next/server";
import { resolveActor, requireUser } from "@/lib/orchestration/actor";
import { setSecret, listSecrets, deleteSecret } from "@/lib/orchestration/agent-secrets";

/**
 * GET /api/orchestration/secrets?workspaceId=X&agentId=Y
 * Lists secret keys (values are never returned).
 */
export async function GET(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "default";
  const agentId = req.nextUrl.searchParams.get("agentId") ?? undefined;

  const secrets = await listSecrets(workspaceId, agentId);
  return NextResponse.json({ secrets });
}

/**
 * POST /api/orchestration/secrets
 * Body: { workspaceId, key, value, agentId? }
 */
export async function POST(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const { workspaceId, key, value, agentId } = await req.json();

  if (!workspaceId || !key || !value) {
    return NextResponse.json({ error: "workspaceId, key, and value required" }, { status: 400 });
  }

  if (!/^[A-Za-z0-9_-]+$/.test(key)) {
    return NextResponse.json({ error: "Key must be alphanumeric (A-Z, 0-9, _, -)" }, { status: 400 });
  }

  const secret = await setSecret(workspaceId, key, value, agentId);
  return NextResponse.json({
    secret: { id: secret.id, key: secret.key, agentId: secret.agentId },
  }, { status: 201 });
}

/**
 * DELETE /api/orchestration/secrets
 * Body: { workspaceId, key }
 */
export async function DELETE(req: NextRequest) {
  const actor = await resolveActor(req);
  requireUser(actor);

  const { workspaceId, key } = await req.json();
  if (!workspaceId || !key) {
    return NextResponse.json({ error: "workspaceId and key required" }, { status: 400 });
  }

  await deleteSecret(workspaceId, key);
  return NextResponse.json({ deleted: true });
}

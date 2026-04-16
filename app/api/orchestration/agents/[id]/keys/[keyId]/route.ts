/**
 * Revoke agent API key
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { revokeApiKey } from "@/lib/orchestration/agent-service";

type Params = { params: Promise<{ id: string; keyId: string }> };

// DELETE /api/orchestration/agents/[id]/keys/[keyId]
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { keyId } = await params;
    await revokeApiKey(keyId);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

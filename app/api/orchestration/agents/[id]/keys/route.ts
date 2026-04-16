/**
 * Agent API Keys — create & list
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { createApiKey, listApiKeys } from "@/lib/orchestration/agent-service";

type Params = { params: Promise<{ id: string }> };

// GET /api/orchestration/agents/[id]/keys
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const keys = await listApiKeys(id);
    return NextResponse.json({ keys });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/orchestration/agents/[id]/keys — generate new key
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const body = await req.json();
    const name = body.name || "default";

    const result = await createApiKey(id, name);

    // plainKey is returned ONCE — client must save it
    return NextResponse.json({ key: result }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

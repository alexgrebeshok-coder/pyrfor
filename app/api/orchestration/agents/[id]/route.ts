/**
 * Orchestration Agent [id] API — get, update, delete a single agent
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import {
  getAgent,
  updateAgent,
  deleteAgent,
  pauseAgent,
  resumeAgent,
  terminateAgent,
} from "@/lib/orchestration/agent-service";

type Params = { params: Promise<{ id: string }> };

// GET /api/orchestration/agents/[id]
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const agent = await getAgent(id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load agent") }, { status: 500 });
  }
}

// PATCH /api/orchestration/agents/[id]
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const body = await req.json();

    // Handle action-based updates
    if (body.action === "pause") {
      const agent = await pauseAgent(id);
      return NextResponse.json({ agent });
    }
    if (body.action === "resume") {
      const agent = await resumeAgent(id);
      return NextResponse.json({ agent });
    }
    if (body.action === "terminate") {
      const agent = await terminateAgent(id);
      return NextResponse.json({ agent });
    }

    const agent = await updateAgent(id, body);
    return NextResponse.json({ agent });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to update agent") }, { status: 500 });
  }
}

// DELETE /api/orchestration/agents/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    await deleteAgent(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to delete agent") }, { status: 500 });
  }
}

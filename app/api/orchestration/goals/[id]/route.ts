/**
 * Goal [id] API — get, update, delete
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { deleteGoal, getGoal, updateGoal } from "@/lib/orchestration/goal-service";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const goal = await getGoal(id);
    if (!goal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ goal });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load goal") }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const body = await req.json();
    const goal = await updateGoal(id, {
      title: body.title,
      description: body.description,
      status: body.status,
      level: body.level,
      parentId: body.parentId,
      ownerAgentId: body.ownerAgentId,
    });
    return NextResponse.json({ goal });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to update goal") }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    await deleteGoal(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to delete goal") }, { status: 500 });
  }
}

/**
 * Goals API — CRUD + hierarchy
 * GET /api/orchestration/goals — list goals (tree or flat)
 * POST /api/orchestration/goals — create goal
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { createGoal, listGoals } from "@/lib/orchestration/goal-service";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const sp = req.nextUrl.searchParams;
    const workspaceId = sp.get("workspaceId") ?? "executive";
    const flat = sp.get("flat") === "true";

    const goals = await listGoals(workspaceId, { flat });
    return NextResponse.json({ goals });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load goals") }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const { workspaceId = "executive", parentId, title, description, level = "team", ownerAgentId } = body;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const goal = await createGoal({
      workspaceId,
      parentId: parentId ?? null,
      title,
      description: description ?? null,
      level,
      ownerAgentId: ownerAgentId ?? null,
    });

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create goal") }, { status: 500 });
  }
}

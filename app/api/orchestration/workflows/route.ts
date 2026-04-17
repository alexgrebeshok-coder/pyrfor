import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage, hasErrorCode } from "@/lib/orchestration/error-utils";
import {
  createWorkflowTemplate,
  listWorkflowTemplates,
} from "@/lib/orchestration/workflow-service";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "executive";
    const status = req.nextUrl.searchParams.get("status") ?? undefined;

    const templates = await listWorkflowTemplates(workspaceId, status as never);
    return NextResponse.json({ templates });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to list workflow templates") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const workspaceId = body.workspaceId ?? "executive";

    if (!body.name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const template = await createWorkflowTemplate({
      workspaceId,
      name: body.name,
      slug: body.slug,
      description: body.description,
      status: body.status,
      definition: body.definition,
      createdBy: authResult.accessProfile.userId,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error: unknown) {
    if (hasErrorCode(error, "P2002")) {
      return NextResponse.json(
        { error: "Workflow template slug already exists in workspace" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to create workflow template") },
      { status: 500 }
    );
  }
}

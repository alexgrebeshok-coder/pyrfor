import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { createWorkflowRun } from "@/lib/orchestration/workflow-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const { id } = await params;
    const run = await createWorkflowRun({
      workspaceId: body.workspaceId ?? "executive",
      templateId: id,
      input: body.input,
      context: body.context,
      triggerType: body.triggerType ?? "manual",
      createdBy: authResult.accessProfile.userId,
    });

    return NextResponse.json({ run }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to start workflow run") },
      { status: 500 }
    );
  }
}

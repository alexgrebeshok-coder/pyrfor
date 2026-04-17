import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage, hasErrorCode } from "@/lib/orchestration/error-utils";
import {
  getWorkflowTemplate,
  updateWorkflowTemplate,
} from "@/lib/orchestration/workflow-service";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const template = await getWorkflowTemplate(id);

    return NextResponse.json({ template });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to load workflow template") },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const body = await req.json();
    const { id } = await params;

    const template = await updateWorkflowTemplate(id, {
      name: body.name,
      slug: body.slug,
      description: body.description,
      status: body.status,
      definition: body.definition,
    });

    return NextResponse.json({ template });
  } catch (error: unknown) {
    if (hasErrorCode(error, "P2002")) {
      return NextResponse.json(
        { error: "Workflow template slug already exists in workspace" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: getErrorMessage(error, "Failed to update workflow template") },
      { status: 500 }
    );
  }
}

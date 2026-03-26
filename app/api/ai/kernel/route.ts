import { type NextRequest, NextResponse } from "next/server";

import {
  authorizeRequest,
  type AuthorizedRequestContext,
} from "@/app/api/middleware/auth";
import {
  AI_KERNEL_OPERATIONS,
  aiKernelControlPlane,
  isAIKernelOperation,
  type AIKernelExecutionContext,
  type AIKernelOperation,
  type AIKernelRequest,
} from "@/lib/ai/kernel-control-plane";
import { badRequest, serverError } from "@/lib/server/api-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await authorizeRequest(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const result = await aiKernelControlPlane.execute(
      { operation: "status" },
      buildExecutionContext(request, authResult)
    );

    return NextResponse.json(result, {
      status: result.success ? 200 : result.error.status,
    });
  } catch (error) {
    return serverError(error, "Failed to load AI kernel status", "AI_KERNEL_GET_FAILED");
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<AIKernelRequest> & {
      operation?: unknown;
    };

    if (!isAIKernelOperation(body.operation)) {
      return badRequest(
        "A supported AI kernel operation is required.",
        "INVALID_KERNEL_OPERATION",
        {
          supportedOperations: AI_KERNEL_OPERATIONS,
        }
      );
    }

    const authResult = await authorizeRequest(request, {
      permission: resolvePermission(body.operation),
    });
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const result = await aiKernelControlPlane.execute(
      body as AIKernelRequest,
      buildExecutionContext(request, authResult)
    );

    return NextResponse.json(result, {
      status: result.success ? 200 : result.error.status,
    });
  } catch (error) {
    return serverError(error, "Failed to execute AI kernel request", "AI_KERNEL_POST_FAILED");
  }
}

function buildExecutionContext(
  request: NextRequest,
  authResult: AuthorizedRequestContext
): AIKernelExecutionContext {
  return {
    correlationId: request.headers.get("x-request-id") ?? undefined,
    transport: "http",
    path: request.nextUrl.pathname,
    actor: {
      userId: authResult.accessProfile.userId,
      role: authResult.accessProfile.role,
      workspaceId: authResult.accessProfile.workspaceId,
      organizationSlug: authResult.accessProfile.organizationSlug ?? null,
    },
  };
}

function resolvePermission(operation: AIKernelOperation) {
  if (operation === "run.create" || operation === "run.apply" || operation === "tool.execute") {
    return "RUN_AI_ACTIONS" as const;
  }

  return undefined;
}

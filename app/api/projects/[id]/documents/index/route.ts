import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { indexDocument } from "@/lib/ai/rag/document-indexer";
import { prisma } from "@/lib/prisma";
import { databaseUnavailable, notFound, serverError, validationError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const documentIndexSchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  type: z.string().optional(),
  source: z.string().optional(),
  workspaceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: RouteContext
): Promise<NextResponse> {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtimeState = getServerRuntimeState();
    if (!runtimeState.databaseConfigured) {
      return databaseUnavailable(runtimeState.dataMode);
    }

    const { id } = await params;
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const body = await request.json();
    const parsed = documentIndexSchema.safeParse(body);
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const documentId = await indexDocument({
      title: parsed.data.title,
      content: parsed.data.content,
      type: parsed.data.type as Parameters<typeof indexDocument>[0]["type"],
      source: parsed.data.source,
      projectId: id,
      workspaceId: parsed.data.workspaceId,
      metadata: parsed.data.metadata,
    });

    return NextResponse.json({
      success: true,
      documentId,
      projectId: id,
    });
  } catch (error) {
    return serverError(error, "Failed to index project document.");
  }
}

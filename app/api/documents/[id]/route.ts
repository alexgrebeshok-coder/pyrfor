import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  isPrismaNotFoundError,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;
    const document = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        filename: true,
        url: true,
        type: true,
        size: true,
        ownerId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: { id: true, name: true },
        },
        owner: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    if (!document || !document.project) {
      return notFound("Document not found");
    }

    const { project, owner, ...rest } = document;

    return NextResponse.json({
      ...rest,
      project,
      owner,
    });
  } catch (error) {
    return serverError(error, "Failed to load document.");
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const existingDocument = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { id: true },
        },
      },
    });

    if (!existingDocument || !existingDocument.project) {
      return notFound("Document not found");
    }

    const ownerId =
      body.ownerId === null
        ? null
        : typeof body.ownerId === "string" && body.ownerId.trim()
          ? body.ownerId.trim()
          : body.ownerId === undefined
            ? undefined
            : null;

    if (typeof ownerId === "string") {
      const ownerInProject = await prisma.teamMember.findFirst({
        where: {
          id: ownerId,
          projects: {
            some: {
              id: existingDocument.projectId,
            },
          },
        },
        select: { id: true },
      });

      if (!ownerInProject) {
        return badRequest("ownerId must belong to the project's team");
      }
    }

    const document = await prisma.document.update({
      where: { id },
      data: {
        ...(typeof body.title === "string" && { title: body.title }),
        ...(body.description !== undefined && {
          description: typeof body.description === "string" ? body.description : null,
        }),
        ...(typeof body.filename === "string" && { filename: body.filename }),
        ...(typeof body.url === "string" && { url: body.url }),
        ...(typeof body.type === "string" && { type: body.type }),
        ...(body.size !== undefined &&
          typeof body.size === "number" &&
          Number.isFinite(body.size) && { size: Math.round(body.size) }),
        ...(body.ownerId !== undefined && { ownerId }),
        updatedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        description: true,
        filename: true,
        url: true,
        type: true,
        size: true,
        ownerId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: { id: true, name: true },
        },
        owner: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    const { project, owner, ...rest } = document;

    return NextResponse.json({
      ...rest,
      project,
      owner,
    });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Document not found");
    }

    return serverError(error, "Failed to update document.");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(_request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;

    const existingDocument = await prisma.document.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { id: true },
        },
      },
    });

    if (!existingDocument || !existingDocument.project) {
      return notFound("Document not found");
    }

    await prisma.document.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Document not found");
    }

    return serverError(error, "Failed to delete document.");
  }
}

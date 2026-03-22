import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function buildFilename(title: string, type: string) {
  const safeTitle = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return `${safeTitle || "document"}.${type.toLowerCase()}`;
}

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim() || null;

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });

      if (!project) {
        return notFound("Project not found");
      }
    }

    const documents = await prisma.document.findMany({
      where: {
        ...(projectId && { projectId }),
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
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(
      documents.map(({ project: projectRelation, owner: ownerRelation, ...document }) => ({
        ...document,
        project: projectRelation,
        owner: ownerRelation,
      }))
    );
  } catch (error) {
    return serverError(error, "Failed to load documents.");
  }
}

export async function POST(request: NextRequest) {
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

    const body = (await request.json()) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const projectId =
      typeof body.projectId === "string" ? body.projectId.trim() : "";
    const type = typeof body.type === "string" && body.type.trim() ? body.type.trim() : "note";

    if (!title || !projectId) {
      return badRequest("Missing required fields: title, projectId");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const ownerId =
      typeof body.ownerId === "string" && body.ownerId.trim()
        ? body.ownerId.trim()
        : undefined;

    if (ownerId) {
      const ownerInProject = await prisma.teamMember.findFirst({
        where: {
          id: ownerId,
          projects: {
            some: {
              id: projectId,
            },
          },
        },
        select: { id: true },
      });

      if (!ownerInProject) {
        return badRequest("ownerId must belong to the project's team");
      }
    }

    const filename =
      typeof body.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : buildFilename(title, type);

    const document = await prisma.document.create({
      data: {
        id: randomUUID(),
        title,
        description:
          typeof body.description === "string" ? body.description : undefined,
        filename,
        url: typeof body.url === "string" && body.url.trim() ? body.url.trim() : "#",
        type,
        size:
          typeof body.size === "number" && Number.isFinite(body.size)
            ? Math.round(body.size)
            : undefined,
        ownerId,
        projectId,
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

    const { project: projectRelation, owner: ownerRelation, ...rest } = document;

    return NextResponse.json(
      {
        ...rest,
        project: projectRelation,
        owner: ownerRelation,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError(error, "Failed to create document.");
  }
}

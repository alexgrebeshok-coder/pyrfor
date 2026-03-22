import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  normalizeMilestoneStatus,
  notFound,
  parseDateInput,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // Pagination support
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const skip = (page - 1) * limit;

    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      });

      if (!project) {
        return notFound("Project not found");
      }
    }

    const where = {
      ...(projectId && { projectId }),
    };

    const [milestones, total] = await Promise.all([
      prisma.milestone.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          date: true,
          status: true,
          projectId: true,
          createdAt: true,
          updatedAt: true,
          project: {
            select: { id: true, name: true },
          },
        },
        orderBy: { date: "asc" },
      }),
      prisma.milestone.count({ where }),
    ]);

    return NextResponse.json({
      milestones: milestones.map(({ project: projectRelation, ...milestone }) => ({
        ...milestone,
        project: projectRelation,
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to load milestones.");
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
    const date = parseDateInput(body.date);

    if (!title || !projectId || !date) {
      return badRequest("Missing required fields: title, projectId, date");
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return notFound("Project not found");
    }

    const milestone = await prisma.milestone.create({
      data: {
        id: randomUUID(),
        title,
        description:
          typeof body.description === "string" ? body.description : undefined,
        projectId,
        date,
        status: normalizeMilestoneStatus(body.status) ?? "upcoming",
        updatedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        description: true,
        date: true,
        status: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: { id: true, name: true },
        },
      },
    });

    const { project: projectRelation, ...rest } = milestone;

    return NextResponse.json(
      {
        ...rest,
        project: projectRelation,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError(error, "Failed to create milestone.");
  }
}

import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  isPrismaNotFoundError,
  normalizeMilestoneStatus,
  notFound,
  parseDateInput,
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
    const milestone = await prisma.milestone.findUnique({
      where: { id },
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

    if (!milestone || !milestone.project) {
      return notFound("Milestone not found");
    }

    const { project, ...rest } = milestone;

    return NextResponse.json({
      ...rest,
      project,
    });
  } catch (error) {
    return serverError(error, "Failed to load milestone.");
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

    const existingMilestone = await prisma.milestone.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { id: true },
        },
      },
    });

    if (!existingMilestone || !existingMilestone.project) {
      return notFound("Milestone not found");
    }

    const milestone = await prisma.milestone.update({
      where: { id },
      data: {
        ...(typeof body.title === "string" && { title: body.title }),
        ...(body.description !== undefined && {
          description: typeof body.description === "string" ? body.description : null,
        }),
        ...(parseDateInput(body.date) && { date: parseDateInput(body.date) }),
        ...(normalizeMilestoneStatus(body.status) && {
          status: normalizeMilestoneStatus(body.status),
        }),
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

    const { project, ...rest } = milestone;

    return NextResponse.json({
      ...rest,
      project,
    });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Milestone not found");
    }

    return serverError(error, "Failed to update milestone.");
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

    const existingMilestone = await prisma.milestone.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        project: {
          select: { id: true },
        },
      },
    });

    if (!existingMilestone || !existingMilestone.project) {
      return notFound("Milestone not found");
    }

    await prisma.milestone.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Milestone not found");
    }

    return serverError(error, "Failed to delete milestone.");
  }
}

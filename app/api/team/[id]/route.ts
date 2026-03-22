import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  isPrismaNotFoundError,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(_request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { id } = await params;
    const member = await prisma.teamMember.findUnique({
      where: { id },
      include: {
        tasks: {
          orderBy: { dueDate: "asc" },
        },
        projects: {
          orderBy: { updatedAt: "desc" },
        },
        risks: {
          orderBy: { severity: "desc" },
        },
        documents: {
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    if (!member) {
      return notFound("Team member not found");
    }

    const { tasks, projects, risks, documents, ...rest } = member;

    return NextResponse.json({
      ...rest,
      tasks,
      projects,
      risks,
      documents,
      activeTasks: tasks.filter((task) => !["done", "cancelled"].includes(task.status))
        .length,
      capacityUsed: Math.min(
        100,
        tasks.filter((task) => !["done", "cancelled"].includes(task.status)).length * 20
      ),
    });
  } catch (error) {
    return serverError(error, "Failed to load team member.");
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request);
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
    const member = await prisma.teamMember.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" && { name: body.name }),
        ...(typeof body.role === "string" && { role: body.role }),
        ...(body.initials !== undefined && {
          initials: typeof body.initials === "string" ? body.initials : null,
        }),
        ...(body.email !== undefined && {
          email: typeof body.email === "string" ? body.email : null,
        }),
        ...(body.avatar !== undefined && {
          avatar: typeof body.avatar === "string" ? body.avatar : null,
        }),
        ...(typeof body.capacity === "number" && Number.isFinite(body.capacity) && {
          capacity: Math.round(body.capacity),
        }),
        updatedAt: new Date(),
      },
      include: {
        tasks: {
          orderBy: { dueDate: "asc" },
        },
        projects: {
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    const { tasks, projects, ...rest } = member;

    return NextResponse.json({
      ...rest,
      tasks,
      projects,
      activeTasks: tasks.filter((task) => !["done", "cancelled"].includes(task.status))
        .length,
      capacityUsed: Math.min(
        100,
        tasks.filter((task) => !["done", "cancelled"].includes(task.status)).length * 20
      ),
    });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Team member not found");
    }

    return serverError(error, "Failed to update team member.");
  }
}

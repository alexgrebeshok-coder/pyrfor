import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  calculateProjectHealth,
  calculateProjectProgress,
  databaseUnavailable,
  isPrismaNotFoundError,
  normalizeProjectStatus,
  notFound,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { updateProjectSchema } from "@/lib/validators/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function mapProjectRecord(project: any) {
  const {
    tasks,
    team,
    risks,
    milestones,
    documents,
    ...rest
  } = project;

  return {
    ...rest,
    tasks: (tasks ?? []).map((task: any) => ({
      ...task,
      assignee: task.assignee ?? null,
    })),
    team: team ?? [],
    risks: risks ?? [],
    milestones: milestones ?? [],
    documents: (documents ?? []).map((document: any) => ({
      ...document,
      owner: document.owner ?? null,
    })),
  };
}

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: [{ order: "asc" }, { dueDate: "asc" }],
        },
        team: {
          orderBy: { name: "asc" },
        },
        risks: {
          orderBy: { severity: "desc" },
        },
        milestones: {
          orderBy: { date: "asc" },
        },
        documents: {
          include: {
            owner: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    if (!project) {
      return notFound("Project not found");
    }

    return NextResponse.json({
      ...mapProjectRecord(project),
      progress: calculateProjectProgress({
        progress: project.progress,
        tasks: project.tasks,
      }),
      health: calculateProjectHealth({
        health: project.health,
        risks: project.risks,
      }),
    });
  } catch (error) {
    return serverError(error, "Failed to load project.");
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
    const body = await request.json();
    const parsed = updateProjectSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const {
      budgetFact,
      budgetPlan,
      description,
      direction,
      end,
      health,
      location,
      name,
      priority,
      progress,
      start,
      status,
      teamIds,
    } = parsed.data;

    const project = await prisma.project.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(normalizeProjectStatus(status) && {
          status: normalizeProjectStatus(status),
        }),
        ...(direction !== undefined && { direction }),
        ...(priority !== undefined && { priority }),
        ...(health !== undefined && { health }),
        ...(progress !== undefined && {
          progress,
        }),
        ...(budgetPlan !== undefined && {
          budgetPlan,
        }),
        ...(budgetFact !== undefined && {
          budgetFact,
        }),
        ...(start !== undefined && { start: new Date(start) }),
        ...(end !== undefined && { end: new Date(end) }),
        ...(location !== undefined && { location }),
        ...(teamIds && {
          team: {
            set: teamIds.map((teamId) => ({ id: teamId })),
          },
        }),
        updatedAt: new Date(),
      },
      include: {
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: [{ order: "asc" }, { dueDate: "asc" }],
        },
        team: {
          orderBy: { name: "asc" },
        },
        risks: {
          orderBy: { severity: "desc" },
        },
        milestones: {
          orderBy: { date: "asc" },
        },
        documents: {
          include: {
            owner: {
              select: { id: true, name: true, initials: true },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    });

    return NextResponse.json({
      ...mapProjectRecord(project),
      progress: calculateProjectProgress({
        progress: project.progress,
        tasks: project.tasks,
      }),
      health: calculateProjectHealth({
        health: project.health,
        risks: project.risks,
      }),
    });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Project not found");
    }

    return serverError(error, "Failed to update project.");
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
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
    await prisma.project.delete({
      where: { id },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Project not found");
    }

    return serverError(error, "Failed to delete project.");
  }
}

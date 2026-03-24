import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { enforceProjectLimit } from "@/lib/billing";
import {
  calculateProjectHealth,
  calculateProjectProgress,
  normalizeProjectStatus,
  serverError,
  serviceUnavailable,
  validationError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { createProjectSchema } from "@/lib/validators/project";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectTaskRecord = Record<string, unknown> & {
  assignee?: {
    id: string;
    name: string;
    initials?: string | null;
  } | null;
};

type ProjectDocumentRecord = Record<string, unknown> & {
  owner?: {
    id: string;
    name: string;
    initials?: string | null;
  } | null;
};

type ProjectRouteRecord = Record<string, unknown> & {
  tasks?: ProjectTaskRecord[];
  team?: Array<Record<string, unknown>>;
  risks?: Array<Record<string, unknown>>;
  milestones?: Array<Record<string, unknown>>;
  documents?: ProjectDocumentRecord[];
};

function mapProjectRecord(project: ProjectRouteRecord) {
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
    tasks: (tasks ?? []).map((task) => ({
      ...task,
      assignee: task.assignee ?? null,
    })),
    team: team ?? [],
    risks: risks ?? [],
    milestones: milestones ?? [],
    documents: (documents ?? []).map((document) => ({
      ...document,
      owner: document.owner ?? null,
    })),
  };
}

export async function HEAD(): Promise<NextResponse> {
  return new NextResponse(null, { status: 200 });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

    if (!runtime.databaseConfigured) {
      return serviceUnavailable(
        "DATABASE_URL is not configured for live mode.",
        "DATABASE_UNAVAILABLE",
        { dataMode: runtime.dataMode }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = normalizeProjectStatus(searchParams.get("status"));
    const direction = searchParams.get("direction");

    // P2-1: Add pagination to prevent overfetching
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100); // Max 100 per page
    const skip = (page - 1) * limit;

    // P2-1: Add optional includes to reduce payload size
    const includeTasks = searchParams.get("includeTasks") === "true";
    const includeTeam = searchParams.get("includeTeam") !== "false";
    const includeRisks = searchParams.get("includeRisks") !== "false";
    const includeMilestones = searchParams.get("includeMilestones") !== "false";
    const includeDocuments = searchParams.get("includeDocuments") !== "false";

    // P2-1: Use select to narrow fields and conditional includes
    const projects = await prisma.project.findMany({
      where: {
        workspaceId: authResult.accessProfile.workspaceId,
        ...(status && { status }),
        ...(direction && { direction }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        direction: true,
        priority: true,
        start: true,
        end: true,
        budgetPlan: true,
        budgetFact: true,
        progress: true,
        health: true,
        location: true,
        createdAt: true,
        updatedAt: true,
        // Conditional includes - only fetch what's requested
        ...(includeTasks
          ? {
              tasks: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  priority: true,
                  dueDate: true,
                  assigneeId: true,
                  assignee: {
                    select: { id: true, name: true, initials: true },
                  },
                },
                orderBy: [{ order: "asc" }, { dueDate: "asc" }],
              },
            }
          : {}),
        ...(includeTeam
          ? {
              team: {
                select: { id: true, name: true, initials: true },
                orderBy: { name: "asc" },
              },
            }
          : {}),
        ...(includeRisks
          ? {
              risks: {
                where: { status: "open" },
                select: { id: true, title: true, severity: true, status: true },
                orderBy: { severity: "desc" },
              },
            }
          : {}),
        ...(includeMilestones
          ? {
              milestones: {
                select: { id: true, title: true, date: true, status: true },
                orderBy: { date: "asc" },
              },
            }
          : {}),
        ...(includeDocuments
          ? {
              documents: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  updatedAt: true,
                  owner: {
                    select: { id: true, name: true, initials: true },
                  },
                },
                orderBy: { updatedAt: "desc" },
              },
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
    });

    // P2-1: Add pagination metadata
    const total = await prisma.project.count({
      where: {
        workspaceId: authResult.accessProfile.workspaceId,
        ...(status && { status }),
        ...(direction && { direction }),
      },
    });

    return NextResponse.json({
      projects: projects.map((project) => ({
        ...mapProjectRecord(project),
        progress: calculateProjectProgress({
          progress: project.progress,
          tasks: project.tasks,
        }),
        health: calculateProjectHealth({
          health: project.health,
          risks: project.risks,
        }),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to fetch projects.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Require authentication
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const billingLimit = await enforceProjectLimit({
      organizationSlug: authResult.accessProfile.organizationSlug,
      workspaceId: authResult.accessProfile.workspaceId,
    });

    if (billingLimit) {
      return billingLimit;
    }

    const body = await request.json();
    const parsed = createProjectSchema.safeParse(body);

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
      teamIds = [],
    } = parsed.data;

    const project = await prisma.project.create({
      data: {
        id: randomUUID(),
        name,
        description,
        status: normalizeProjectStatus(status) ?? "planning",
        direction,
        priority: priority ?? "medium",
        start: new Date(start),
        end: new Date(end),
        budgetPlan,
        budgetFact: budgetFact ?? 0,
        progress: progress ?? 0,
        health: health ?? "good",
        location,
        workspaceId: authResult.accessProfile.workspaceId,
        ...(teamIds.length
          ? {
              team: {
                connect: teamIds.map((id) => ({ id })),
              },
            }
          : {}),
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
          where: { status: "open" },
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

    return NextResponse.json(
      {
        ...mapProjectRecord(project),
        progress: calculateProjectProgress({
          progress: project.progress,
          tasks: project.tasks,
        }),
        health: calculateProjectHealth({
          health: project.health,
          risks: project.risks,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError(error, "Failed to create project.");
  }
}

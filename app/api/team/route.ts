import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { badRequest, databaseUnavailable, serverError } from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const team = await prisma.teamMember.findMany({
      include: {
        tasks: {
          where: {
            status: {
              notIn: ["done", "cancelled"],
            },
          },
          orderBy: { dueDate: "asc" },
        },
        projects: {
          orderBy: { updatedAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    const teamWithCapacity = team.map((member) => {
      const { tasks, projects, ...rest } = member;

      return {
        ...rest,
        tasks,
        projects,
        activeTasks: tasks.length,
        capacityUsed: Math.min(100, tasks.length * 20),
      };
    });

    return NextResponse.json({ team: teamWithCapacity });
  } catch (error) {
    return serverError(error, "Failed to fetch team members.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const role = typeof body.role === "string" ? body.role.trim() : "";

    if (!name || !role) {
      return badRequest("Missing required fields: name, role");
    }

    const member = await prisma.teamMember.create({
      data: {
        id: randomUUID(),
        name,
        role,
        initials: typeof body.initials === "string" ? body.initials : undefined,
        email: typeof body.email === "string" ? body.email : undefined,
        avatar: typeof body.avatar === "string" ? body.avatar : undefined,
        capacity:
          typeof body.capacity === "number" && Number.isFinite(body.capacity)
            ? Math.round(body.capacity)
            : 100,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(member, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create team member.");
  }
}

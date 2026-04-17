import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { equipmentSchema } from "@/lib/validators/resource-finance";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status")?.trim() || undefined;
    const projectId = searchParams.get("projectId")?.trim() || undefined;

    const equipment = await prisma.equipment.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(projectId ? { projectId } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        assignments: {
          include: {
            project: { select: { id: true, name: true } },
          },
          orderBy: { startDate: "desc" },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ equipment });
  } catch (error) {
    return serverError(error, "Failed to fetch equipment.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const parsed = await validateBody(request, equipmentSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const equipment = await prisma.equipment.create({
      data: {
        id: randomUUID(),
        ...parsed,
      },
      include: {
        project: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(equipment, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create equipment.");
  }
}

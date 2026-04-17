import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { equipmentAssignmentSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = await validateBody(request, equipmentAssignmentSchema);
    if (isValidationError(parsed)) return parsed;

    const equipment = await prisma.equipment.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!equipment) return notFound("Equipment not found");

    const assignment = await prisma.$transaction(async (tx) => {
      const created = await tx.equipmentAssignment.create({
        data: {
          id: randomUUID(),
          equipmentId: id,
          projectId: parsed.projectId,
          startDate: new Date(parsed.startDate),
          endDate: parsed.endDate ? new Date(parsed.endDate) : null,
          hoursUsed: parsed.hoursUsed,
        },
        include: {
          project: { select: { id: true, name: true } },
        },
      });

      await tx.equipment.update({
        where: { id },
        data: {
          projectId: parsed.projectId,
          status: "assigned",
        },
      });

      return created;
    });

    return NextResponse.json(assignment, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to assign equipment.");
  }
}

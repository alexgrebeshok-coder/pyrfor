import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  notFound,
  serverError,
  validationError,
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
    const parsed = equipmentAssignmentSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

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
          projectId: parsed.data.projectId,
          startDate: new Date(parsed.data.startDate),
          endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
          hoursUsed: parsed.data.hoursUsed,
        },
        include: {
          project: { select: { id: true, name: true } },
        },
      });

      await tx.equipment.update({
        where: { id },
        data: {
          projectId: parsed.data.projectId,
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

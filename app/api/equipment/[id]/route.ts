import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  isPrismaNotFoundError,
  notFound,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { equipmentSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const equipment = await prisma.equipment.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        assignments: {
          include: {
            project: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!equipment) return notFound("Equipment not found");
    return NextResponse.json(equipment);
  } catch (error) {
    return serverError(error, "Failed to fetch equipment.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = equipmentSchema.partial().safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const equipment = await prisma.equipment.update({
      where: { id },
      data: parsed.data,
      include: {
        project: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(equipment);
  } catch (error) {
    if (isPrismaNotFoundError(error)) return notFound("Equipment not found");
    return serverError(error, "Failed to update equipment.");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    await prisma.equipment.delete({ where: { id } });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) return notFound("Equipment not found");
    return serverError(error, "Failed to delete equipment.");
  }
}

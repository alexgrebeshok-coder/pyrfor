import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  isPrismaNotFoundError,
  notFound,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { materialSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const material = await prisma.material.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        movements: {
          include: {
            project: { select: { id: true, name: true } },
          },
          orderBy: { date: "desc" },
        },
      },
    });
    if (!material) return notFound("Material not found");
    return NextResponse.json(material);
  } catch (error) {
    return serverError(error, "Failed to fetch material.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = await validateBody(request, materialSchema.partial());
    if (isValidationError(parsed)) return parsed;

    const material = await prisma.material.update({
      where: { id },
      data: parsed,
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(material);
  } catch (error) {
    if (isPrismaNotFoundError(error)) return notFound("Material not found");
    return serverError(error, "Failed to update material.");
  }
}

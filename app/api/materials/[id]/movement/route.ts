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
import { materialMovementSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = await validateBody(request, materialMovementSchema);
    if (isValidationError(parsed)) return parsed;

    const material = await prisma.material.findUnique({
      where: { id },
      select: { id: true, currentStock: true },
    });
    if (!material) return notFound("Material not found");

    const stockDelta =
      parsed.type === "receipt" || parsed.type === "return"
        ? parsed.quantity
        : -parsed.quantity;

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.materialMovement.create({
        data: {
          id: randomUUID(),
          materialId: id,
          projectId: parsed.projectId,
          type: parsed.type,
          quantity: parsed.quantity,
          unitPrice: parsed.unitPrice ?? null,
          documentRef: parsed.documentRef ?? null,
          date: new Date(parsed.date),
        },
        include: {
          project: { select: { id: true, name: true } },
        },
      });

      await tx.material.update({
        where: { id },
        data: {
          currentStock: Math.max(0, material.currentStock + stockDelta),
        },
      });

      return created;
    });

    return NextResponse.json(movement, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create material movement.");
  }
}

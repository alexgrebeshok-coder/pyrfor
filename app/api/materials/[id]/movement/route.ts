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
import { materialMovementSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = materialMovementSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const material = await prisma.material.findUnique({
      where: { id },
      select: { id: true, currentStock: true },
    });
    if (!material) return notFound("Material not found");

    const stockDelta =
      parsed.data.type === "receipt" || parsed.data.type === "return"
        ? parsed.data.quantity
        : -parsed.data.quantity;

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.materialMovement.create({
        data: {
          id: randomUUID(),
          materialId: id,
          projectId: parsed.data.projectId,
          type: parsed.data.type,
          quantity: parsed.data.quantity,
          unitPrice: parsed.data.unitPrice ?? null,
          documentRef: parsed.data.documentRef ?? null,
          date: new Date(parsed.data.date),
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

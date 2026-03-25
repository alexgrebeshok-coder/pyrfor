import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  databaseUnavailable,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { materialSchema } from "@/lib/validators/resource-finance";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category")?.trim() || undefined;
    const lowStock = searchParams.get("lowStock") === "true";

    const materials = await prisma.material.findMany({
      where: {
        ...(category ? { category } : {}),
      },
      include: {
        supplier: { select: { id: true, name: true } },
        movements: {
          include: {
            project: { select: { id: true, name: true } },
          },
          orderBy: { date: "desc" },
          take: 6,
        },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });

    const filtered = lowStock
      ? materials.filter((material) => material.currentStock <= material.minStock)
      : materials;

    return NextResponse.json({ materials: filtered });
  } catch (error) {
    return serverError(error, "Failed to fetch materials.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const parsed = materialSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const material = await prisma.material.create({
      data: {
        id: randomUUID(),
        ...parsed.data,
      },
      include: {
        supplier: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(material, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create material.");
  }
}

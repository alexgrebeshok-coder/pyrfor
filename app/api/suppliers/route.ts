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
import { supplierSchema } from "@/lib/validators/resource-finance";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const suppliers = await prisma.supplier.findMany({
      include: {
        _count: {
          select: {
            contracts: true,
            materials: true,
            expenses: true,
          },
        },
      },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ suppliers });
  } catch (error) {
    return serverError(error, "Failed to fetch suppliers.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const parsed = supplierSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const supplier = await prisma.supplier.create({
      data: {
        id: randomUUID(),
        ...parsed.data,
      },
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create supplier.");
  }
}

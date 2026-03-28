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
import { supplierSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        contracts: {
          select: { id: true, title: true, amount: true, paidAmount: true, status: true },
        },
        materials: {
          select: { id: true, name: true, currentStock: true, unit: true },
        },
      },
    });
    if (!supplier) return notFound("Supplier not found");
    return NextResponse.json(supplier);
  } catch (error) {
    return serverError(error, "Failed to fetch supplier.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = supplierSchema.partial().safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const supplier = await prisma.supplier.update({
      where: { id },
      data: parsed.data,
    });
    return NextResponse.json(supplier);
  } catch (error) {
    if (isPrismaNotFoundError(error)) return notFound("Supplier not found");
    return serverError(error, "Failed to update supplier.");
  }
}

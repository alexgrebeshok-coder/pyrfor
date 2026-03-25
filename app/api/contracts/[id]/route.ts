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
import { contractSchema } from "@/lib/validators/resource-finance";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    if (!contract) return notFound("Contract not found");
    return NextResponse.json(contract);
  } catch (error) {
    return serverError(error, "Failed to fetch contract.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { id } = await params;
    const parsed = contractSchema.partial().safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const contract = await prisma.contract.update({
      where: { id },
      data: {
        ...parsed.data,
        ...(parsed.data.startDate ? { startDate: new Date(parsed.data.startDate) } : {}),
        ...(parsed.data.endDate ? { endDate: new Date(parsed.data.endDate) } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json(contract);
  } catch (error) {
    if (isPrismaNotFoundError(error)) return notFound("Contract not found");
    return serverError(error, "Failed to update contract.");
  }
}

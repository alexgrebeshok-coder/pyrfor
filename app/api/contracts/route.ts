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
import { contractSchema } from "@/lib/validators/resource-finance";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim() || undefined;
    const supplierId = searchParams.get("supplierId")?.trim() || undefined;

    const contracts = await prisma.contract.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(supplierId ? { supplierId } : {}),
      },
      include: {
        project: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [{ status: "asc" }, { endDate: "asc" }],
    });

    return NextResponse.json({ contracts });
  } catch (error) {
    return serverError(error, "Failed to fetch contracts.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) return authResult;
  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) return databaseUnavailable(runtime.dataMode);

  try {
    const parsed = contractSchema.safeParse(await request.json());
    if (!parsed.success) return validationError(parsed.error);

    const contract = await prisma.contract.create({
      data: {
        id: randomUUID(),
        ...parsed.data,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
      },
      include: {
        project: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(contract, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create contract.");
  }
}

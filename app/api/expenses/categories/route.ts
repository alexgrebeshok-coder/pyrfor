import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import {
  badRequest,
  databaseUnavailable,
  notFound,
  serverError,
  validationError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { expenseCategorySchema } from "@/lib/validators/expense";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const categories = await prisma.expenseCategory.findMany({
      include: {
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            expenses: true,
            children: true,
          },
        },
      },
      orderBy: [{ parentId: "asc" }, { name: "asc" }],
    });

    return NextResponse.json({ categories });
  } catch (error) {
    return serverError(error, "Failed to fetch expense categories.");
  }
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const parsed = expenseCategorySchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const { parentId, ...payload } = parsed.data;
    if (parentId) {
      const parent = await prisma.expenseCategory.findUnique({
        where: { id: parentId },
        select: { id: true },
      });

      if (!parent) {
        return notFound("Parent category not found");
      }
    }

    const existing = await prisma.expenseCategory.findUnique({
      where: { code: payload.code },
      select: { id: true },
    });
    if (existing) {
      return badRequest("Expense category code already exists");
    }

    const category = await prisma.expenseCategory.create({
      data: {
        id: randomUUID(),
        ...payload,
        parentId: parentId ?? null,
      },
    });

    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create expense category.");
  }
}

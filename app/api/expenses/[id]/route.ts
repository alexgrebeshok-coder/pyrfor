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
import { updateExpenseSchema } from "@/lib/validators/expense";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "VIEW_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const { id } = await params;
    const expense = await prisma.expense.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true },
        },
        category: {
          select: { id: true, name: true, code: true, color: true },
        },
        supplier: {
          select: { id: true, name: true },
        },
        task: {
          select: { id: true, title: true },
        },
        equipment: {
          select: { id: true, name: true },
        },
      },
    });

    if (!expense) {
      return notFound("Expense not found");
    }

    return NextResponse.json(expense);
  } catch (error) {
    return serverError(error, "Failed to fetch expense.");
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const { id } = await params;
    const data = await validateBody(request, updateExpenseSchema);
    if (isValidationError(data)) {
      return data;
    }

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        ...data,
        ...(data.date ? { date: new Date(data.date) } : {}),
      },
      include: {
        project: {
          select: { id: true, name: true },
        },
        category: {
          select: { id: true, name: true, code: true, color: true },
        },
        supplier: {
          select: { id: true, name: true },
        },
        task: {
          select: { id: true, title: true },
        },
        equipment: {
          select: { id: true, name: true },
        },
      },
    });

    return NextResponse.json(expense);
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Expense not found");
    }
    return serverError(error, "Failed to update expense.");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "MANAGE_TASKS" });
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const runtime = getServerRuntimeState();
  if (!runtime.databaseConfigured) {
    return databaseUnavailable(runtime.dataMode);
  }

  try {
    const { id } = await params;
    await prisma.expense.delete({
      where: { id },
    });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (isPrismaNotFoundError(error)) {
      return notFound("Expense not found");
    }
    return serverError(error, "Failed to delete expense.");
  }
}

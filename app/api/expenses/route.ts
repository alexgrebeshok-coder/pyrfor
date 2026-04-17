import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  parseDateInput,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { createExpenseSchema } from "@/lib/validators/expense";

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
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId")?.trim() || undefined;
    const categoryId = searchParams.get("categoryId")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;
    const dateFrom = parseDateInput(searchParams.get("dateFrom"));
    const dateTo = parseDateInput(searchParams.get("dateTo"));

    const expenses = await prisma.expense.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(status ? { status } : {}),
        ...(dateFrom || dateTo
          ? {
              date: {
                ...(dateFrom ? { gte: dateFrom } : {}),
                ...(dateTo ? { lte: dateTo } : {}),
              },
            }
          : {}),
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
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const summary = {
      total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
      approved: expenses
        .filter((expense) => expense.status === "approved" || expense.status === "paid")
        .reduce((sum, expense) => sum + expense.amount, 0),
      pending: expenses
        .filter((expense) => expense.status === "pending")
        .reduce((sum, expense) => sum + expense.amount, 0),
      byCategory: Object.values(
        expenses.reduce<Record<string, { categoryId: string; name: string; amount: number; color: string | null }>>(
          (accumulator, expense) => {
            const current = accumulator[expense.categoryId] ?? {
              categoryId: expense.categoryId,
              name: expense.category.name,
              amount: 0,
              color: expense.category.color,
            };
            current.amount += expense.amount;
            accumulator[expense.categoryId] = current;
            return accumulator;
          },
          {}
        )
      ).sort((left, right) => right.amount - left.amount),
    };

    return NextResponse.json({ expenses, summary });
  } catch (error) {
    return serverError(error, "Failed to fetch expenses.");
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
    const payload = await validateBody(request, createExpenseSchema);
    if (isValidationError(payload)) {
      return payload;
    }

    const expense = await prisma.expense.create({
      data: {
        id: randomUUID(),
        ...payload,
        date: new Date(payload.date),
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

    return NextResponse.json(expense, { status: 201 });
  } catch (error) {
    return serverError(error, "Failed to create expense.");
  }
}

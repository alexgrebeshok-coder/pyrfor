/**
 * Finance imports audit trail — GET: list sync entries for finance imports
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source"); // "one-c", "quickbooks", etc.
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const page = Math.max(parseInt(searchParams.get("page") || "1"), 1);
  const skip = (page - 1) * limit;

  const where = {
    entityType: {
      in: ["expenses", "invoices", "vendors", "payments"],
    },
    ...(source
      ? {
          credential: {
            connectorId: { contains: source, mode: "insensitive" as const },
          },
        }
      : {}),
  };

  const [entries, total] = await Promise.all([
    prisma.connectorSyncEntry.findMany({
      where,
      include: {
        credential: {
          select: {
            connectorId: true,
            provider: true,
            accountLabel: true,
          },
        },
      },
      orderBy: { startedAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.connectorSyncEntry.count({ where }),
  ]);

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      source: e.credential.connectorId,
      provider: e.credential.provider,
      accountLabel: e.credential.accountLabel,
      direction: e.direction,
      entityType: e.entityType,
      status: e.status,
      recordsProcessed: e.recordsProcessed,
      recordsFailed: e.recordsFailed,
      error: e.error,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
    })),
    total,
    page,
    limit,
  });
}

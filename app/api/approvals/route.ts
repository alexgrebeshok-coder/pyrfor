/**
 * Approvals API — List + Create
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? "pending";
  const entityType = searchParams.get("entityType");
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);
  const offset = Number(searchParams.get("offset")) || 0;

  const where: Record<string, unknown> = {};
  if (status !== "all") where.status = status;
  if (entityType) where.entityType = entityType;

  const [approvals, total] = await Promise.all([
    prisma.approval.findMany({
      where,
      include: {
        requestedBy: { select: { id: true, name: true, email: true, image: true } },
        reviewedBy: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.approval.count({ where }),
  ]);

  return NextResponse.json({
    approvals: approvals.map((a) => ({
      ...a,
      metadata: a.metadata ? JSON.parse(a.metadata) : null,
    })),
    total,
    pending: status === "pending" ? total : undefined,
  });
}

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { type, entityType, entityId, title, description, metadata, expiresAt } = body;

  if (!type || !entityType || !title) {
    return NextResponse.json(
      { error: "type, entityType, and title are required" },
      { status: 400 },
    );
  }

  const approval = await prisma.approval.create({
    data: {
      id: `apr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      entityType,
      entityId: entityId ?? null,
      title,
      description: description ?? null,
      metadata: metadata ? JSON.stringify(metadata) : null,
      requestedById: authResult.accessProfile.userId ?? null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ approval }, { status: 201 });
}

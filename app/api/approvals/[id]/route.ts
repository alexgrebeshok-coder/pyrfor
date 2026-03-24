/**
 * Approval Detail API — Get, Review (approve/reject)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await context.params;

  const approval = await prisma.approval.findUnique({
    where: { id },
    include: {
      requestedBy: { select: { id: true, name: true, email: true, image: true } },
      reviewedBy: { select: { id: true, name: true, email: true, image: true } },
    },
  });

  if (!approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  return NextResponse.json({
    approval: {
      ...approval,
      metadata: approval.metadata ? JSON.parse(approval.metadata) : null,
    },
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await context.params;
  const body = await request.json();
  const { action, comment } = body;

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 },
    );
  }

  const existing = await prisma.approval.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }

  if (existing.status !== "pending") {
    return NextResponse.json(
      { error: `Approval already ${existing.status}` },
      { status: 409 },
    );
  }

  const approval = await prisma.approval.update({
    where: { id },
    data: {
      status: action === "approve" ? "approved" : "rejected",
      reviewedById: authResult.accessProfile.userId ?? null,
      comment: comment ?? null,
      reviewedAt: new Date(),
    },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      reviewedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({
    approval: {
      ...approval,
      metadata: approval.metadata ? JSON.parse(approval.metadata) : null,
    },
  });
}

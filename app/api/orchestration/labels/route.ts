/**
 * Labels API — CRUD + task linking
 * GET  — list labels for workspace
 * POST — create label
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "executive";

    const labels = await prisma.label.findMany({
      where: { workspaceId },
      include: { _count: { select: { tasks: true } } },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ labels });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { workspaceId = "executive", name, color } = await req.json();

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const label = await prisma.label.create({
      data: { workspaceId, name, color: color ?? "#6b7280" },
    });

    return NextResponse.json({ label }, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Label already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

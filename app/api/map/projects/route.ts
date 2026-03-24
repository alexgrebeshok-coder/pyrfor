/**
 * Map Projects API — returns projects with coordinates for map display
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {};
  if (status && status !== "all") where.status = status;

  const projects = await prisma.project.findMany({
    where,
    select: {
      id: true,
      name: true,
      location: true,
      latitude: true,
      longitude: true,
      progress: true,
      budgetPlan: true,
      budgetFact: true,
      health: true,
      status: true,
      description: true,
      _count: { select: { risks: { where: { status: { not: "closed" } } } } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const mapProjects = projects
    .filter((p) => p.latitude !== null && p.longitude !== null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location ?? "",
      progress: p.progress,
      budget: p.budgetPlan ?? 0,
      risks: p._count.risks,
      status: healthToMapStatus(p.health),
      coordinates: [p.latitude!, p.longitude!] as [number, number],
      description: p.description ?? "",
    }));

  return NextResponse.json({ projects: mapProjects, total: projects.length });
}

function healthToMapStatus(health: string): "ok" | "warning" | "critical" {
  switch (health) {
    case "critical":
    case "at_risk":
      return "critical";
    case "needs_attention":
    case "warning":
      return "warning";
    default:
      return "ok";
  }
}

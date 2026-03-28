/**
 * Executive Pack Report API — generates a JSON-structured executive summary
 * that can be rendered as PDF on the client (via html2canvas/jsPDF)
 * or consumed by Telegram delivery.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request, { permission: "RUN_AI_ACTIONS" });
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json().catch(() => ({}));
  const projectId = body.projectId as string | undefined;
  const period = body.period as string | undefined; // "week" | "month" | "quarter"

  const dateFrom = getDateFrom(period ?? "week");

  const where = projectId ? { id: projectId } : {};

  const [projects, recentTasks, openRisks, recentApprovals] = await Promise.all([
    prisma.project.findMany({
      where,
      select: {
        id: true,
        name: true,
        status: true,
        health: true,
        progress: true,
        budgetPlan: true,
        budgetFact: true,
        location: true,
        _count: {
          select: {
            tasks: true,
            risks: { where: { status: { not: "closed" } } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.task.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        updatedAt: { gte: dateFrom },
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        projectId: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.risk.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        status: { not: "closed" },
      },
      select: {
        id: true,
        title: true,
        severity: true,
        probability: true,
        status: true,
        projectId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.approval.findMany({
      where: { createdAt: { gte: dateFrom } },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        createdAt: true,
        reviewedAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  // Compute summary metrics
  const totalTasks = recentTasks.length;
  const completedTasks = recentTasks.filter((t) => t.status === "done" || t.status === "completed").length;
  const criticalRisks = openRisks.filter((r) => r.severity >= 4).length;
  const avgProgress = projects.length > 0
    ? Math.round(projects.reduce((sum, p) => sum + p.progress, 0) / projects.length)
    : 0;
  const totalBudgetPlan = projects.reduce((sum, p) => sum + (p.budgetPlan ?? 0), 0);
  const totalBudgetFact = projects.reduce((sum, p) => sum + (p.budgetFact ?? 0), 0);
  const budgetUtilization = totalBudgetPlan > 0
    ? Math.round((totalBudgetFact / totalBudgetPlan) * 100)
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    period: period ?? "week",
    dateFrom: dateFrom.toISOString(),
    summary: {
      projectCount: projects.length,
      avgProgress,
      totalBudgetPlan,
      totalBudgetFact,
      budgetUtilization,
      totalTasks,
      completedTasks,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      openRisks: openRisks.length,
      criticalRisks,
      pendingApprovals: recentApprovals.filter((a) => a.status === "pending").length,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      health: p.health,
      progress: p.progress,
      budgetPlan: p.budgetPlan,
      budgetFact: p.budgetFact,
      location: p.location,
      taskCount: p._count.tasks,
      openRiskCount: p._count.risks,
    })),
    recentTasks: recentTasks.slice(0, 20),
    topRisks: openRisks.slice(0, 10),
    approvals: recentApprovals,
  };

  return NextResponse.json({ report });
}

function getDateFrom(period: string): Date {
  const now = new Date();
  switch (period) {
    case "month":
      return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "quarter":
      return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "week":
    default:
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
}

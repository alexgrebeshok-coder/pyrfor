/**
 * Single Run detail — get a specific heartbeat run with events
 * GET /api/orchestration/runs/[runId]
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ runId: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { runId } = await params;
    const run = await prisma.heartbeatRun.findUnique({
      where: { id: runId },
      include: {
        agent: { select: { name: true, slug: true, role: true } },
        events: { orderBy: { seq: "asc" } },
        checkpoints: { orderBy: { seq: "asc" } },
        replayOfRun: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
        },
        replayRuns: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            status: true,
            createdAt: true,
            replayReason: true,
          },
        },
        deadLetterJobs: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            errorType: true,
            errorMessage: true,
            createdAt: true,
          },
        },
        workflowStep: {
          select: {
            id: true,
            nodeId: true,
            name: true,
            status: true,
            workflowRunId: true,
            workflowRun: {
              select: {
                id: true,
                status: true,
                template: {
                  select: {
                    name: true,
                    version: true,
                  },
                },
              },
            },
          },
        },
        outgoingDelegations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
            childAgent: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
            childRun: {
              select: {
                id: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        incomingDelegations: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
            parentAgent: {
              select: {
                id: true,
                name: true,
                role: true,
              },
            },
            parentRun: {
              select: {
                id: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load run") }, { status: 500 });
  }
}

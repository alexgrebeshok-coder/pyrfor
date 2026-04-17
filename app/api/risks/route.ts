import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

import { authorizeRequest } from "@/app/api/middleware/auth";
import { prisma } from "@/lib/prisma";
import { isValidationError, validateBody } from "@/lib/server/api-validation";
import {
  databaseUnavailable,
  serverError,
} from "@/lib/server/api-utils";
import { getServerRuntimeState } from "@/lib/server/runtime-mode";
import { createRiskSchema } from "@/lib/validators/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const severityMap: Record<string, number> = {
  low: 1,
  medium: 3,
  high: 5,
};

function resolveSeverity(probability?: string, impact?: string): number {
  const probabilityScore = severityMap[probability ?? "medium"] ?? severityMap.medium;
  const impactScore = severityMap[impact ?? "medium"] ?? severityMap.medium;
  return Math.round((probabilityScore + impactScore) / 2);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const runtime = getServerRuntimeState();

        if (!runtime.databaseConfigured) {
      return databaseUnavailable(runtime.dataMode);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status");

    // Pagination support
    const page = parseInt(searchParams.get("page") || "1");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const skip = (page - 1) * limit;

    const where = {
      ...(projectId && { projectId }),
      ...(status && { status }),
    };

    const [risks, total] = await Promise.all([
      prisma.risk.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          probability: true,
          impact: true,
          severity: true,
          status: true,
          ownerId: true,
          projectId: true,
          createdAt: true,
          updatedAt: true,
          project: {
            select: { id: true, name: true },
          },
          owner: {
            select: { id: true, name: true, initials: true },
          },
        },
        orderBy: { severity: "desc" },
      }),
      prisma.risk.count({ where }),
    ]);

    return NextResponse.json({
      risks: risks.map(({ project, owner, ...risk }) => ({
        ...risk,
        project,
        owner,
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: skip + limit < total,
      },
    });
  } catch (error) {
    return serverError(error, "Failed to fetch risks.");
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  try {
    const parsed = await validateBody(request, createRiskSchema);
    if (isValidationError(parsed)) {
      return parsed;
    }

    const {
      description,
      impact = "medium",
      ownerId,
      probability = "medium",
      projectId,
      status = "open",
      title,
    } = parsed;

    const risk = await prisma.risk.create({
      data: {
        id: randomUUID(),
        title,
        description,
        projectId,
        ownerId: ownerId ?? undefined,
        probability,
        impact,
        severity: resolveSeverity(probability, impact),
        status,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        title: true,
        description: true,
        probability: true,
        impact: true,
        severity: true,
        status: true,
        ownerId: true,
        projectId: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: { id: true, name: true },
        },
        owner: {
          select: { id: true, name: true, initials: true },
        },
      },
    });

    const { project, owner, ...rest } = risk;

    return NextResponse.json(
      {
        ...rest,
        project,
        owner,
      },
      { status: 201 }
    );
  } catch (error) {
    return serverError(error, "Failed to create risk.");
  }
}

/**
 * Server-side search API — queries projects, tasks, risks, team, milestones
 * Uses PostgreSQL ILIKE for pattern matching (scales better than client-side filter)
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { serverError } from "@/lib/server/api-utils";

export const dynamic = "force-dynamic";

const MAX_PER_TYPE = 10;

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const types = searchParams.get("types")?.split(",") ?? [
    "projects",
    "tasks",
    "risks",
    "team",
    "milestones",
  ];

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [], query: q || "" });
  }

  const pattern = `%${q}%`;

  try {
    const results: Array<{
      type: string;
      id: string;
      title: string;
      snippet: string;
      url: string;
      status?: string;
    }> = [];

    const queries: Promise<void>[] = [];

    if (types.includes("projects")) {
      queries.push(
        prisma.project
          .findMany({
            where: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { location: { contains: q, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
            },
            take: MAX_PER_TYPE,
          })
          .then((rows) =>
            rows.forEach((r) =>
              results.push({
                type: "project",
                id: r.id,
                title: r.name,
                snippet: r.description?.slice(0, 120) || "",
                url: `/projects/${r.id}`,
                status: r.status,
              })
            )
          )
      );
    }

    if (types.includes("tasks")) {
      queries.push(
        prisma.task
          .findMany({
            where: {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              projectId: true,
            },
            take: MAX_PER_TYPE,
          })
          .then((rows) =>
            rows.forEach((r) =>
              results.push({
                type: "task",
                id: r.id,
                title: r.title,
                snippet: r.description?.slice(0, 120) || "",
                url: `/tasks`,
                status: r.status,
              })
            )
          )
      );
    }

    if (types.includes("risks")) {
      queries.push(
        prisma.risk
          .findMany({
            where: {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
            },
            take: MAX_PER_TYPE,
          })
          .then((rows) =>
            rows.forEach((r) =>
              results.push({
                type: "risk",
                id: r.id,
                title: r.title,
                snippet: r.description?.slice(0, 120) || "",
                url: `/risks`,
                status: r.status,
              })
            )
          )
      );
    }

    if (types.includes("team")) {
      queries.push(
        prisma.teamMember
          .findMany({
            where: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { role: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            },
            select: { id: true, name: true, role: true, email: true },
            take: MAX_PER_TYPE,
          })
          .then((rows) =>
            rows.forEach((r) =>
              results.push({
                type: "team",
                id: r.id,
                title: r.name,
                snippet: [r.role, r.email].filter(Boolean).join(" · "),
                url: `/team`,
              })
            )
          )
      );
    }

    if (types.includes("milestones")) {
      queries.push(
        prisma.milestone
          .findMany({
            where: {
              title: { contains: q, mode: "insensitive" },
            },
            select: {
              id: true,
              title: true,
              status: true,
              projectId: true,
            },
            take: MAX_PER_TYPE,
          })
          .then((rows) =>
            rows.forEach((r) =>
              results.push({
                type: "milestone",
                id: r.id,
                title: r.title,
                snippet: `Project: ${r.projectId}`,
                url: `/projects/${r.projectId}`,
                status: r.status,
              })
            )
          )
      );
    }

    await Promise.all(queries);

    return NextResponse.json({
      results,
      query: q,
      totalResults: results.length,
    });
  } catch (error) {
    return serverError(error, "Search failed");
  }
}

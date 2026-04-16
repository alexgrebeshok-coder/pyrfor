/**
 * TaskComment API — thread comments on tasks
 * GET  — list comments for a task
 * POST — add a comment
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const taskId = req.nextUrl.searchParams.get("taskId");
    if (!taskId) {
      return NextResponse.json({ error: "taskId required" }, { status: 400 });
    }

    const comments = await prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ comments });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to load comments") }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { taskId, authorType, authorId, content } = await req.json();

    if (!taskId || !content) {
      return NextResponse.json({ error: "taskId and content required" }, { status: 400 });
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        authorType: authorType ?? "user",
        authorId: authorId ?? "system",
        content,
      },
    });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to create comment") }, { status: 500 });
  }
}

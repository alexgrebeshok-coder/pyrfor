/**
 * Label [id] API — update, delete, link/unlink tasks
 */
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getErrorMessage } from "@/lib/orchestration/error-utils";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    const body = await req.json();

    // Link/unlink task
    if (body.action === "link" && body.taskId) {
      const link = await prisma.taskLabel.create({
        data: { taskId: body.taskId, labelId: id },
      });
      return NextResponse.json({ link });
    }
    if (body.action === "unlink" && body.taskId) {
      await prisma.taskLabel.delete({
        where: { taskId_labelId: { taskId: body.taskId, labelId: id } },
      });
      return NextResponse.json({ ok: true });
    }

    // Update label itself
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.color !== undefined) data.color = body.color;

    const label = await prisma.label.update({ where: { id }, data });
    return NextResponse.json({ label });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to update label") }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const authResult = await authorizeRequest(req, { permission: "RUN_AI_ACTIONS" });
    if (authResult instanceof NextResponse) return authResult;

    const { id } = await params;
    await prisma.label.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error, "Failed to delete label") }, { status: 500 });
  }
}

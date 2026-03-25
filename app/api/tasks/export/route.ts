/**
 * Tasks export — CSV, XLSX, PDF
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authorizeRequest } from "@/app/api/middleware/auth";
import {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  type ColumnDef,
} from "@/lib/export/export-service";

const TASK_COLUMNS: ColumnDef[] = [
  { key: "title", label: "Title", width: 30 },
  { key: "status", label: "Status", width: 12 },
  { key: "priority", label: "Priority", width: 10 },
  { key: "assignee", label: "Assignee", width: 20 },
  { key: "project", label: "Project", width: 25 },
  { key: "dueDate", label: "Due Date", width: 14 },
  { key: "progress", label: "Progress %", width: 10 },
];

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request, {
    permission: "VIEW_TASKS",
  });
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";
  const projectId = searchParams.get("projectId");

  const where = {
    ...(projectId ? { projectId } : {}),
  };

  const tasks = await prisma.task.findMany({
    where,
    include: {
      project: { select: { name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });

  const rows = tasks.map((t) => ({
    title: t.title,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee?.name || "",
    project: t.project?.name || "",
    dueDate: t.dueDate ? t.dueDate.toISOString().split("T")[0] : "",
    progress: t.percentComplete ?? 0,
  }));

  if (format === "csv") {
    const csv = exportToCSV(rows, TASK_COLUMNS);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="tasks.csv"',
      },
    });
  }

  if (format === "xlsx") {
    const buffer = await exportToExcel(rows, TASK_COLUMNS, "Tasks");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="tasks.xlsx"',
      },
    });
  }

  if (format === "pdf") {
    const buffer = await exportToPDF(rows, TASK_COLUMNS, "Tasks Export");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="tasks.pdf"',
      },
    });
  }

  return NextResponse.json(
    { error: "Unsupported format. Use csv, xlsx, or pdf." },
    { status: 400 }
  );
}

/**
 * Projects export — CSV, XLSX, PDF
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

const PROJECT_COLUMNS: ColumnDef[] = [
  { key: "name", label: "Name", width: 30 },
  { key: "status", label: "Status", width: 12 },
  { key: "health", label: "Health", width: 10 },
  { key: "progress", label: "Progress %", width: 10 },
  { key: "budgetPlan", label: "Budget Plan", width: 15 },
  { key: "budgetFact", label: "Budget Fact", width: 15 },
  { key: "startDate", label: "Start Date", width: 14 },
  { key: "endDate", label: "End Date", width: 14 },
  { key: "direction", label: "Direction", width: 20 },
];

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") || "csv";

  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
  });

  const rows = projects.map((p) => ({
    name: p.name,
    status: p.status,
    health: p.health || "",
    progress: p.progress ?? 0,
    budgetPlan: p.budgetPlan ?? 0,
    budgetFact: p.budgetFact ?? 0,
    startDate: p.start
      ? p.start.toISOString().split("T")[0]
      : "",
    endDate: p.end ? p.end.toISOString().split("T")[0] : "",
    direction: p.direction || "",
  }));

  if (format === "csv") {
    const csv = exportToCSV(rows, PROJECT_COLUMNS);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="projects.csv"',
      },
    });
  }

  if (format === "xlsx") {
    const buffer = await exportToExcel(rows, PROJECT_COLUMNS, "Projects");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="projects.xlsx"',
      },
    });
  }

  if (format === "pdf") {
    const buffer = await exportToPDF(
      rows,
      PROJECT_COLUMNS,
      "Projects Export"
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="projects.pdf"',
      },
    });
  }

  return NextResponse.json(
    { error: "Unsupported format. Use csv, xlsx, or pdf." },
    { status: 400 }
  );
}

/**
 * Daily resource load API
 * GET /api/resources/daily-load?projectId=xxx&startDate=...&endDate=...
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { calculateDailyLoad } from "@/lib/scheduling/overallocation";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const startDateStr = searchParams.get("startDate");
  const endDateStr = searchParams.get("endDate");

  if (!projectId || !startDateStr || !endDateStr) {
    return NextResponse.json(
      { error: "projectId, startDate, and endDate are required" },
      { status: 400 }
    );
  }

  try {
    const loads = await calculateDailyLoad(
      projectId,
      new Date(startDateStr),
      new Date(endDateStr)
    );
    return NextResponse.json({ loads });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to calculate daily load",
      },
      { status: 500 }
    );
  }
}

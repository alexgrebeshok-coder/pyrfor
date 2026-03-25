/**
 * Project labor cost API
 * GET /api/projects/[id]/labor-cost
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { calculateProjectLaborCost } from "@/lib/finance/assignment-costing";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const { id } = await params;

  try {
    const cost = await calculateProjectLaborCost(id);
    return NextResponse.json(cost);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to calculate labor cost",
      },
      { status: 500 }
    );
  }
}

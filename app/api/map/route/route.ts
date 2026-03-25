/**
 * Map route API — POST { from, to } → { distanceMeters, durationSeconds, polyline }
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getMapProvider } from "@/lib/maps";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { from, to } = body;

  if (
    !from?.lat ||
    !from?.lng ||
    !to?.lat ||
    !to?.lng
  ) {
    return NextResponse.json(
      { error: "from { lat, lng } and to { lat, lng } are required" },
      { status: 400 }
    );
  }

  try {
    const provider = getMapProvider();
    const result = await provider.route(from, to);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Routing failed",
      },
      { status: 500 }
    );
  }
}

/**
 * Map geocode API — POST { address } → { lat, lng, formattedAddress }
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getMapProvider } from "@/lib/maps";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { address } = body;

  if (!address || typeof address !== "string") {
    return NextResponse.json(
      { error: "address is required" },
      { status: 400 }
    );
  }

  try {
    const provider = getMapProvider();
    const result = await provider.geocode(address);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Geocoding failed",
      },
      { status: 500 }
    );
  }
}

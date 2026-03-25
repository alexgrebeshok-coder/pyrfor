/**
 * Map search API — POST { query, near? } → { places[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getMapProvider } from "@/lib/maps";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { query, near } = body;

  if (!query || typeof query !== "string") {
    return NextResponse.json(
      { error: "query is required" },
      { status: 400 }
    );
  }

  try {
    const provider = getMapProvider();
    const places = await provider.searchPlaces(query, near);
    return NextResponse.json({ places });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Place search failed",
      },
      { status: 500 }
    );
  }
}

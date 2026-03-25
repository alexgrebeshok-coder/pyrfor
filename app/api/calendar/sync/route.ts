/**
 * Calendar sync API — POST: trigger sync from external provider
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { getCalendarProvider } from "@/lib/calendars";

export async function POST(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const body = await request.json();
  const { providerId, credentialId, calendarId, syncToken } = body;

  if (!providerId || !credentialId) {
    return NextResponse.json(
      { error: "providerId and credentialId are required" },
      { status: 400 }
    );
  }

  try {
    const provider = getCalendarProvider(providerId);

    if (!provider.syncDelta) {
      return NextResponse.json(
        { error: `Provider ${providerId} does not support sync` },
        { status: 400 }
      );
    }

    const result = await provider.syncDelta(
      credentialId,
      calendarId || "primary",
      syncToken
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Calendar sync failed",
      },
      { status: 500 }
    );
  }
}

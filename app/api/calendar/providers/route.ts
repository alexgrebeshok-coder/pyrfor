/**
 * Calendar providers API — GET: list available providers + connected status
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/app/api/middleware/auth";
import { listCalendarProviders } from "@/lib/calendars";

export async function GET(request: NextRequest) {
  const authResult = await authorizeRequest(request);
  if (authResult instanceof NextResponse) return authResult;

  const providers = listCalendarProviders();

  // Mark which providers are available based on env/credentials
  const result = providers.map((p) => ({
    id: p.id,
    name: p.name,
    available: p.id === "internal" ? true : false, // external need OAuth
    requiresOAuth: p.id !== "internal",
  }));

  return NextResponse.json({ providers: result });
}
